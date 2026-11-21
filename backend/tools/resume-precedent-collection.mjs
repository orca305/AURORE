import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createRecord,
  withRefreshLock,
  refreshExecutionState,
} from './refresh-run-lock.mjs';
import { readOfficialSample, storeSnapshot } from './capture-law-samples.mjs';
import { parsePrecedent } from './import-precedent-samples.mjs';

export const defaultPrecedentJournal = fileURLToPath(
  new URL('../../local-dev/precedent-runs/', import.meta.url),
);
const fail = (code) => Object.assign(new Error(code), { code });
const codes = new Set([
  'SOURCE_READ_FAILED',
  'SOURCE_INVALID',
  'SNAPSHOT_FAILED',
]);
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw fail('JOURNAL_INVALID');
  }
}
export function validatePrecedentQueue(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000)
    throw fail('QUEUE_INVALID');
  const ids = new Set();
  return value.map((item) => {
    if (
      !item ||
      !/^[1-9][0-9]{0,11}$/.test(item.ID ?? '') ||
      typeof item.ID !== 'string' ||
      typeof item.caseNumber !== 'string' ||
      !item.caseNumber.trim() ||
      item.caseNumber.length > 100 ||
      /[\u0000-\u001f\u007f]/u.test(item.caseNumber) ||
      ids.has(item.ID) ||
      Object.keys(item).some((key) => !['ID', 'caseNumber'].includes(key))
    )
      throw fail('QUEUE_INVALID');
    ids.add(item.ID);
    return { ID: item.ID, caseNumber: item.caseNumber };
  });
}
async function readPlan(directory) {
  const plan = await readJson(join(directory, 'queue.json'));
  if (!plan) return null;
  if (plan.version !== 1) throw fail('JOURNAL_INVALID');
  return validatePrecedentQueue(plan.items);
}
// ponytail: at most 1000 items per fixed queue; split larger collections into separate journals.
export async function readCollectedPrecedents(directory) {
  const items = await readPlan(directory);
  if (!items) return { items: [], completed: [], pending: [] };
  const completed = [],
    pending = [];
  for (const item of items) {
    const saved = await readJson(join(directory, item.ID + '.json'));
    if (!saved) {
      pending.push(item);
      continue;
    }
    if (
      saved.ID !== item.ID ||
      !/^[a-f0-9]{64}$/.test(saved.hash ?? '') ||
      !Number.isSafeInteger(saved.bytes) ||
      saved.bytes < 1 ||
      typeof saved.collectedAt !== 'string' ||
      !Number.isFinite(Date.parse(saved.collectedAt))
    )
      throw fail('JOURNAL_INVALID');
    let bytes;
    try {
      bytes = await readFile(
        join(directory, 'snapshots', saved.hash + '.json'),
      );
    } catch {
      throw fail('SNAPSHOT_INVALID');
    }
    if (
      bytes.length !== saved.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== saved.hash
    )
      throw fail('SNAPSHOT_INVALID');
    try {
      parsePrecedent({ target: 'prec', ...item }, bytes);
    } catch {
      throw fail('SNAPSHOT_INVALID');
    }
    completed.push({
      ...item,
      hash: saved.hash,
      bytes: saved.bytes,
      collectedAt: new Date(saved.collectedAt).toISOString(),
    });
  }
  return { items, completed, pending };
}
export async function precedentCollectionStatus(directory) {
  const { items, completed, pending } =
    await readCollectedPrecedents(directory);
  const execution = await refreshExecutionState(directory);
  let lastFailure = null;
  if (pending.length) {
    const names = (await readdir(directory)).filter((name) =>
      new RegExp('^' + pending[0].ID + '[.]failed-[0-9a-f-]{36}[.]json$').test(
        name,
      ),
    );
    for (const name of names) {
      const value = await readJson(join(directory, name));
      if (
        value?.ID !== pending[0].ID ||
        typeof value.attemptedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.attemptedAt))
      )
        throw fail('JOURNAL_INVALID');
      const failure = {
        ID: value.ID,
        code: codes.has(value.code) ? value.code : 'SOURCE_READ_FAILED',
        attemptedAt: new Date(value.attemptedAt).toISOString(),
      };
      if (!lastFailure || failure.attemptedAt > lastFailure.attemptedAt)
        lastFailure = failure;
    }
  }
  return {
    initialized: items.length > 0,
    total: items.length,
    completed: completed.length,
    remaining: pending.length,
    nextId: pending[0]?.ID ?? null,
    execution,
    lastFailure,
  };
}
export async function resumePrecedentCollection(
  directory,
  {
    queue,
    limit = 20,
    recoverLock = false,
    oc,
    readSource = readOfficialSample,
  } = {},
) {
  const requested =
    queue === undefined ? undefined : validatePrecedentQueue(queue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw fail('LIMIT_INVALID');
  await mkdir(directory, { recursive: true });
  const result = await withRefreshLock(
    directory,
    async () => {
      let plan = await readPlan(directory);
      if (
        plan &&
        requested &&
        JSON.stringify(plan) !== JSON.stringify(requested)
      )
        throw fail('QUEUE_CHANGED');
      if (!plan) {
        if (!requested) throw fail('QUEUE_REQUIRED');
        await createRecord(join(directory, 'queue.json'), {
          version: 1,
          items: requested,
        });
        plan = await readPlan(directory);
      }
      const state = await readCollectedPrecedents(directory);
      const collected = [];
      for (const item of state.pending.slice(0, limit)) {
        let code = 'SOURCE_READ_FAILED';
        try {
          const sample = { target: 'prec', ...item };
          const { bytes } = await readSource(sample, oc);
          code = 'SOURCE_INVALID';
          parsePrecedent(sample, bytes);
          code = 'SNAPSHOT_FAILED';
          const snapshot = await storeSnapshot(
            join(directory, 'snapshots'),
            bytes,
          );
          const saved = {
            ID: item.ID,
            hash: snapshot.hash,
            bytes: bytes.length,
            collectedAt: new Date().toISOString(),
          };
          if (!(await createRecord(join(directory, item.ID + '.json'), saved)))
            throw fail('SNAPSHOT_FAILED');
          collected.push(item.ID);
        } catch {
          await createRecord(
            join(directory, item.ID + '.failed-' + randomUUID() + '.json'),
            { ID: item.ID, code, attemptedAt: new Date().toISOString() },
          );
          throw fail(code);
        }
      }
      return { collected, ...(await precedentCollectionStatus(directory)) };
    },
    { recoverLock },
  );
  return { ...result, execution: await refreshExecutionState(directory) };
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      queue: { type: 'string' },
      limit: { type: 'string' },
      status: { type: 'boolean' },
      'recover-lock': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node --env-file=local-dev/.env backend/tools/resume-precedent-collection.mjs [journal-directory] [--queue queue.json] [--limit 1..1000] [--recover-lock] | [journal-directory] --status',
    );
    return;
  }
  if (
    positionals.length > 1 ||
    (values.status && (values.queue || values.limit || values['recover-lock']))
  )
    throw fail('OPTIONS_INVALID');
  const directory = resolve(positionals[0] ?? defaultPrecedentJournal);
  if (values.status) {
    console.log(
      JSON.stringify(await precedentCollectionStatus(directory), null, 2),
    );
    return;
  }
  const oc = process.env.MOLEG_OC?.trim();
  if (!oc) throw fail('OC_REQUIRED');
  const queue = values.queue
    ? await readJson(resolve(values.queue))
    : undefined;
  if (values.queue && !queue) throw fail('QUEUE_REQUIRED');
  const result = await resumePrecedentCollection(directory, {
    queue,
    oc,
    limit: values.limit === undefined ? 20 : Number(values.limit),
    recoverLock: values['recover-lock'],
  });
  console.log(JSON.stringify(result, null, 2));
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const allowed = new Set([
      ...codes,
      'QUEUE_INVALID',
      'JOURNAL_INVALID',
      'SNAPSHOT_INVALID',
      'QUEUE_CHANGED',
      'QUEUE_REQUIRED',
      'LIMIT_INVALID',
      'OPTIONS_INVALID',
      'OC_REQUIRED',
      'BATCH_RUNNING',
      'RECOVERY_REQUIRED',
      'RECOVERY_BUSY',
      'OTHER_HOST',
      'INVALID',
      'LOCK_INVALID',
      'LOCK_CHANGED',
    ]);
    console.error(allowed.has(error.code) ? error.code : 'COLLECTION_FAILED');
    process.exitCode = 1;
  }
}
