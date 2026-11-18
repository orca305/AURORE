import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { collectLaw, selectCurrentLaw } from './collect-selected-laws.mjs';
import { createRecord, withRefreshLock } from './refresh-run-lock.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function parsePage(payload, page, total) {
  const root = payload?.LawSearch;
  const count = Number(root?.totalCnt);
  const rows = Array.isArray(root?.law) ? root.law : root?.law ? [root.law] : [];
  if (!Number.isSafeInteger(count) || count < 1 || count > 100000 ||
      (total !== undefined && total !== count) || Number(root?.page) !== page ||
      rows.length !== Math.min(100, count - (page - 1) * 100)) throw new Error('CATALOGUE_PAGE_INVALID');
  return { total: count, laws: rows.map(row => ({
    ...selectCurrentLaw({ LawSearch: { totalCnt: 1, page: 1, law: row } }, row.법령명한글),
    title: row.법령명한글,
  })) };
}

export function validateCatalogue(catalogue) {
  if (catalogue?.scope !== 'eflaw-current' || !Array.isArray(catalogue.laws) ||
      catalogue.total !== catalogue.laws.length || !catalogue.total ||
      catalogue.hash !== digest(catalogue.laws)) throw new Error('CATALOGUE_INVALID');
  const seen = new Set();
  for (const law of catalogue.laws) {
    if (typeof law.title !== 'string' || !law.title.trim() || law.title.length > 500 || law.target !== 'eflaw') throw new Error('CATALOGUE_IDENTITY_INVALID');
    const normalized = selectCurrentLaw({ LawSearch: { totalCnt: 1, page: 1, law: {
      법령명한글: law.title, 법령ID: law.lawId, 법령일련번호: law.MST, 시행일자: law.efYd,
    } } }, law.title);
    if (JSON.stringify(normalized) !== JSON.stringify({ target: law.target, lawId: law.lawId, MST: law.MST, efYd: law.efYd }) || seen.has(law.lawId)) throw new Error('CATALOGUE_DUPLICATE_OR_INVALID');
    seen.add(law.lawId);
  }
  return catalogue;
}

async function discover(oc) {
  const laws = [];
  let total;
  for (let page = 1; total === undefined || laws.length < total; page++) {
    const url = new URL('https://www.law.go.kr/DRF/lawSearch.do');
    url.search = new URLSearchParams({ OC: oc, target: 'eflaw', type: 'JSON', nw: '3', display: '100', page: String(page), sort: 'lasc' });
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel(); throw new Error('CATALOGUE_READ_FAILED');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('CATALOGUE_RESPONSE_LIMIT');
      chunks.push(chunk);
    }
    const parsed = parsePage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), page, total);
    total = parsed.total;
    laws.push(...parsed.laws);
    console.log(JSON.stringify({ status: 'CATALOGUING', page, discovered: laws.length, total }));
    await delay(1000);
  }
  return validateCatalogue({ scope: 'eflaw-current', capturedAt: new Date().toISOString(), total, laws, hash: digest(laws) });
}

// A committed edition can safely be replayed if a crash precedes its receipt.
export async function collectBatch(catalogue, directory, limit, collect) {
  validateCatalogue(catalogue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('BATCH_LIMIT_INVALID');
  await mkdir(directory, { recursive: true });
  let completed = 0, processed = 0;
  for (const law of catalogue.laws) {
    const path = join(directory, `${law.lawId}-${law.MST}-${law.efYd}.json`);
    let receipt, exists = false;
    try { receipt = JSON.parse(await readFile(path, 'utf8')); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      if (receipt?.catalogueHash !== catalogue.hash || receipt?.identity !== digest(law) || !/^[a-f0-9]{64}$/.test(receipt?.hash ?? '')) throw new Error('RECEIPT_INVALID');
      completed++;
      continue;
    }
    if (processed === limit) continue;
    const result = await collect(law);
    if (!/^[a-f0-9]{64}$/.test(result.hash ?? '')) throw new Error('COLLECTION_RESULT_INVALID');
    if (!await createRecord(path, { catalogueHash: catalogue.hash, identity: digest(law), hash: result.hash, completedAt: new Date().toISOString() })) throw new Error('RECEIPT_CONFLICT');
    completed++; processed++;
    console.log(JSON.stringify({ ...result, completed, total: catalogue.total }));
  }
  return { status: 'BATCH_COMPLETE', processed, completed, remaining: catalogue.total - completed, total: catalogue.total };
}

async function main() {
  const [command, runDirectory, snapshotDirectory, rawLimit, ...extra] = process.argv.slice(2);
  if (!runDirectory || extra.some(flag => flag !== '--recover-lock') ||
      !['plan', 'apply'].includes(command) || (command === 'plan' && snapshotDirectory) ||
      (command === 'apply' && (!snapshotDirectory || !/^\d+$/.test(rawLimit ?? '')))) throw new Error('OPTIONS_INVALID');
  const limit = Number(rawLimit);
  if (command === 'apply' && (limit < 1 || limit > 100)) throw new Error('BATCH_LIMIT_INVALID');
  const oc = process.env.MOLEG_OC?.trim();
  if (!oc) throw new Error('MOLEG_OC_REQUIRED');
  const directory = resolve(runDirectory);
  await mkdir(directory, { recursive: true });
  await withRefreshLock(directory, async () => {
    const path = join(directory, 'catalogue.json');
    if (command === 'plan') {
      const catalogue = await discover(oc);
      if (!await createRecord(path, catalogue)) throw new Error('CATALOGUE_ALREADY_EXISTS');
      console.log(JSON.stringify({ status: 'CATALOGUE_SAVED', total: catalogue.total, hash: catalogue.hash }));
      return;
    }
    const catalogue = validateCatalogue(JSON.parse(await readFile(path, 'utf8')));
    const url = URL.parse(process.env.DATABASE_URL ?? '');
    if (!url || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/aurore_dev_check') throw new Error('LOCAL_DB_REQUIRED');
    const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10000 });
    await db.connect();
    try {
      console.log(JSON.stringify(await collectBatch(catalogue, join(directory, 'receipts'), limit, async law => {
        const result = await collectLaw(law, law.title, oc, snapshotDirectory, db);
        await delay(1000);
        return result;
      })));
    } finally { await db.end(); }
  }, { recoverLock: extra.includes('--recover-lock') });
}

if (import.meta.main) {
  try { await main(); }
  catch { console.error('CURRENT_LAW_COLLECTION_FAILED: catalogue and committed editions preserved; inspect scope, API availability, receipt integrity and local DB before resuming.'); process.exitCode = 1; }
}
