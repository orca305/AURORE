import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { refreshExecutionState } from './refresh-run-lock.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import {
  schedulerConfig,
  disabledSchedulerConfig,
  dailySlot,
  runSchedulerOnce,
  schedulerStatus,
} from './collection-scheduler.mjs';
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'aurore-scheduler-'));
  try {
    const config = {
      ...disabledSchedulerConfig(),
      enabled: true,
      law: {
        enabled: true,
        dailyAt: '03:00',
        journal: join(directory + '-law'),
        fromDate: '20261115',
      },
      precedent: {
        enabled: true,
        dailyAt: '04:00',
        directories: [join(directory + '-prec')],
      },
    };
    await writeFile(join(directory, 'config.json'), JSON.stringify(config));
    await run(directory, config);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}
const start = () => new Date('2026-11-16T01:00:00Z');
test('uses Korean daily slots across UTC midnight and leap days', () => {
  assert.equal(
    dailySlot(new Date('2026-11-15T17:59:00Z'), '03:00'),
    '2026-11-14T18:00:00.000Z',
  );
  assert.equal(
    dailySlot(new Date('2026-11-15T18:00:00Z'), '03:00'),
    '2026-11-15T18:00:00.000Z',
  );
  assert.equal(
    dailySlot(new Date('2024-02-29T16:00:00Z'), '04:00'),
    '2024-02-28T19:00:00.000Z',
  );
});
test('runs each due task once, catches up after downtime and hides private configuration', async () =>
  fixture(async (directory) => {
    let time = start(),
      law = 0,
      prec = 0;
    const options = {
      now: () => time,
      runLaw: async () => {
        law++;
        return { processed: 1, hasBacklog: false };
      },
      runPrecedent: async () => {
        prec++;
        return { processed: 20, hasBacklog: false };
      },
    };
    let state = await runSchedulerOnce(directory, options);
    assert.deepEqual([law, prec], [1, 1]);
    assert.ok(
      state.jobs
        .filter((job) => job.enabled)
        .every((job) => job.status === 'SUCCEEDED'),
    );
    assert.ok(!JSON.stringify(state).includes(directory));
    assert.ok(!JSON.stringify(state).includes('journal'));
    assert.ok(!JSON.stringify(state).includes('token'));
    await runSchedulerOnce(directory, options);
    assert.deepEqual([law, prec], [1, 1]);
    time = new Date(time.valueOf() + 3 * 86400000);
    state = await runSchedulerOnce(directory, options);
    assert.deepEqual([law, prec], [2, 2]);
    assert.equal(state.jobs[0].attempts, 1);
  }));
test('waits before retrying, stops at three failures per slot and keeps fixed error categories', async () =>
  fixture(async (directory) => {
    let time = start(),
      calls = 0;
    const options = {
      now: () => time,
      runLaw: async () => {
        calls++;
        throw new Error('SECRET_API_URL_WITH_OC');
      },
      runPrecedent: async () => ({ processed: 0, hasBacklog: false }),
    };
    let state = await runSchedulerOnce(directory, options);
    assert.equal(state.jobs[0].code, 'RUN_FAILED');
    await runSchedulerOnce(directory, options);
    assert.equal(calls, 1);
    for (let i = 0; i < 3; i++) {
      time = new Date(time.valueOf() + 61 * 60000);
      state = await runSchedulerOnce(directory, options);
    }
    assert.equal(calls, 3);
    assert.equal(state.jobs[0].attempts, 3);
    assert.equal(state.jobs[0].failures, 3);
    assert.ok(
      !(await readFile(join(directory, 'monitor.json'), 'utf8')).includes(
        'SECRET',
      ),
    );
    time = new Date(start().valueOf() + 86400000);
    state = await runSchedulerOnce(directory, options);
    assert.equal(calls, 4);
    assert.equal(state.jobs[0].attempts, 1);
    assert.equal(state.jobs[0].failures, 4);
  }));
test('resumes bounded backlogs after fifteen minutes and resets the failure streak on success', async () =>
  fixture(async (directory) => {
    let time = start(),
      calls = 0;
    const options = {
      now: () => time,
      runLaw: async () => {
        calls++;
        if (calls === 1)
          throw Object.assign(new Error('private'), {
            code: 'RECOVERY_REQUIRED',
          });
        return { processed: 7, hasBacklog: calls === 2 };
      },
      runPrecedent: async () => ({ processed: 0, hasBacklog: false }),
    };
    assert.equal(
      (await runSchedulerOnce(directory, options)).jobs[0].code,
      'RECOVERY_REQUIRED',
    );
    time = new Date(time.valueOf() + 60 * 60000);
    let state = await runSchedulerOnce(directory, options);
    assert.equal(state.jobs[0].status, 'BACKLOG');
    assert.equal(state.jobs[0].attempts, 0);
    assert.equal(state.jobs[0].failures, 0);
    await runSchedulerOnce(directory, options);
    assert.equal(calls, 2);
    time = new Date(time.valueOf() + 15 * 60000);
    state = await runSchedulerOnce(directory, options);
    assert.equal(state.jobs[0].status, 'SUCCEEDED');
    assert.equal(calls, 3);
  }));
test('never starts a competing tick and displays a live worker while running', async () =>
  fixture(async (directory) => {
    let enter, release;
    const entered = new Promise((done) => {
        enter = done;
      }),
      gate = new Promise((done) => {
        release = done;
      });
    const running = runSchedulerOnce(directory, {
      now: start,
      runLaw: async () => {
        enter();
        await gate;
        return { processed: 0, hasBacklog: false };
      },
      runPrecedent: async () => ({ processed: 0, hasBacklog: false }),
    });
    await entered;
    try {
      assert.equal(
        (await schedulerStatus(directory, start())).worker,
        'RUNNING',
      );
      await assert.rejects(
        runSchedulerOnce(directory, { now: start }),
        /already claimed/,
      );
    } finally {
      release();
      await running;
    }
    assert.equal(
      (await schedulerStatus(directory, start())).worker,
      'NOT_RUNNING',
    );
  }));
test('does not run disabled tasks, rejects overlapping storage and detects corrupted state', async () =>
  fixture(async (directory, config) => {
    config.enabled = false;
    await writeFile(join(directory, 'config.json'), JSON.stringify(config));
    let calls = 0;
    await runSchedulerOnce(directory, {
      now: start,
      runLaw: async () => {
        calls++;
      },
    });
    assert.equal(calls, 0);
    assert.equal(
      (await schedulerStatus(directory, start())).worker,
      'DISABLED',
    );
    config.enabled = true;
    config.law.journal = directory;
    await writeFile(join(directory, 'config.json'), JSON.stringify(config));
    await assert.rejects(
      runSchedulerOnce(directory, { now: start }),
      /CONFIG_INVALID/,
    );
    await writeFile(join(directory, 'monitor.json'), 'PRIVATE_BAD_STATE');
    await assert.rejects(schedulerStatus(directory), /STATE_INVALID/);
  }));
test('validates configuration and resets an edited task without disclosing its paths', async () =>
  fixture(async (directory, config) => {
    for (const invalid of [
      { ...config, version: 2 },
      { ...config, enabled: 'yes' },
      { ...config, law: { ...config.law, dailyAt: '25:00' } },
      { ...config, law: { ...config.law, fromDate: '20260230' } },
      {
        ...config,
        precedent: { ...config.precedent, directories: ['../escape'] },
      },
    ])
      assert.throws(() => schedulerConfig(invalid), /CONFIG_INVALID/);
    const options = {
      now: start,
      runLaw: async () => ({ processed: 1, hasBacklog: false }),
      runPrecedent: async () => ({ processed: 0, hasBacklog: false }),
    };
    await runSchedulerOnce(directory, options);
    config.law.dailyAt = '05:00';
    await writeFile(join(directory, 'config.json'), JSON.stringify(config));
    assert.equal(
      (await schedulerStatus(directory, start())).jobs[0].status,
      'NOT_RUN',
    );
    await runSchedulerOnce(directory, options);
    assert.equal(
      (await schedulerStatus(directory, start())).jobs[0].status,
      'SUCCEEDED',
    );
  }));

test('an interrupted watcher requires explicit verified recovery and preserves monitor state', async () =>
  fixture(async (directory, config) => {
    config.enabled = false;
    await writeFile(join(directory, 'config.json'), JSON.stringify(config));
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./collection-scheduler.mjs', import.meta.url)),
        directory,
        '--watch',
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    try {
      let ready = false;
      for (let i = 0; i < 80; i++) {
        try {
          if (
            (await readFile(join(directory, 'monitor.json'), 'utf8')).includes(
              'heartbeatAt',
            )
          ) {
            ready = true;
            break;
          }
        } catch {}
        await delay(25);
      }
      assert.ok(ready);
    } finally {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    assert.equal(
      (await refreshExecutionState(directory)).status,
      'RECOVERY_REQUIRED',
    );
    await assert.rejects(runSchedulerOnce(directory), /already claimed/);
    await runSchedulerOnce(directory, { recoverLock: true });
    assert.equal((await refreshExecutionState(directory)).status, 'IDLE');
  }));

test('runs scheduled backup once per slot and does not advance success after failed verification', async () =>
  fixture(async (directory, config) => {
    config.backup = {
      enabled: true,
      dailyAt: '02:00',
      root: directory + '-backups',
    };
    await writeFile(join(directory, 'config.json'), JSON.stringify(config));
    let time = start(),
      calls = 0;
    const options = {
      now: () => time,
      runLaw: async () => ({ processed: 0, hasBacklog: false }),
      runPrecedent: async () => ({ processed: 0, hasBacklog: false }),
      runBackup: async () => {
        calls++;
        if (calls === 1) throw new Error('PRIVATE_BACKUP_DIAGNOSTIC');
        return { processed: 1, hasBacklog: false, retentionRemoved: 2 };
      },
    };
    let state = await runSchedulerOnce(directory, options);
    assert.equal(state.jobs[2].kind, 'backup');
    assert.equal(state.jobs[2].status, 'FAILED');
    assert.equal(state.jobs[2].code, 'BACKUP_FAILED');
    assert.equal(state.jobs[2].lastSuccessAt, null);
    time = new Date(time.valueOf() + 60 * 60000);
    state = await runSchedulerOnce(directory, options);
    assert.equal(state.jobs[2].status, 'SUCCEEDED');
    assert.equal(state.jobs[2].retentionRemoved, 2);
    assert.equal(state.jobs[2].processed, 1);
    assert.ok(!JSON.stringify(state).includes(config.backup.root));
    assert.ok(!JSON.stringify(state).includes('PRIVATE_BACKUP_DIAGNOSTIC'));
    await runSchedulerOnce(directory, options);
    assert.equal(calls, 2);
  }));
