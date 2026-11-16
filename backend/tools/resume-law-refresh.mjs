import {
  createRecord,
  withRefreshLock,
  refreshExecutionState,
} from './refresh-run-lock.mjs';
import { safeRefreshFailure } from './refresh-failures.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseChangeDates } from './plan-law-refresh.mjs';
import { stageLawRefresh } from './stage-law-refresh.mjs';

const maxDaysPerRun = 7;
const dayMillis = 24 * 60 * 60 * 1000;
export const defaultRefreshJournal = fileURLToPath(
  new URL('../../local-dev/refresh-runs/', import.meta.url),
);

function nextDate(date, days = 1) {
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`;
  return new Date(Date.parse(iso) + days * dayMillis)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');
}

export function yesterdayInSeoul(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  return nextDate(part('year') + part('month') + part('day'), -1);
}

function validateDate(date) {
  if (!/^\d{8}$/.test(date ?? ''))
    throw new Error('Expected a calendar date in YYYYMMDD format.');
  parseChangeDates(date);
  return date;
}

async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isStageReport(report, date) {
  return (
    report?.date === date &&
    Array.isArray(report.candidates) &&
    Array.isArray(report.prepared?.editions) &&
    Array.isArray(report.corrections)
  );
}

export async function refreshJournalStatus(directory) {
  const start = await readRecord(join(directory, 'start.json'));
  if (start === null)
    return { fromDate: null, lastCompletedDate: null, nextDate: null };
  const fromDate = validateDate(start.fromDate);
  let lastCompletedDate = null;
  let date = fromDate;
  while (true) {
    const record = await readRecord(join(directory, date + '.json'));
    if (record === null) return { fromDate, lastCompletedDate, nextDate: date };
    if (record.status !== 'staged' || !isStageReport(record.report, date)) {
      throw new Error(
        `Invalid completion record for ${date}. Check the journal before resuming.`,
      );
    }
    lastCompletedDate = date;
    date = nextDate(date);
  }
}

export async function inspectRefreshJournal(directory) {
  const state = await refreshJournalStatus(directory);
  const execution = await refreshExecutionState(directory);
  if (!state.fromDate)
    return { ...state, execution, lastReport: null, lastFailure: null };

  const lastReport = state.lastCompletedDate
    ? join(directory, state.lastCompletedDate + '.json')
    : null;
  const prefix = state.nextDate + '.failed-';
  const names = (await readdir(directory)).filter(
    (name) => name.startsWith(prefix) && name.endsWith('.json'),
  );
  const attempts = [];
  for (const name of names) {
    const path = join(directory, name);
    const failure = await readRecord(path);
    if (failure?.status === 'failed' && failure.date === state.nextDate) {
      attempts.push({
        path,
        attemptedAt:
          typeof failure.attemptedAt === 'string' &&
          Number.isFinite(Date.parse(failure.attemptedAt))
            ? new Date(failure.attemptedAt).toISOString()
            : null,
        ...safeRefreshFailure(failure),
      });
    }
  }
  attempts.sort((first, second) =>
    (second.attemptedAt ?? '').localeCompare(first.attemptedAt ?? ''),
  );
  return { ...state, execution, lastReport, lastFailure: attempts[0] ?? null };
}

async function resumeUnlocked(
  directory,
  { from, through, runDay = stageLawRefresh },
) {
  validateDate(through);
  if (from !== undefined) validateDate(from);
  let state = await refreshJournalStatus(directory);
  if (state.fromDate === null) {
    if (!from || from > through)
      throw new Error(
        'Initialize the journal with --from on or before --through.',
      );
    await mkdir(directory, { recursive: true });
    await createRecord(join(directory, 'start.json'), { fromDate: from });
    state = await refreshJournalStatus(directory);
  }
  if (from !== undefined && state.fromDate !== from) {
    throw new Error('This journal already has a different start date.');
  }

  const completed = [];
  const attemptedThrough = nextDate(state.nextDate, maxDaysPerRun - 1);
  for (
    let date = state.nextDate;
    date <= through && date <= attemptedThrough;
    date = nextDate(date)
  ) {
    const path = join(directory, date + '.json');
    let existing = await readRecord(path);
    if (existing === null) {
      try {
        const report = await runDay(date, directory);
        if (!isStageReport(report, date))
          throw Object.assign(new Error('The staging report is incomplete.'), {
            code: 'INCOMPLETE_REPORT',
          });
        if (
          report.candidates.some((item) =>
            ['source-conflict', 'edition-conflict'].includes(item.status),
          )
        ) {
          throw Object.assign(
            new Error('An edition conflict needs review.', { cause: report }),
            { code: 'EDITION_CONFLICT' },
          );
        }
        await createRecord(path, { status: 'staged', report });
        existing = await readRecord(path);
      } catch (error) {
        const safe = safeRefreshFailure(error);
        const failurePath = join(
          directory,
          date + '.failed-' + randomUUID() + '.json',
        );
        await createRecord(failurePath, {
          status: 'failed',
          date,
          attemptedAt: new Date().toISOString(),
          ...safe,
          ...(isStageReport(error.cause, date) ? { report: error.cause } : {}),
        });
        throw new Error(
          `Staging stopped on ${date}: ${safe.message} (record: ${failurePath})`,
        );
      }
    }
    if (
      existing?.status !== 'staged' ||
      !isStageReport(existing.report, date)
    ) {
      throw new Error(
        `Invalid completion record for ${date}. Check the journal before resuming.`,
      );
    }
    completed.push({
      date,
      record: path,
      prepared: existing.report.prepared.editions.length,
      corrections: existing.report.corrections.length,
    });
  }
  state = await refreshJournalStatus(directory);
  return {
    ...state,
    through,
    hasBacklog: state.nextDate <= through,
    completed,
  };
}

export async function resumeLawRefresh(directory, options) {
  validateDate(options.through);
  if (options.from !== undefined) validateDate(options.from);
  await mkdir(directory, { recursive: true });
  return withRefreshLock(directory, () => resumeUnlocked(directory, options), {
    recoverLock: options.recoverLock === true,
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      through: { type: 'string' },
      status: { type: 'boolean' },
      help: { type: 'boolean' },
      'recover-lock': { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node --env-file=local-dev/.env backend/tools/resume-law-refresh.mjs [journal-directory] [--from YYYYMMDD] [--through YYYYMMDD] [--recover-lock] | [journal-directory] --status',
    );
    return;
  }
  if (
    positionals.length > 1 ||
    (values.status && (values.from || values.through || values['recover-lock']))
  ) {
    throw new Error('Use --help for the resume command options.');
  }
  const directory = resolve(positionals[0] ?? defaultRefreshJournal);
  if (values.status) {
    console.log(
      JSON.stringify(await inspectRefreshJournal(directory), null, 2),
    );
    return;
  }
  const yesterday = yesterdayInSeoul();
  const through = values.through ?? yesterday;
  if (validateDate(through) > yesterday)
    throw new Error('The last date cannot be later than yesterday in Seoul.');
  console.log(
    JSON.stringify(
      await resumeLawRefresh(directory, {
        from: values.from,
        through,
        recoverLock: values['recover-lock'],
      }),
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
