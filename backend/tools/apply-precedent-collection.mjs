import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withRefreshLock } from './refresh-run-lock.mjs';
import { readCollectedPrecedents } from './resume-precedent-collection.mjs';
import {
  parsePrecedent,
  importPrecedent,
} from './import-precedent-samples.mjs';

// Call with a dedicated connected client; the whole reviewed queue commits or rolls back together.
export async function applyPrecedentCollection(db, directory) {
  return withRefreshLock(directory, async () => {
    const { items, completed, pending } =
      await readCollectedPrecedents(directory);
    if (!items.length || pending.length)
      throw new Error('COLLECTION_INCOMPLETE');
    const records = [];
    for (const item of completed) {
      const bytes = await readFile(
        join(directory, 'snapshots', item.hash + '.json'),
      );
      const record = parsePrecedent({ target: 'prec', ...item }, bytes);
      if (record.hash !== item.hash) throw new Error('SNAPSHOT_INVALID');
      records.push(record);
    }
    await db.query('BEGIN');
    try {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))",
      );
      const results = [];
      for (const record of records)
        results.push(await importPrecedent(db, record));
      await db.query('COMMIT');
      return results;
    } catch {
      await db.query('ROLLBACK');
      throw new Error('APPLY_FAILED');
    }
  });
}
async function main() {
  const [directory, approval, ...extra] = process.argv.slice(2);
  if (directory === '--help' && !approval) {
    console.log(
      'Usage: node --env-file=local-dev/.env backend/tools/apply-precedent-collection.mjs <reviewed-journal-directory> --apply',
    );
    return;
  }
  if (!directory || approval !== '--apply' || extra.length)
    throw new Error('OPTIONS_INVALID');
  const url = URL.parse(process.env.DATABASE_URL ?? '');
  if (
    !url ||
    url.protocol !== 'postgresql:' ||
    url.host !== '127.0.0.1:5433' ||
    url.pathname !== '/aurore_dev_check'
  )
    throw new Error('DEVELOPMENT_DB_REQUIRED');
  const db = new pg.Client({
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
  });
  await db.connect();
  try {
    console.log(
      JSON.stringify(
        await applyPrecedentCollection(db, resolve(directory)),
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const allowed = new Set([
      'OPTIONS_INVALID',
      'DEVELOPMENT_DB_REQUIRED',
      'COLLECTION_INCOMPLETE',
      'SNAPSHOT_INVALID',
      'APPLY_FAILED',
      'BATCH_RUNNING',
      'RECOVERY_REQUIRED',
      'OTHER_HOST',
      'INVALID',
    ]);
    console.error(
      allowed.has(error.message)
        ? error.message
        : allowed.has(error.code)
          ? error.code
          : 'APPLY_FAILED',
    );
    process.exitCode = 1;
  }
}
