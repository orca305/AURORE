import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  sourceDatabase,
  scratchDatabase,
  canonicalDefinition,
  databaseFingerprint,
  compareFingerprints,
  checkSequences,
  verifyBackup,
} from './verify-db-backup.mjs';
const source =
  'postgresql://aurore_dev_check:synthetic@127.0.0.1:5433/aurore_dev_check';
test('refuses remote sources and production or caller-selected restore targets', () => {
  for (const url of [
    'postgresql://aurore_dev_check:x@remote.test:5433/aurore_dev_check',
    'postgresql://aurore_dev_check:x@127.0.0.1:5433/other',
    'postgresql://other:x@127.0.0.1:5433/aurore_dev_check',
    'invalid',
  ])
    assert.throws(() => sourceDatabase(url), /SOURCE_INVALID/);
  assert.equal(sourceDatabase(source).pathname, '/aurore_dev_check');
  for (const target of [
    'aurore_dev_check',
    'postgres',
    'aurore_restore_check_../escape',
    'aurore_restore_check_123',
  ])
    assert.throws(() => scratchDatabase(target), /RESTORE_TARGET_INVALID/);
  assert.equal(
    scratchDatabase('aurore_restore_check_aabbccddeeff'),
    'aurore_restore_check_aabbccddeeff',
  );
});
test('normalizes only equivalent text-array DDL and preserves meaningful predicate changes', () => {
  const source =
    "WHERE ((stat_cd)::text = ANY ((ARRAY['QUEUED'::character varying, 'RUNNING'::character varying])::text[]))";
  const restored =
    "WHERE ((stat_cd)::text = ANY (ARRAY[('QUEUED'::character varying)::text, ('RUNNING'::character varying)::text]))";
  assert.equal(canonicalDefinition(source), canonicalDefinition(restored));
  const escaped =
    "ARRAY['a,b'::character varying, 'it''s'::character varying]::text[]";
  assert.equal(
    canonicalDefinition(escaped),
    "ARRAY['a,b'::text, 'it''s'::text]",
  );
  assert.notEqual(
    canonicalDefinition(source),
    canonicalDefinition(restored.replace('RUNNING', 'CANCELLED')),
  );
  for (const value of [
    "ARRAY['x'::character varying]",
    "ARRAY['ab'::character varying(1)]::text[]",
    "ARRAY[lower('X')]::text[]",
    "ARRAY['x'::character varying,]::text[]",
  ])
    assert.equal(canonicalDefinition(value), value);
});
test('detects equal-count data changes, structural changes and stale sequences', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE proof(id bigserial PRIMARY KEY,value text NOT NULL CHECK(length(value)>0)); INSERT INTO proof(value) VALUES ('first'),('second');",
    );
    const fingerprint = () => db.transaction((tx) => databaseFingerprint(tx));
    const before = await fingerprint();
    compareFingerprints(before, await fingerprint());
    assert.equal(await checkSequences(db), 1);
    await db.query("UPDATE proof SET value='changed' WHERE id=1");
    const after = await fingerprint();
    assert.equal(before.rows, after.rows);
    assert.throws(
      () => compareFingerprints(before, after),
      /RESTORE_CONTENT_MISMATCH/,
    );
    await db.query('CREATE INDEX idx_proof_value ON proof(value)');
    const structure = await fingerprint();
    assert.throws(
      () => compareFingerprints(after, structure),
      /RESTORE_SCHEMA_MISMATCH/,
    );
    await db.query("INSERT INTO proof(id,value) VALUES(99,'manual')");
    await assert.rejects(checkSequences(db), /SEQUENCE_INVALID/);
    await db.query("SELECT setval('proof_id_seq',99,true)");
    assert.equal(await checkSequences(db), 1);
  } finally {
    await db.close();
  }
});
test('rejects a corrupted archive before restore and replaces stale verification status with failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aurore-backup-check-'));
  try {
    const directory = join(root, 'aurore-db-20261116T000000Z-aabbccddeeff');
    await mkdir(directory);
    const bytes = Buffer.from('synthetic archive'),
      hash = createHash('sha256').update(bytes).digest('hex');
    const fingerprint = {
      tableCount: 1,
      rows: 0,
      schemaHash: 'a'.repeat(64),
      tables: [{ name: 'proof', count: 0, hash: 'b'.repeat(64) }],
    };
    await writeFile(
      join(directory, 'database.dump'),
      Buffer.from('Xynthetic archive'),
    );
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        version: 1,
        source: 'aurore_dev_check',
        createdAt: new Date().toISOString(),
        archiveHash: hash,
        archiveBytes: bytes.length,
        fingerprint,
      }),
    );
    await writeFile(
      join(directory, 'verification.json'),
      JSON.stringify({ status: 'VERIFIED' }),
    );
    await assert.rejects(
      verifyBackup(directory, { root, sourceUrl: source }),
      /ARCHIVE_INVALID/,
    );
    const report = JSON.parse(
      await readFile(join(directory, 'verification.json'), 'utf8'),
    );
    assert.equal(report.status, 'FAILED');
    assert.equal(report.errorCode, 'ARCHIVE_INVALID');
    assert.ok(!JSON.stringify(report).includes('synthetic'));
    await assert.rejects(
      verifyBackup(root, { root, sourceUrl: source }),
      /BACKUP_PATH_INVALID/,
    );
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  }
});
