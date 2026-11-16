import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  writeFile,
  stat,
  lstat,
  realpath,
  unlink,
  rename,
  readdir,
  rmdir,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, isAbsolute, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { withRefreshLock } from './refresh-run-lock.mjs';
const exec = promisify(execFile),
  container = 'aurore-dev-check-postgres',
  user = 'aurore_dev_check';
const fail = (code) => Object.assign(new Error(code), { code });
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const defaultBackupRoot = join(
  process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'),
  'AURORE',
  'backups',
);
const id = (value) => '"' + String(value).replaceAll('"', '""') + '"';
export function sourceDatabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail('SOURCE_INVALID');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.host !== '127.0.0.1:5433' ||
    url.pathname !== '/aurore_dev_check' ||
    url.username !== user
  )
    throw fail('SOURCE_INVALID');
  return url;
}
export function scratchDatabase(name) {
  if (!/^aurore_restore_check_[0-9a-f]{12}$/.test(name))
    throw fail('RESTORE_TARGET_INVALID');
  return name;
}
async function docker(args) {
  try {
    return (
      await exec('docker', args, {
        windowsHide: true,
        timeout: 300000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout;
  } catch {
    throw fail('DOCKER_COMMAND_FAILED');
  }
}
export async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function durableWrite(path, content) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function privateJson(path, value, exclusive = false) {
  const content = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) {
    await durableWrite(path, content);
    return;
  }
  const temporary = path + '.' + randomUUID() + '.part';
  try {
    await durableWrite(temporary, content);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
// PostgreSQL can push varchar[] -> text[] casts into each literal when restoring DDL.
// Normalize only unlimited varchar string literals whose final array type is explicitly text[].
export function canonicalDefinition(definition) {
  const content = "((?:[^\\]']|'(?:[^']|'')*')*)";
  const array = new RegExp('ARRAY\\[' + content + '\\]', 'g');
  const normalized = (items, wholeText) => {
    const tokens = [];
    let position = 0;
    const item =
      /\s*(?:\(('(?:[^']|'')*')::character varying\)::text|('(?:[^']|'')*')::character varying(::text)?)\s*(,|$)/y;
    while (position < items.length) {
      item.lastIndex = position;
      const match = item.exec(items);
      if (!match) return null;
      tokens.push({
        literal: match[1] ?? match[2],
        text: !!match[1] || !!match[3],
      });
      position = item.lastIndex;
      if (match[4] === ',' && position === items.length) return null;
    }
    if (!tokens.length || (!wholeText && tokens.some((token) => !token.text)))
      return null;
    return (
      'ARRAY[' +
      tokens.map((token) => token.literal + '::text').join(', ') +
      ']'
    );
  };
  definition = definition.replace(
    new RegExp('\\(ARRAY\\[' + content + '\\]\\)::text\\[\\]', 'g'),
    (all, items) => normalized(items, true) ?? all,
  );
  definition = definition.replace(
    new RegExp('ARRAY\\[' + content + '\\]::text\\[\\]', 'g'),
    (all, items) => normalized(items, true) ?? all,
  );
  return definition.replace(
    array,
    (all, items) => normalized(items, false) ?? all,
  );
}
export async function databaseFingerprint(db) {
  const tables = (
    await db.query(
      "SELECT c.relname AS name, ARRAY(SELECT a.attname::text FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indrelid=c.oid AND i.indisprimary ORDER BY k.ord) AS keys FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname",
    )
  ).rows;
  const rows = [];
  for (const table of tables) {
    if (!table.keys.length) throw fail('PRIMARY_KEY_REQUIRED');
    await db.query(
      'DECLARE backup_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS value FROM public.' +
        id(table.name) +
        ' t ORDER BY ' +
        table.keys.map(id).join(','),
    );
    const hash = createHash('sha256');
    let count = 0;
    try {
      while (true) {
        const batch = await db.query('FETCH FORWARD 256 FROM backup_rows');
        if (!batch.rows.length) break;
        for (const row of batch.rows) {
          hash.update(String(Buffer.byteLength(row.value)) + ':');
          hash.update(row.value);
          count++;
        }
      }
    } finally {
      await db.query('CLOSE backup_rows');
    }
    rows.push({ name: table.name, count, hash: hash.digest('hex') });
  }
  const columns = (
    await db.query(
      "SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,datetime_precision,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    )
  ).rows;
  const indexes = (
    await db.query(
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
    )
  ).rows;
  const constraints = (
    await db.query(
      "SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid,true) AS definition,con.convalidated FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname",
    )
  ).rows;
  const extensions = (
    await db.query(
      'SELECT extname,extversion FROM pg_extension ORDER BY extname',
    )
  ).rows;
  const sequences = (
    await db.query(
      "SELECT sequencename,data_type::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
    )
  ).rows;
  const functions = (
    await db.query(
      "SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname,arguments",
    )
  ).rows;
  const triggers = (
    await db.query(
      "SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
    )
  ).rows;
  const positions = new Map();
  for (const column of columns) {
    const position = (positions.get(column.table_name) ?? 0) + 1;
    positions.set(column.table_name, position);
    column.ordinal_position = position;
  }
  for (const index of indexes)
    index.indexdef = canonicalDefinition(index.indexdef);
  for (const constraint of constraints)
    constraint.definition = canonicalDefinition(constraint.definition);
  const schemaParts = Object.fromEntries(
    Object.entries({
      columns,
      indexes,
      constraints,
      extensions,
      sequences,
      functions,
      triggers,
    }).map(([key, value]) => [key, digest(value)]),
  );
  return {
    tables: rows,
    schemaParts,
    schemaHash: digest(schemaParts),
    rows: rows.reduce((sum, row) => sum + row.count, 0),
    tableCount: rows.length,
  };
}

export function compareFingerprints(expected, actual) {
  if (!expected || expected.schemaHash !== actual.schemaHash)
    throw Object.assign(fail('RESTORE_SCHEMA_MISMATCH'), {
      sections: Object.keys(actual.schemaParts).filter(
        (key) => expected?.schemaParts?.[key] !== actual.schemaParts[key],
      ),
    });
  if (JSON.stringify(expected.tables) !== JSON.stringify(actual.tables))
    throw fail('RESTORE_CONTENT_MISMATCH');
}

export async function checkSequences(db) {
  const owned = (
    await db.query(
      "SELECT s.relname AS sequence_name,t.relname AS table_name,a.attname AS column_name,q.increment_by,q.cycle FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_sequences q ON q.schemaname=n.nspname AND q.sequencename=s.relname JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE n.nspname='public' AND s.relkind='S' ORDER BY s.relname",
    )
  ).rows;
  for (const item of owned) {
    if (BigInt(item.increment_by) <= 0n || item.cycle)
      throw fail('SEQUENCE_UNSUPPORTED');
    const sequence = (
      await db.query(
        'SELECT last_value::text,is_called FROM public.' +
          id(item.sequence_name),
      )
    ).rows[0];
    const maximum = (
      await db.query(
        'SELECT max(' +
          id(item.column_name) +
          ')::text AS value FROM public.' +
          id(item.table_name),
      )
    ).rows[0].value;
    const next =
      BigInt(sequence.last_value) +
      (sequence.is_called ? BigInt(item.increment_by) : 0n);
    if (maximum !== null && next <= BigInt(maximum))
      throw fail('SEQUENCE_INVALID');
  }
  return owned.length;
}
async function connect(url) {
  const db = new pg.Client({
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
  });
  await db.connect();
  await db.query("SET TIME ZONE 'UTC'");
  return db;
}
async function smoke(url) {
  const { createRequire } = await import('node:module'),
    require = createRequire(import.meta.url);
  require('reflect-metadata');
  const { ConfigService } = require('@nestjs/config');
  const { PrismaService } = await import('../dist/prisma/prisma.service.js'),
    { LegalService } = await import('../dist/legal/legal.service.js');
  const db = new PrismaService(new ConfigService({ DATABASE_URL: url.href }));
  try {
    await db.$connect();
    const service = new LegalService(db),
      query = { q: '', offset: 0, limit: 10 };
    const laws = await service.findAll(query),
      precedents = await service.precedents(query);
    let versions = 0;
    if (laws.length) {
      const list = await service.versions(BigInt(laws[0].id), query);
      versions = Array.isArray(list) ? list.length : (list.items?.length ?? 0);
    }
    return { laws: laws.length, precedents: precedents.length, versions };
  } finally {
    await db.$disconnect();
  }
}
async function validArchive(root, directory) {
  const base = await realpath(root),
    folder = await realpath(directory),
    rel = relative(base, folder);
  if (
    !/^aurore-db-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/.test(rel) ||
    isAbsolute(rel) ||
    rel.includes(sep)
  )
    throw fail('BACKUP_PATH_INVALID');
  for (const file of ['database.dump', 'manifest.json']) {
    const info = await lstat(join(folder, file));
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      relative(folder, await realpath(join(folder, file))) !== file
    )
      throw fail('BACKUP_PATH_INVALID');
  }
  const manifest = JSON.parse(
    await readFile(join(folder, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    manifest.source !== 'aurore_dev_check' ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !/^[a-f0-9]{64}$/.test(manifest.archiveHash) ||
    !Number.isSafeInteger(manifest.archiveBytes) ||
    manifest.archiveBytes < 1
  )
    throw fail('MANIFEST_INVALID');
  const fingerprint = manifest.fingerprint;
  if (
    !fingerprint ||
    !/^[a-f0-9]{64}$/.test(fingerprint.schemaHash ?? '') ||
    !Array.isArray(fingerprint.tables) ||
    !fingerprint.tables.length ||
    fingerprint.tableCount !== fingerprint.tables.length ||
    fingerprint.tables.some(
      (table) =>
        typeof table.name !== 'string' ||
        !Number.isSafeInteger(table.count) ||
        table.count < 0 ||
        !/^[a-f0-9]{64}$/.test(table.hash ?? ''),
    ) ||
    fingerprint.rows !==
      fingerprint.tables.reduce((sum, table) => sum + table.count, 0)
  )
    throw fail('MANIFEST_INVALID');
  if (
    (await stat(join(folder, 'database.dump'))).size !==
      manifest.archiveBytes ||
    (await fileHash(join(folder, 'database.dump'))) !== manifest.archiveHash
  )
    throw fail('ARCHIVE_INVALID');
  return { folder, manifest };
}
async function verifyTrustedBackup(
  directory,
  { root = defaultBackupRoot, sourceUrl = process.env.DATABASE_URL } = {},
) {
  const source = sourceDatabase(sourceUrl),
    { folder, manifest } = await validArchive(
      resolve(root),
      resolve(directory),
    );
  const name = scratchDatabase(
      'aurore_restore_check_' + randomBytes(6).toString('hex'),
    ),
    target = new URL(source.href);
  target.pathname = '/' + name;
  const temporary =
    '/tmp/aurore-verify-' + randomBytes(12).toString('hex') + '.dump';
  let created = false,
    copied = false,
    db,
    report;
  try {
    await docker([
      'cp',
      join(folder, 'database.dump'),
      container + ':' + temporary,
    ]);
    copied = true;
    await docker([
      'exec',
      container,
      'createdb',
      '-U',
      user,
      '--template=template0',
      name,
    ]);
    created = true;
    await docker([
      'exec',
      container,
      'pg_restore',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      '-U',
      user,
      '-d',
      name,
      temporary,
    ]);
    db = await connect(target);
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actual = await databaseFingerprint(db);
    compareFingerprints(manifest.fingerprint, actual);
    const sequences = await checkSequences(db);
    await db.query('COMMIT');
    const queries = await smoke(target);
    report = {
      version: 1,
      status: 'VERIFIED',
      verifiedAt: new Date().toISOString(),
      tables: actual.tableCount,
      rows: actual.rows,
      sequences,
      archiveBytes: manifest.archiveBytes,
      archiveHash: manifest.archiveHash,
      archiveHashVerified: true,
      schemaVerified: true,
      contentsVerified: true,
      queries,
    };
  } finally {
    await db?.end();
    if (created)
      await docker([
        'exec',
        container,
        'dropdb',
        '--force',
        '-U',
        user,
        scratchDatabase(name),
      ]);
    if (copied) await docker(['exec', container, 'rm', '--', temporary]);
  }
  await privateJson(join(folder, 'verification.json'), report);
  return report;
}
const safeCodes = new Set([
  'SOURCE_INVALID',
  'RESTORE_TARGET_INVALID',
  'BACKUP_PATH_INVALID',
  'MANIFEST_INVALID',
  'ARCHIVE_INVALID',
  'RESTORE_SCHEMA_MISMATCH',
  'RESTORE_CONTENT_MISMATCH',
  'SEQUENCE_INVALID',
  'SEQUENCE_UNSUPPORTED',
  'MIGRATION_IN_PROGRESS',
  'LARGE_OBJECTS_UNSUPPORTED',
  'POSTGRES_VERSION_INVALID',
  'OPTIONS_INVALID',
  'DOCKER_COMMAND_FAILED',
  'PRIMARY_KEY_REQUIRED',
  'BATCH_RUNNING',
  'RECOVERY_REQUIRED',
  'RETENTION_PROOF_REQUIRED',
  'RETENTION_FAILED',
]);
export async function verifyBackup(directory, options = {}) {
  try {
    return await verifyTrustedBackup(directory, options);
  } catch (error) {
    try {
      const root = await realpath(options.root ?? defaultBackupRoot),
        folder = await realpath(directory),
        rel = relative(root, folder);
      if (
        /^aurore-db-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/.test(rel) &&
        !isAbsolute(rel) &&
        !rel.includes(sep)
      )
        await privateJson(join(folder, 'verification.json'), {
          version: 1,
          status: 'FAILED',
          checkedAt: new Date().toISOString(),
          errorCode: safeCodes.has(error.code)
            ? error.code
            : 'BACKUP_VERIFICATION_FAILED',
        });
    } catch {}
    throw error;
  }
}
const backupName = /^aurore-db-([0-9]{8}T[0-9]{6}Z)-[0-9a-f]{12}$/;
function backupStamp(date) {
  return date
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.[0-9]+Z$/, 'Z');
}
function stampDate(value) {
  const match =
    /^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/.exec(
      value,
    );
  if (!match) return null;
  const date = new Date(
    match[1] +
      '-' +
      match[2] +
      '-' +
      match[3] +
      'T' +
      match[4] +
      ':' +
      match[5] +
      ':' +
      match[6] +
      'Z',
  );
  return Number.isFinite(date.valueOf()) && backupStamp(date) === value
    ? date
    : null;
}
async function rotateManagedBackups(root, current, { now = new Date() } = {}) {
  root = await realpath(root);
  const { folder: protectedFolder, manifest: latest } = await validArchive(
    root,
    current,
  );
  const proof = JSON.parse(
    await readFile(join(protectedFolder, 'verification.json'), 'utf8'),
  );
  const age = now.valueOf() - Date.parse(latest.createdAt);
  if (
    proof.status !== 'VERIFIED' ||
    proof.archiveHash !== latest.archiveHash ||
    proof.archiveBytes !== latest.archiveBytes ||
    proof.archiveHashVerified !== true ||
    proof.schemaVerified !== true ||
    proof.contentsVerified !== true ||
    !Number.isFinite(Date.parse(proof.verifiedAt)) ||
    Date.parse(proof.verifiedAt) < Date.parse(latest.createdAt) ||
    Date.parse(proof.verifiedAt) > now.valueOf() + 300000 ||
    age < -300000 ||
    age >= 86400000 ||
    now.valueOf() - Date.parse(proof.verifiedAt) > 86400000
  )
    throw fail('RETENTION_PROOF_REQUIRED');
  const result = { days: 7, removed: 0, retained: 0, skipped: 0 };
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const match = backupName.exec(entry.name);
    if (!match) continue;
    const date = stampDate(match[1]);
    if (!date || date.valueOf() > now.valueOf() - 7 * 86400000) {
      result.retained++;
      continue;
    }
    const target = resolve(root, entry.name);
    // Validate the exact absolute child before any deletion. Never follow a link or recursively delete.
    if (target === protectedFolder) {
      result.retained++;
      continue;
    }
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      relative(root, target) !== entry.name ||
      (await realpath(target)) !== target
    ) {
      result.skipped++;
      continue;
    }
    const names = await readdir(target);
    if (!names.length) {
      await rmdir(target);
      result.removed++;
      continue;
    }
    if (
      names.some(
        (name) =>
          !['database.dump', 'manifest.json', 'verification.json'].includes(
            name,
          ),
      ) ||
      !names.includes('database.dump') ||
      !names.includes('manifest.json')
    ) {
      result.skipped++;
      continue;
    }
    try {
      const { manifest } = await validArchive(root, target);
      if (backupStamp(new Date(manifest.createdAt)) !== match[1])
        throw fail('RETENTION_CANDIDATE_INVALID');
      if (Date.parse(manifest.createdAt) > now.valueOf() - 7 * 86400000) {
        result.retained++;
        continue;
      }
      for (const name of names) {
        const file = join(target, name),
          info = await lstat(file);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          relative(target, await realpath(file)) !== name
        )
          throw fail('RETENTION_CANDIDATE_INVALID');
      }
    } catch {
      result.skipped++;
      continue;
    }
    try {
      // Old dump first: an interrupted cleanup must not leave an untracked data archive behind.
      for (const name of [
        'database.dump',
        'manifest.json',
        'verification.json',
      ])
        if (names.includes(name)) await unlink(join(target, name));
      await rmdir(target);
      result.removed++;
    } catch {
      throw fail('RETENTION_FAILED');
    }
  }
  return result;
}
export async function rotateBackups(root, current, options = {}) {
  root = await realpath(root);
  return withRefreshLock(root, () =>
    rotateManagedBackups(root, current, options),
  );
}
export async function backupAndVerify({
  root = defaultBackupRoot,
  sourceUrl = process.env.DATABASE_URL,
  recoverLock = false,
} = {}) {
  if (!isAbsolute(root)) throw fail('BACKUP_PATH_INVALID');
  root = resolve(root);
  const url = sourceDatabase(sourceUrl);
  await mkdir(root, { recursive: true, mode: 0o700 });
  return withRefreshLock(
    root,
    async () => {
      const db = await connect(url);
      let folder, temporary;
      try {
        await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const version = Number(
          (
            await db.query(
              "SELECT current_setting('server_version_num') AS version",
            )
          ).rows[0].version,
        );
        if (version < 170000 || version >= 180000)
          throw fail('POSTGRES_VERSION_INVALID');
        if (
          Number(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL',
              )
            ).rows[0].n,
          )
        )
          throw fail('MIGRATION_IN_PROGRESS');
        if (
          Number(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM pg_largeobject_metadata',
              )
            ).rows[0].n,
          )
        )
          throw fail('LARGE_OBJECTS_UNSUPPORTED');
        const snapshot = (
          await db.query('SELECT pg_export_snapshot() AS value')
        ).rows[0].value;
        const createdAt = new Date().toISOString(),
          stamp = createdAt
            .replaceAll('-', '')
            .replaceAll(':', '')
            .replace(/\.[0-9]+Z$/, 'Z');
        folder = join(
          root,
          'aurore-db-' + stamp + '-' + randomBytes(6).toString('hex'),
        );
        await mkdir(folder, { mode: 0o700 });
        temporary =
          '/tmp/aurore-backup-' + randomBytes(12).toString('hex') + '.dump';
        await docker([
          'exec',
          container,
          'pg_dump',
          '-U',
          user,
          '-d',
          'aurore_dev_check',
          '-Fc',
          '--no-owner',
          '--no-privileges',
          '--lock-wait-timeout=5s',
          '--snapshot=' + snapshot,
          '-f',
          temporary,
        ]);
        const fingerprint = await databaseFingerprint(db);
        await db.query('COMMIT');
        await docker([
          'cp',
          container + ':' + temporary,
          join(folder, 'database.dump'),
        ]);
        const copiedArchive = await open(join(folder, 'database.dump'), 'r+');
        try {
          await copiedArchive.sync();
        } finally {
          await copiedArchive.close();
        }
        const archiveBytes = (await stat(join(folder, 'database.dump'))).size,
          archiveHash = await fileHash(join(folder, 'database.dump'));
        await privateJson(
          join(folder, 'manifest.json'),
          {
            version: 1,
            source: 'aurore_dev_check',
            createdAt,
            archiveBytes,
            archiveHash,
            fingerprint,
          },
          true,
        );
      } finally {
        await db.end();
        if (temporary) await docker(['exec', container, 'rm', '--', temporary]);
      }
      const report = await verifyBackup(folder, { root, sourceUrl });
      const retention = await rotateManagedBackups(root, folder);
      const complete = { ...report, retention };
      await privateJson(join(folder, 'verification.json'), complete);
      return { directory: folder, ...complete };
    },
    { recoverLock },
  );
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      verify: { type: 'string' },
      'recover-lock': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node --env-file=local-dev/.env backend/tools/verify-db-backup.mjs [private-backup-root] [--verify existing-backup-directory | --recover-lock]',
    );
    return;
  }
  if (positionals.length > 1 || (values.verify && values['recover-lock']))
    throw fail('OPTIONS_INVALID');
  const root = resolve(
    positionals[0] ?? process.env.AURORE_BACKUP_DIR ?? defaultBackupRoot,
  );
  const report = values.verify
    ? await verifyBackup(resolve(values.verify), { root })
    : await backupAndVerify({
        root,
        recoverLock: values['recover-lock'] === true,
      });
  console.log(JSON.stringify(report, null, 2));
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const allowed = new Set([
      'SOURCE_INVALID',
      'RESTORE_TARGET_INVALID',
      'BACKUP_PATH_INVALID',
      'MANIFEST_INVALID',
      'ARCHIVE_INVALID',
      'RESTORE_SCHEMA_MISMATCH',
      'RESTORE_CONTENT_MISMATCH',
      'SEQUENCE_INVALID',
      'SEQUENCE_UNSUPPORTED',
      'MIGRATION_IN_PROGRESS',
      'LARGE_OBJECTS_UNSUPPORTED',
      'POSTGRES_VERSION_INVALID',
      'OPTIONS_INVALID',
      'DOCKER_COMMAND_FAILED',
      'PRIMARY_KEY_REQUIRED',
      'BATCH_RUNNING',
      'RECOVERY_REQUIRED',
      'RETENTION_PROOF_REQUIRED',
      'RETENTION_FAILED',
    ]);
    console.error(
      allowed.has(error.code) ? error.code : 'BACKUP_VERIFICATION_FAILED',
    );
    process.exitCode = 1;
  }
}
