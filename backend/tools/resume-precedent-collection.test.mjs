import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  resumePrecedentCollection as resume,
  precedentCollectionStatus as status,
  validatePrecedentQueue,
} from './resume-precedent-collection.mjs';
import { applyPrecedentCollection } from './apply-precedent-collection.mjs';

const queue = [
  { ID: '11', caseNumber: '2026다11' },
  { ID: '22', caseNumber: '2026다22' },
];
function bytes(item, text = '검증용 원문') {
  return Buffer.from(
    JSON.stringify({
      PrecService: {
        판례정보일련번호: item.ID,
        사건번호: item.caseNumber,
        사건명: '검증용 사건',
        법원명: '대법원',
        선고일자: '20260101',
        판례내용: text,
      },
    }),
  );
}
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'aurore-prec-collection-'));
  try {
    await run(directory);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}
test('fixed queue resumes only pending cases, suppresses raw errors and validates stored originals', async () =>
  fixture(async (directory) => {
    assert.equal((await status(directory)).initialized, false);
    const calls = [];
    const readSource = async (item) => {
      calls.push(item.ID);
      return { bytes: bytes(item) };
    };
    const first = await resume(directory, { queue, limit: 1, readSource });
    assert.equal(first.completed, 1);
    assert.equal(first.execution.status, 'IDLE');
    await assert.rejects(
      resume(directory, { queue: [...queue].reverse(), readSource }),
      /QUEUE_CHANGED/,
    );
    await assert.rejects(
      resume(directory, {
        readSource: async () => {
          throw new Error('SECRET_API_URL');
        },
      }),
      /SOURCE_READ_FAILED/,
    );
    const failed = await status(directory);
    assert.equal(failed.nextId, '22');
    assert.equal(failed.lastFailure.code, 'SOURCE_READ_FAILED');
    assert.ok(!JSON.stringify(failed).includes('SECRET'));
    for (const name of await readdir(directory))
      if (name.includes('.failed-'))
        assert.ok(
          !(await readFile(join(directory, name), 'utf8')).includes('SECRET'),
        );
    assert.equal((await resume(directory, { readSource })).remaining, 0);
    assert.equal((await resume(directory, { readSource })).collected.length, 0);
    assert.deepEqual(calls, ['11', '22']);
    assert.equal((await status(directory)).execution.status, 'IDLE');
    const saved = JSON.parse(
      await readFile(join(directory, '11.json'), 'utf8'),
    );
    await writeFile(
      join(directory, 'snapshots', saved.hash + '.json'),
      bytes(queue[0], '改ざん'),
    );
    await assert.rejects(status(directory), /SNAPSHOT_INVALID/);
  }));
test('rejects invalid queues and mismatched API identity without completing an item', async () =>
  fixture(async (directory) => {
    for (const value of [
      [],
      [...queue, queue[0]],
      [{ ID: '../escape', caseNumber: 'x' }],
      [{ ...queue[0], url: 'https://untrusted.test' }],
    ])
      assert.throws(() => validatePrecedentQueue(value), /QUEUE_INVALID/);
    await assert.rejects(
      resume(directory, { queue, limit: 0 }),
      /LIMIT_INVALID/,
    );
    await assert.rejects(
      resume(directory, {
        queue,
        readSource: async () => ({ bytes: bytes(queue[1]) }),
      }),
      /SOURCE_INVALID/,
    );
    assert.equal((await status(directory)).completed, 0);
    assert.equal((await status(directory)).lastFailure.code, 'SOURCE_INVALID');
  }));
test('blocks a simultaneous collector before a second request', async () =>
  fixture(async (directory) => {
    let entered, release;
    const started = new Promise((done) => {
      entered = done;
    });
    const gate = new Promise((done) => {
      release = done;
    });
    let calls = 0;
    const readSource = async (item) => {
      calls++;
      entered();
      await gate;
      return { bytes: bytes(item) };
    };
    const running = resume(directory, { queue, readSource });
    await started;
    try {
      assert.equal((await status(directory)).execution.status, 'RUNNING');
      await assert.rejects(
        resume(directory, { recoverLock: true, readSource }),
        /still running/,
      );
      assert.equal(calls, 1);
    } finally {
      release();
      await running;
    }
  }));
test('recovers after process termination and preserves the completed prefix', async () =>
  fixture(async (directory) => {
    await resume(directory, {
      queue,
      limit: 1,
      readSource: async (item) => ({ bytes: bytes(item) }),
    });
    const module = new URL('./resume-precedent-collection.mjs', import.meta.url)
      .href;
    const source = `import { resumePrecedentCollection } from ${JSON.stringify(module)}; await resumePrecedentCollection(${JSON.stringify(directory)}, { readSource: async () => process.exit(17) });`;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', source],
      { windowsHide: true, stdio: 'ignore' },
    );
    assert.equal((await once(child, 'exit'))[0], 17);
    assert.equal(
      (await status(directory)).execution.status,
      'RECOVERY_REQUIRED',
    );
    await assert.rejects(
      resume(directory, {
        readSource: async () => {
          throw new Error('must not run');
        },
      }),
    );
    const called = [];
    await resume(directory, {
      recoverLock: true,
      readSource: async (item) => {
        called.push(item.ID);
        return { bytes: bytes(item) };
      },
    });
    assert.deepEqual(called, ['22']);
    assert.equal((await status(directory)).execution.status, 'IDLE');
  }));
test('explicit application uses verified snapshots, is idempotent and rolls back the whole queue', async () =>
  fixture(async (directory) => {
    const db = new PGlite();
    try {
      const migrations = new URL('../prisma/migrations/', import.meta.url);
      for (const name of (await readdir(migrations))
        .filter((name) => /^\d{14}_/.test(name))
        .sort())
        await db.exec(
          await readFile(new URL(name + '/migration.sql', migrations), 'utf8'),
        );
      await resume(directory, {
        queue,
        limit: 1,
        readSource: async (item) => ({ bytes: bytes(item) }),
      });
      await assert.rejects(
        applyPrecedentCollection(db, directory),
        /COLLECTION_INCOMPLETE/,
      );
      await resume(directory, {
        readSource: async (item) => ({ bytes: bytes(item) }),
      });
      const failSecond = {
        query(sql, values) {
          if (
            sql.startsWith('INSERT INTO legal_prec_rev') &&
            values[3] === queue[1].caseNumber
          )
            throw new Error('PRIVATE_DATABASE_ERROR');
          return db.query(sql, values);
        },
      };
      await assert.rejects(
        applyPrecedentCollection(failSecond, directory),
        /APPLY_FAILED/,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM legal_prec')).rows[0].n,
        0,
      );
      assert.deepEqual(
        (await applyPrecedentCollection(db, directory)).map(
          (row) => row.status,
        ),
        ['saved', 'saved'],
      );
      assert.deepEqual(
        (await applyPrecedentCollection(db, directory)).map(
          (row) => row.status,
        ),
        ['duplicate', 'duplicate'],
      );
      const saved = JSON.parse(
        await readFile(join(directory, '22.json'), 'utf8'),
      );
      await writeFile(
        join(directory, 'snapshots', saved.hash + '.json'),
        bytes(queue[1], 'tampered'),
      );
      await assert.rejects(
        applyPrecedentCollection(db, directory),
        /SNAPSHOT_INVALID/,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM legal_prec_rev'))
          .rows[0].n,
        2,
      );
    } finally {
      await db.close();
    }
  }));
