import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { readOfficialSample, storeSnapshot } from './capture-law-samples.mjs';
import { collectEvidence } from './law-evidence.mjs';
import { importEdition } from './import-law-samples.mjs';

export const titles = ['민법', '형법', '상법', '근로기준법', '개인정보 보호법', '도로교통법', '건축법', '소비자기본법'];
export function selectCurrentLaw(payload, title) {
  const root = payload?.LawSearch;
  const count = Number(root?.totalCnt);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100 || String(root?.page) !== '1') throw new Error('LIST_INVALID');
  const rows = Array.isArray(root.law) ? root.law : root.law ? [root.law] : [];
  if (rows.length !== count) throw new Error('LIST_INCOMPLETE');
  const selected = rows.filter(row => row.법령명한글 === title);
  if (selected.length !== 1) throw new Error('EXACT_CURRENT_LAW_REQUIRED');
  const row = selected[0];
  const rawLawId = String(row.법령ID ?? '');
  const lawId = rawLawId.padStart(6, '0');
  const MST = String(row.법령일련번호 ?? '');
  const efYd = String(row.시행일자 ?? '').replaceAll('.', '');
  const iso = efYd.slice(0, 4) + '-' + efYd.slice(4, 6) + '-' + efYd.slice(6);
  const date = new Date(iso);
  if (!/^\d{1,6}$/.test(rawLawId) || Number(rawLawId) === 0 || !/^\d+$/.test(MST) || !/^\d{8}$/.test(efYd) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== iso) throw new Error('IDENTITY_INVALID');
  return { target: 'eflaw', lawId, MST, efYd };
}

async function findLaw(title, oc) {
  const url = new URL('https://www.law.go.kr/DRF/lawSearch.do');
  url.search = new URLSearchParams({ OC: oc, target: 'eflaw', type: 'JSON', nw: '3', search: '1', query: title, display: '100', page: '1' });
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new Error('LIST_READ_FAILED'); }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 2 * 1024 * 1024) throw new Error('LIST_LIMIT');
    chunks.push(chunk);
  }
  return selectCurrentLaw(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), title);
}

async function main() {
  const [directory, flag, ...extra] = process.argv.slice(2);
  if (!directory || extra.length || (flag !== undefined && flag !== '--apply')) throw new Error('OPTIONS_INVALID');
  const oc = process.env.MOLEG_OC?.trim();
  if (!oc) { console.log(JSON.stringify({ status: 'BLOCKED', reason: 'MOLEG_OC_REQUIRED', collected: 0, imported: 0 })); process.exitCode = 2; return; }
  const url = URL.parse(process.env.DATABASE_URL ?? '');
  if (flag && (!url || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/aurore_dev_check')) throw new Error('LOCAL_DB_REQUIRED');
  const db = flag ? new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10000 }) : null;
  if (db) await db.connect();
  try {
    for (const title of titles) {
      const sample = await findLaw(title, oc);
      await delay(1000);
      const { bytes, payload, identity } = await readOfficialSample(sample, oc);
      if (identity.title !== title) throw new Error('DETAIL_TITLE_MISMATCH');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const chunks = collectEvidence(payload, hash);
      if (!chunks.length) throw new Error('EMPTY_PROVISIONS');
      await storeSnapshot(join(resolve(directory), 'law', sample.lawId, `${sample.MST}-${sample.efYd}`), bytes);
      let result;
      if (db) {
        const info = payload.법령.기본정보;
        const date = value => {
          const str = String(value);
          const iso = str.slice(0, 4) + '-' + str.slice(4, 6) + '-' + str.slice(6);
          if (!/^\d{8}$/.test(str) || !Number.isFinite(new Date(iso).valueOf()) || new Date(iso).toISOString().slice(0,10) !== iso) throw new Error('DATE_INVALID');
          return iso;
        };
        await db.query('BEGIN');
        try {
          await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))");
          result = await importEdition(db, { date: date(sample.efYd), promulgated: date(info.공포일자), sourceKey: sample.lawId, versionKey: payload.법령.법령키, title, url: `https://www.law.go.kr/LSW/lsInfoP.do?efYd=${sample.efYd}&lsiSeq=${sample.MST}`, hash, raw: bytes.toString('utf8'), chunks });
          await db.query('COMMIT');
        } catch (error) { await db.query('ROLLBACK'); throw error; }
      }
      console.log(JSON.stringify({ title, sourceKey: sample.lawId, hash, status: db ? result.status : 'STAGED', ...(result ? { provisions: result.provisions } : {}) }));
      await delay(1000);
    }
  } finally { if (db) await db.end(); }
}
if (import.meta.main) {
  try { await main(); } catch { console.error('SELECTED_LAW_COLLECTION_FAILED: check API registration, exact current identity, and local DB. Earlier snapshots and committed laws are preserved; rerun to resume.'); process.exitCode = 1; }
}
