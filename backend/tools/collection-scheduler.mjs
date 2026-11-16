import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join, isAbsolute, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { withRefreshLock, refreshExecutionState } from './refresh-run-lock.mjs';
import {
  resumeLawRefresh,
  refreshJournalStatus,
  yesterdayInSeoul,
  defaultRefreshJournal,
} from './resume-law-refresh.mjs';
import {
  resumePrecedentCollection,
  readCollectedPrecedents,
  validatePrecedentQueue,
} from './resume-precedent-collection.mjs';
import { backupAndVerify, defaultBackupRoot } from './verify-db-backup.mjs';
import { parseChangeDates } from './plan-law-refresh.mjs';
export const defaultSchedulerDirectory = fileURLToPath(
  new URL('../../local-dev/collection-scheduler/', import.meta.url),
);
const minute = 60000,
  day = 86400000;
const failure = (code) => Object.assign(new Error(code), { code });
const codes = new Set([
  'RUN_FAILED',
  'SOURCE_READ_FAILED',
  'SOURCE_INVALID',
  'SNAPSHOT_FAILED',
  'TARGET_BUSY',
  'RECOVERY_REQUIRED',
  'SETUP_REQUIRED',
  'BACKUP_FAILED',
  'RETENTION_FAILED',
]);
const statuses = new Set(['RUNNING', 'SUCCEEDED', 'FAILED', 'BACKLOG']);
const iso = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
function at(value) {
  if (
    typeof value !== 'string' ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
  )
    throw failure('CONFIG_INVALID');
  return value;
}
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw failure('CONFIG_INVALID');
}
export function schedulerConfig(value) {
  keys(value, ['version', 'enabled', 'law', 'precedent', 'backup']);
  keys(value.law, ['enabled', 'dailyAt', 'journal', 'fromDate']);
  keys(value.precedent, ['enabled', 'dailyAt', 'directories']);
  const backup = value.backup ?? {
    enabled: false,
    dailyAt: '02:00',
    root: defaultBackupRoot,
  };
  keys(backup, ['enabled', 'dailyAt', 'root']);
  if (
    typeof backup.enabled !== 'boolean' ||
    typeof backup.root !== 'string' ||
    !isAbsolute(backup.root)
  )
    throw failure('CONFIG_INVALID');
  if (
    value.version !== 1 ||
    [value.enabled, value.law.enabled, value.precedent.enabled].some(
      (v) => typeof v !== 'boolean',
    ) ||
    !isAbsolute(value.law.journal ?? '') ||
    !Array.isArray(value.precedent.directories) ||
    value.precedent.directories.length > 10 ||
    value.precedent.directories.some(
      (v) => typeof v !== 'string' || !isAbsolute(v),
    )
  )
    throw failure('CONFIG_INVALID');
  if (value.law.fromDate !== null) {
    try {
      parseChangeDates(value.law.fromDate);
    } catch {
      throw failure('CONFIG_INVALID');
    }
  }
  const directories = value.precedent.directories.map((v) => resolve(v));
  if (
    new Set(
      directories.map((v) =>
        process.platform === 'win32' ? v.toLowerCase() : v,
      ),
    ).size !== directories.length
  )
    throw failure('CONFIG_INVALID');
  return {
    version: 1,
    enabled: value.enabled,
    backup: {
      enabled: backup.enabled,
      dailyAt: at(backup.dailyAt),
      root: resolve(backup.root),
    },
    law: {
      enabled: value.law.enabled,
      dailyAt: at(value.law.dailyAt),
      journal: resolve(value.law.journal),
      fromDate: value.law.fromDate,
    },
    precedent: {
      enabled: value.precedent.enabled,
      dailyAt: at(value.precedent.dailyAt),
      directories,
    },
  };
}
export function disabledSchedulerConfig() {
  return {
    version: 1,
    enabled: false,
    backup: { enabled: false, dailyAt: '02:00', root: defaultBackupRoot },
    law: {
      enabled: false,
      dailyAt: '03:00',
      journal: defaultRefreshJournal,
      fromDate: null,
    },
    precedent: { enabled: false, dailyAt: '04:00', directories: [] },
  };
}
async function json(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw failure('STATE_INVALID');
  }
}
async function configAt(directory) {
  try {
    return schedulerConfig(
      (await json(join(directory, 'config.json'))) ?? disabledSchedulerConfig(),
    );
  } catch {
    throw failure('CONFIG_INVALID');
  }
}
async function stateAt(directory) {
  const value = (await json(join(directory, 'monitor.json'))) ?? {
    heartbeatAt: null,
    jobs: {},
  };
  if (
    (value.heartbeatAt !== null && !iso(value.heartbeatAt)) ||
    !value.jobs ||
    typeof value.jobs !== 'object' ||
    Array.isArray(value.jobs)
  )
    throw failure('STATE_INVALID');
  for (const [key, row] of Object.entries(value.jobs))
    if (
      !['law', 'precedent', 'backup'].includes(key) ||
      !row ||
      !statuses.has(row.status) ||
      !iso(row.slot) ||
      !iso(row.startedAt) ||
      (row.finishedAt !== null && !iso(row.finishedAt)) ||
      !iso(row.nextAttemptAt) ||
      (row.lastSuccessAt !== null && !iso(row.lastSuccessAt)) ||
      !Number.isInteger(row.attempts) ||
      row.attempts < 0 ||
      row.attempts > 3 ||
      !Number.isInteger(row.failures) ||
      row.failures < 0 ||
      !Number.isInteger(row.processed) ||
      row.processed < 0 ||
      (row.retentionRemoved !== undefined &&
        (!Number.isInteger(row.retentionRemoved) ||
          row.retentionRemoved < 0)) ||
      typeof row.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
      (row.code !== null && !codes.has(row.code))
    )
      throw failure('STATE_INVALID');
  return value;
}
async function save(directory, state) {
  const target = join(directory, 'monitor.json'),
    temporary = target + '.' + randomUUID() + '.part';
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(state, null, 2) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
export function dailySlot(now, dailyAt) {
  at(dailyAt);
  const kst = new Date(now.valueOf() + 9 * 60 * minute),
    date = kst.toISOString().slice(0, 10);
  let time = Date.parse(date + 'T' + dailyAt + ':00+09:00');
  if (time > now.valueOf()) time -= day;
  return new Date(time).toISOString();
}
export async function schedulerStatus(directory, now = new Date()) {
  const config = await configAt(directory),
    state = await stateAt(directory),
    execution = await refreshExecutionState(directory);
  return {
    enabled: config.enabled,
    timezone: 'Asia/Seoul',
    heartbeatAt: state.heartbeatAt
      ? new Date(state.heartbeatAt).toISOString()
      : null,
    worker: !config.enabled
      ? 'DISABLED'
      : execution.status === 'RECOVERY_REQUIRED'
        ? 'RECOVERY_REQUIRED'
        : ['OTHER_HOST', 'INVALID'].includes(execution.status)
          ? execution.status
          : execution.status !== 'RUNNING'
            ? 'NOT_RUNNING'
            : state.heartbeatAt &&
                now.valueOf() - Date.parse(state.heartbeatAt) > 2 * minute
              ? 'DELAYED'
              : 'RUNNING',
    jobs: ['law', 'precedent', 'backup'].map((kind) => {
      const configured = config[kind],
        row = state.jobs[kind],
        same =
          row?.fingerprint ===
          createHash('sha256').update(JSON.stringify(configured)).digest('hex');
      return {
        kind,
        enabled: config.enabled && configured.enabled,
        dailyAt: configured.dailyAt,
        targets: kind === 'precedent' ? configured.directories.length : 1,
        status: same ? row.status : 'NOT_RUN',
        code: same ? row.code : null,
        failures: same ? row.failures : 0,
        attempts: same ? row.attempts : 0,
        processed: same ? row.processed : 0,
        retentionRemoved: same ? (row.retentionRemoved ?? 0) : 0,
        startedAt:
          same && row.startedAt ? new Date(row.startedAt).toISOString() : null,
        finishedAt:
          same && row.finishedAt
            ? new Date(row.finishedAt).toISOString()
            : null,
        lastSuccessAt:
          same && row.lastSuccessAt
            ? new Date(row.lastSuccessAt).toISOString()
            : null,
        nextAttemptAt:
          config.enabled && configured.enabled
            ? same
              ? new Date(row.nextAttemptAt).toISOString()
              : dailySlot(now, configured.dailyAt)
            : null,
      };
    }),
  };
}
async function runLaw(config, now) {
  if (!process.env.MOLEG_OC?.trim() || !process.env.DATABASE_URL)
    throw failure('SETUP_REQUIRED');
  const state = await refreshJournalStatus(config.journal);
  if (!state.fromDate && !config.fromDate) throw failure('SETUP_REQUIRED');
  const result = await resumeLawRefresh(config.journal, {
    from: state.fromDate ? undefined : config.fromDate,
    through: yesterdayInSeoul(now),
  });
  return { processed: result.completed.length, hasBacklog: result.hasBacklog };
}
async function runPrecedent(config) {
  if (!process.env.MOLEG_OC?.trim()) throw failure('SETUP_REQUIRED');
  if (!config.directories.length) throw failure('SETUP_REQUIRED');
  let budget = 20,
    processed = 0,
    hasBacklog = false;
  for (const directory of config.directories) {
    const existing = await readCollectedPrecedents(directory);
    let queue;
    if (!existing.items.length) {
      const value = await json(join(directory, 'input.json'));
      if (!value) throw failure('SETUP_REQUIRED');
      queue = validatePrecedentQueue(value);
    }
    const pending = existing.items.length
      ? existing.pending.length
      : queue.length;
    if (!pending) continue;
    if (!budget) {
      hasBacklog = true;
      continue;
    }
    const result = await resumePrecedentCollection(directory, {
      queue,
      limit: budget,
      oc: process.env.MOLEG_OC?.trim(),
    });
    processed += result.collected.length;
    budget -= result.collected.length;
    hasBacklog ||= result.remaining > 0;
  }
  return { processed, hasBacklog };
}
async function runBackup(config) {
  const report = await backupAndVerify({ root: config.root });
  if (report.status !== 'VERIFIED') throw failure('BACKUP_FAILED');
  if (report.retention.skipped) throw failure('RETENTION_FAILED');
  return {
    processed: 1,
    hasBacklog: false,
    retentionRemoved: report.retention.removed,
  };
}
function overlapping(left, right) {
  const rel = relative(left, right);
  return (
    !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
  );
}
async function tick(
  directory,
  {
    now = () => new Date(),
    runLaw: law = runLaw,
    runPrecedent: precedent = runPrecedent,
    runBackup: backup = runBackup,
  } = {},
) {
  const config = await configAt(directory),
    state = await stateAt(directory),
    time = now();
  for (const target of [
    config.law.journal,
    ...config.precedent.directories,
    config.backup.root,
  ])
    if (overlapping(directory, target) || overlapping(target, directory))
      throw failure('CONFIG_INVALID');
  state.heartbeatAt = time.toISOString();
  await save(directory, state);
  if (!config.enabled) return;
  for (const kind of ['law', 'precedent', 'backup']) {
    const task = config[kind];
    if (!task.enabled) continue;
    const fingerprint = createHash('sha256')
        .update(JSON.stringify(task))
        .digest('hex'),
      slot = dailySlot(time, task.dailyAt),
      old = state.jobs[kind];
    const same = old?.fingerprint === fingerprint && old.slot === slot;
    if (
      same &&
      (old.status === 'SUCCEEDED' ||
        old.attempts >= 3 ||
        Date.parse(old.nextAttemptAt) > time.valueOf())
    )
      continue;
    const row = {
      fingerprint,
      slot,
      status: 'RUNNING',
      code: null,
      attempts: same ? old.attempts + 1 : 1,
      failures: old?.fingerprint === fingerprint ? old.failures : 0,
      processed: 0,
      retentionRemoved: 0,
      startedAt: now().toISOString(),
      finishedAt: null,
      lastSuccessAt:
        old?.fingerprint === fingerprint ? old.lastSuccessAt : null,
      nextAttemptAt: slot,
    };
    state.jobs[kind] = row;
    state.heartbeatAt = now().toISOString();
    await save(directory, state);
    try {
      const result = await (kind === 'law'
        ? law(task, time)
        : kind === 'precedent'
          ? precedent(task, time)
          : backup(task, time));
      if (
        !result ||
        !Number.isInteger(result.processed) ||
        result.processed < 0 ||
        typeof result.hasBacklog !== 'boolean'
      )
        throw failure('RUN_FAILED');
      row.processed = result.processed;
      if (
        result.retentionRemoved !== undefined &&
        (!Number.isInteger(result.retentionRemoved) ||
          result.retentionRemoved < 0)
      )
        throw failure('BACKUP_FAILED');
      row.retentionRemoved = result.retentionRemoved ?? 0;
      row.failures = 0;
      row.status = result.hasBacklog ? 'BACKLOG' : 'SUCCEEDED';
      row.lastSuccessAt = now().toISOString();
      if (result.hasBacklog) row.attempts = 0;
      row.nextAttemptAt = new Date(
        result.hasBacklog
          ? Math.min(now().valueOf() + 15 * minute, Date.parse(slot) + day)
          : Date.parse(slot) + day,
      ).toISOString();
    } catch (error) {
      row.status = 'FAILED';
      row.failures = Math.min(row.failures + 1, 1000000);
      row.code = ['BATCH_RUNNING', 'RECOVERY_BUSY'].includes(error.code)
        ? 'TARGET_BUSY'
        : codes.has(error.code)
          ? error.code
          : kind === 'backup'
            ? 'BACKUP_FAILED'
            : 'RUN_FAILED';
      row.nextAttemptAt = new Date(
        row.attempts >= 3
          ? Date.parse(slot) + day
          : Math.min(now().valueOf() + 60 * minute, Date.parse(slot) + day),
      ).toISOString();
    }
    row.finishedAt = now().toISOString();
    state.heartbeatAt = now().toISOString();
    await save(directory, state);
  }
}
export async function runSchedulerOnce(directory, options = {}) {
  directory = resolve(directory);
  await mkdir(directory, { recursive: true });
  await withRefreshLock(directory, () => tick(directory, options), {
    recoverLock: options.recoverLock === true,
  });
  return schedulerStatus(directory, options.now?.() ?? new Date());
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      watch: { type: 'boolean' },
      status: { type: 'boolean' },
      'recover-lock': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node --env-file=local-dev/.env --use-system-ca backend/tools/collection-scheduler.mjs [scheduler-directory] [--watch | --status] [--recover-lock]',
    );
    return;
  }
  if (
    positionals.length > 1 ||
    (values.status && (values.watch || values['recover-lock']))
  )
    throw failure('OPTIONS_INVALID');
  const directory = resolve(
    positionals[0] ??
      process.env.AURORE_COLLECTION_SCHEDULER_DIR ??
      defaultSchedulerDirectory,
  );
  if (values.status) {
    console.log(JSON.stringify(await schedulerStatus(directory), null, 2));
    return;
  }
  if (!values.watch) {
    console.log(
      JSON.stringify(
        await runSchedulerOnce(directory, {
          recoverLock: values['recover-lock'],
        }),
        null,
        2,
      ),
    );
    return;
  }
  await mkdir(directory, { recursive: true });
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await withRefreshLock(
      directory,
      async () => {
        while (!controller.signal.aborted) {
          await tick(directory);
          try {
            await delay(minute, undefined, { signal: controller.signal });
          } catch (error) {
            if (error.name !== 'AbortError') throw error;
          }
        }
      },
      { recoverLock: values['recover-lock'] },
    );
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const allowed = new Set([
      'CONFIG_INVALID',
      'STATE_INVALID',
      'OPTIONS_INVALID',
      'BATCH_RUNNING',
      'RECOVERY_REQUIRED',
      'RECOVERY_BUSY',
      'OTHER_HOST',
      'INVALID',
      'LOCK_INVALID',
      'LOCK_CHANGED',
    ]);
    console.error(allowed.has(error.code) ? error.code : 'SCHEDULER_FAILED');
    process.exitCode = 1;
  }
}
