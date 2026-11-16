import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { rotateBackups } from './verify-db-backup.mjs';
import { withRefreshLock } from './refresh-run-lock.mjs';
const now = new Date('2026-11-16T08:00:00Z');
async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), 'aurore-retention-'));
  try {
    const root = join(base, 'backups');
    await mkdir(root);
    await run(root, base);
  } finally {
    assert.ok(resolve(base).startsWith(resolve(tmpdir()) + sep));
    await rm(base, { recursive: true, force: true });
  }
}
let serial = 0;
async function archive(root, createdAt = now, verified = true) {
  const stamp = createdAt
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.[0-9]+Z$/, 'Z');
  const folder = join(
    root,
    'aurore-db-' + stamp + '-' + (++serial).toString(16).padStart(12, '0'),
  );
  await mkdir(folder);
  const bytes = Buffer.from('synthetic database backup ' + serial),
    hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(folder, 'database.dump'), bytes);
  await writeFile(
    join(folder, 'manifest.json'),
    JSON.stringify({
      version: 1,
      source: 'aurore_dev_check',
      createdAt: createdAt.toISOString(),
      archiveBytes: bytes.length,
      archiveHash: hash,
      fingerprint: {
        tableCount: 1,
        rows: 0,
        schemaHash: 'a'.repeat(64),
        tables: [{ name: 'proof', count: 0, hash: 'b'.repeat(64) }],
      },
    }),
  );
  if (verified)
    await writeFile(
      join(folder, 'verification.json'),
      JSON.stringify({
        version: 1,
        status: 'VERIFIED',
        verifiedAt: createdAt.toISOString(),
        archiveHash: hash,
        archiveBytes: bytes.length,
        archiveHashVerified: true,
        schemaVerified: true,
        contentsVerified: true,
      }),
    );
  return folder;
}
const daysAgo = (days) => new Date(now.valueOf() - days * 86400000);
test('removes only expired managed backups after a fresh verified backup, including the seven-day boundary', async () =>
  fixture(async (root) => {
    const current = await archive(root),
      old = await archive(root, daysAgo(8)),
      boundary = await archive(root, daysAgo(7), false),
      recent = await archive(root, new Date(daysAgo(7).valueOf() + 1));
    const empty = join(root, 'aurore-db-20261101T000000Z-eeeeeeeeeeee');
    await mkdir(empty);
    const result = await rotateBackups(root, current, { now });
    assert.equal(result.removed, 3);
    assert.equal(result.skipped, 0);
    for (const folder of [old, boundary, empty])
      await assert.rejects(stat(folder), { code: 'ENOENT' });
    assert.ok((await stat(join(current, 'database.dump'))).isFile());
    assert.ok((await stat(join(recent, 'database.dump'))).isFile());
  }));
test('keeps all old backups when the new proof is failed, stale or corrupted', async () =>
  fixture(async (root) => {
    const old = await archive(root, daysAgo(10)),
      current = await archive(root);
    await writeFile(
      join(current, 'verification.json'),
      JSON.stringify({ status: 'FAILED' }),
    );
    await assert.rejects(
      rotateBackups(root, current, { now }),
      /RETENTION_PROOF_REQUIRED/,
    );
    assert.ok((await stat(join(old, 'database.dump'))).isFile());
    const stale = await archive(root, daysAgo(2));
    await assert.rejects(
      rotateBackups(root, stale, { now }),
      /RETENTION_PROOF_REQUIRED/,
    );
    assert.ok((await stat(join(old, 'database.dump'))).isFile());
    const fresh = await archive(root);
    await writeFile(join(fresh, 'database.dump'), 'tampered');
    await assert.rejects(
      rotateBackups(root, fresh, { now }),
      /ARCHIVE_INVALID/,
    );
    assert.ok((await stat(join(old, 'database.dump'))).isFile());
  }));
test('preserves unknown files and redirects instead of following them outside the backup root', async () =>
  fixture(async (root, base) => {
    const current = await archive(root),
      notes = await archive(root, daysAgo(8));
    await writeFile(join(notes, 'keep.txt'), 'user note');
    const outside = join(base, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'protected.txt'), 'protected');
    const junction = join(root, 'aurore-db-20261101T000000Z-dddddddddddd');
    await symlink(outside, junction, 'junction');
    const result = await rotateBackups(root, current, { now });
    assert.equal(result.removed, 0);
    assert.equal(result.skipped, 2);
    assert.equal(await readFile(join(notes, 'keep.txt'), 'utf8'), 'user note');
    assert.equal(
      await readFile(join(outside, 'protected.txt'), 'utf8'),
      'protected',
    );
  }));
test('preserves modified or renamed archives and refuses a competing cleanup', async () =>
  fixture(async (root) => {
    const current = await archive(root),
      old = await archive(root, daysAgo(8));
    await writeFile(join(old, 'database.dump'), 'modified');
    const result = await rotateBackups(root, current, { now });
    assert.equal(result.skipped, 1);
    assert.ok((await stat(join(old, 'database.dump'))).isFile());
    await withRefreshLock(root, async () => {
      await assert.rejects(
        rotateBackups(root, current, { now }),
        /already claimed/,
      );
    });
  }));
