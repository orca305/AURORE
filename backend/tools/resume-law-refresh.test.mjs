import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { refreshExecutionState } from './refresh-run-lock.mjs';
import {
  inspectRefreshJournal,
  refreshJournalStatus,
  resumeLawRefresh,
  yesterdayInSeoul,
} from './resume-law-refresh.mjs';

async function journal(t) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'aurore-resume-test-'));
  t.after(async () => {
    assert.equal(dirname(directory), parent);
    assert.match(basename(directory), /^aurore-resume-test-/);
    await rm(directory, { recursive: true });
  });
  return directory;
}

const stage = (date, candidates = []) => ({
  date,
  candidates,
  prepared: { editions: [] },
  corrections: [],
});

test('keeps completed days, records a failed day, and resumes from it', async (t) => {
  const directory = await journal(t);
  assert.deepEqual(await refreshJournalStatus(directory), {
    fromDate: null,
    lastCompletedDate: null,
    nextDate: null,
  });
  const attempted = [];
  await assert.rejects(
    resumeLawRefresh(directory, {
      from: '20240228',
      through: '20240301',
      runDay: async (date) => {
        attempted.push(date);
        if (date === '20240229') throw new Error('fixture unavailable');
        return stage(date);
      },
    }),
    /stopped on 20240229/,
  );
  assert.deepEqual(attempted, ['20240228', '20240229']);
  assert.deepEqual(await refreshJournalStatus(directory), {
    fromDate: '20240228',
    lastCompletedDate: '20240228',
    nextDate: '20240229',
  });
  const failure = (await readdir(directory)).find((name) =>
    name.startsWith('20240229.failed-'),
  );
  assert.equal(
    JSON.parse(await readFile(join(directory, failure), 'utf8')).code,
    'STAGING_FAILED',
  );
  assert.ok(
    !(await readFile(join(directory, failure), 'utf8')).includes(
      'fixture unavailable',
    ),
  );
  const failedStatus = await inspectRefreshJournal(directory);
  assert.equal(failedStatus.lastFailure.code, 'STAGING_FAILED');
  assert.equal(basename(failedStatus.lastReport), '20240228.json');

  const resumed = await resumeLawRefresh(directory, {
    through: '20240301',
    runDay: async (date) => {
      attempted.push(date);
      return stage(date);
    },
  });
  assert.deepEqual(
    resumed.completed.map((row) => row.date),
    ['20240229', '20240301'],
  );
  assert.equal(resumed.nextDate, '20240302');
  assert.equal(resumed.hasBacklog, false);
  assert.equal((await inspectRefreshJournal(directory)).lastFailure, null);
  assert.deepEqual(attempted, ['20240228', '20240229', '20240229', '20240301']);
  assert.equal(
    (
      await resumeLawRefresh(directory, {
        through: '20240301',
        runDay: () => assert.fail('Completed dates must not be repeated.'),
      })
    ).completed.length,
    0,
  );
});

test('limits backlog to seven days and keeps conflicts incomplete with their report', async (t) => {
  const directory = await journal(t);
  const first = await resumeLawRefresh(directory, {
    from: '20261101',
    through: '20261110',
    runDay: async (date) => stage(date),
  });
  assert.equal(first.completed.length, 7);
  assert.equal(first.nextDate, '20261108');
  assert.equal(first.hasBacklog, true);
  await assert.rejects(
    resumeLawRefresh(directory, {
      through: '20261110',
      runDay: async (date) => stage(date, [{ status: 'source-conflict' }]),
    }),
    /needs review/,
  );
  assert.equal((await refreshJournalStatus(directory)).nextDate, '20261108');
  const failure = (await readdir(directory)).find((name) =>
    name.startsWith('20261108.failed-'),
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, failure), 'utf8')).report
      .candidates,
    [{ status: 'source-conflict' }],
  );
  await writeFile(join(directory, '20261108.json'), '{"status":"staged"}');
  await assert.rejects(
    refreshJournalStatus(directory),
    /Invalid completion record for 20261108/,
  );
});

test('makes simultaneous checkpoints non-destructive and uses Seoul dates', async (t) => {
  const directory = await journal(t);
  assert.equal(yesterdayInSeoul(new Date('2026-11-09T14:59:59Z')), '20261108');
  assert.equal(yesterdayInSeoul(new Date('2026-11-09T15:00:00Z')), '20261109');
  let release, entered;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    started = new Promise((resolve) => {
      entered = resolve;
    });
  let calls = 0;
  const options = {
    from: '20261109',
    through: '20261109',
    runDay: async (date) => {
      calls++;
      entered();
      await gate;
      return stage(date);
    },
  };
  const first = resumeLawRefresh(directory, options);
  await started;
  assert.equal((await refreshExecutionState(directory)).status, 'RUNNING');
  await assert.rejects(resumeLawRefresh(directory, options), {
    code: 'BATCH_RUNNING',
  });
  await assert.rejects(
    resumeLawRefresh(directory, { ...options, recoverLock: true }),
    { code: 'BATCH_RUNNING' },
  );
  release();
  assert.equal((await first).lastCompletedDate, '20261109');
  assert.equal(calls, 1);
  assert.equal((await refreshExecutionState(directory)).status, 'IDLE');
  assert.deepEqual((await readdir(directory)).sort(), [
    '20261109.json',
    'start.json',
  ]);
  await assert.rejects(
    resumeLawRefresh(directory, { ...options, from: '20261108' }),
    /different start date/,
  );
});

test('resumes after a terminated local process only with explicit verified recovery', async (t) => {
  const directory = await journal(t),
    module = new URL('./resume-law-refresh.mjs', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-', directory],
    {
      windowsHide: true,
      encoding: 'utf8',
      input: `const {resumeLawRefresh}=await import(${JSON.stringify(module)});await resumeLawRefresh(process.argv[2],{from:'20261109',through:'20261109',runDay:()=>process.exit(17)});`,
    },
  );
  assert.equal(child.status, 17, child.stderr);
  assert.equal(
    (await refreshExecutionState(directory)).status,
    'RECOVERY_REQUIRED',
  );
  await assert.rejects(
    resumeLawRefresh(directory, {
      through: '20261109',
      runDay: () => assert.fail('stale lock must be checked'),
    }),
    { code: 'RECOVERY_REQUIRED' },
  );
  const result = await resumeLawRefresh(directory, {
    through: '20261109',
    recoverLock: true,
    runDay: async (date) => stage(date),
  });
  assert.equal(result.lastCompletedDate, '20261109');
  assert.equal((await refreshExecutionState(directory)).status, 'IDLE');
});
test('does not steal a foreign or malformed lock and suppresses failure secrets', async (t) => {
  const directory = await journal(t),
    path = join(directory, 'run.lock.json');
  await writeFile(
    path,
    JSON.stringify({
      pid: process.pid,
      host: hostname() + '-other',
      token: randomUUID(),
      startedAt: new Date().toISOString(),
    }),
  );
  await assert.rejects(
    resumeLawRefresh(directory, {
      from: '20261109',
      through: '20261109',
      recoverLock: true,
    }),
    { code: 'OTHER_HOST' },
  );
  assert.equal((await refreshExecutionState(directory)).status, 'OTHER_HOST');
  await writeFile(path, 'broken-json');
  await assert.rejects(
    resumeLawRefresh(directory, {
      from: '20261109',
      through: '20261109',
      recoverLock: true,
    }),
    { code: 'LOCK_INVALID' },
  );
  assert.equal(await readFile(path, 'utf8'), 'broken-json');
  const clean = await journal(t);
  await assert.rejects(
    resumeLawRefresh(clean, {
      from: '20261109',
      through: '20261109',
      runDay: () => {
        throw Object.assign(
          new Error('OC=PRIVATE_CANARY password=PRIVATE_CANARY'),
          { code: 'PREVIEW_FAILED' },
        );
      },
    }),
    (error) => !error.message.includes('PRIVATE_CANARY'),
  );
  const status = await inspectRefreshJournal(clean);
  assert.equal(status.lastFailure.code, 'PREVIEW_FAILED');
  assert.ok(!JSON.stringify(status).includes('PRIVATE_CANARY'));
});
