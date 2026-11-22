// 주요 법령의 과거 시행본(연혁)을 법제처에서 받아 이미 있는 법령에 시행본으로 추가한다(시행본 비교용).
// 현행 시행본·시행 예정분은 건드리지 않고, DB에 저장된 현행 시행일보다 이전인 시행본만 법령마다 최대 N개(최근순) 가져온다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/collect-law-history.mjs <원문 저장 폴더> [--apply] [--max 6]
//   LAW_TITLES_FILE=<줄 단위 법령명 파일>  (없으면 아래 기본 목록)
// --apply 가 없으면 받을 시행본 목록만 보여 준다. 로컬 개발 DB(127.0.0.1:5433/aurore_dev_check)에만 쓴다.
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { collectLaw } from './collect-selected-laws.mjs';

export const defaultTitles = [
  '주택임대차보호법', '상가건물 임대차보호법', '근로기준법', '근로자퇴직급여 보장법', '최저임금법',
  '민법', '형법', '개인정보 보호법', '도로교통법', '공인중개사법',
];

/** 연혁 목록에서 정확히 같은 이름의 시행본을 시행일 기준으로 정리한다(같은 시행일은 하나, 최근순). */
export function pastEditions(payload, title, currentEfYd, today, max) {
  const root = payload?.LawSearch;
  const rows = Array.isArray(root?.law) ? root.law : root?.law ? [root.law] : [];
  const seen = new Set();
  return rows
    .filter(row => row.법령명한글 === title)
    .map(row => ({
      target: 'eflaw',
      lawId: String(row.법령ID ?? '').padStart(6, '0'),
      MST: String(row.법령일련번호 ?? ''),
      efYd: String(row.시행일자 ?? '').replaceAll('.', ''),
    }))
    .filter(row => /^\d{6}$/.test(row.lawId) && /^\d+$/.test(row.MST) && /^\d{8}$/.test(row.efYd))
    .filter(row => row.efYd < currentEfYd && row.efYd <= today)
    .sort((a, b) => b.efYd.localeCompare(a.efYd))
    .filter(row => (seen.has(row.efYd) ? false : (seen.add(row.efYd), true)))
    .slice(0, max);
}

async function listHistory(title, oc) {
  const url = new URL('https://www.law.go.kr/DRF/lawSearch.do');
  url.search = new URLSearchParams({ OC: oc, target: 'eflaw', type: 'JSON', nw: '1', search: '1', query: title, display: '100', page: '1' });
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new Error('LIST_READ_FAILED'); }
  return JSON.parse(await response.text());
}

async function main() {
  const args = process.argv.slice(2);
  const directory = args[0];
  const apply = args.includes('--apply');
  const maxIndex = args.indexOf('--max');
  const max = maxIndex >= 0 ? Number(args[maxIndex + 1]) : 6;
  if (!directory || !Number.isInteger(max) || max < 1 || max > 20) throw new Error('OPTIONS_INVALID');
  const oc = process.env.MOLEG_OC?.trim();
  if (!oc) { console.log(JSON.stringify({ status: 'BLOCKED', reason: 'MOLEG_OC_REQUIRED' })); process.exitCode = 2; return; }
  const url = URL.parse(process.env.DATABASE_URL ?? '');
  if (!url || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/aurore_dev_check') throw new Error('LOCAL_DB_REQUIRED');
  const titles = process.env.LAW_TITLES_FILE
    ? (await readFile(process.env.LAW_TITLES_FILE, 'utf8')).split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    : defaultTitles;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replaceAll('-', '');
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    for (const title of titles) {
      try {
        const { rows: [law] } = await db.query(
          "SELECT l.src_key, to_char(max(v.enfc_dt), 'YYYYMMDD') AS current_efyd FROM legal l JOIN legal_ver v ON v.legal_id = l.id AND NOT v.del_yn " +
          "WHERE l.src_cd = 'MOLEG' AND l.legal_nm = $1 AND NOT l.del_yn GROUP BY l.src_key", [title]);
        if (!law?.current_efyd) { console.log(JSON.stringify({ title, status: 'SKIPPED', reason: 'NOT_IN_DB' })); continue; }
        const editions = pastEditions(await listHistory(title, oc), title, law.current_efyd, today, max)
          .filter(row => row.lawId === law.src_key.padStart(6, '0'));
        console.log(JSON.stringify({ title, current: law.current_efyd, plan: editions.map(row => row.efYd) }));
        if (!apply) { await delay(500); continue; }
        for (const sample of editions) {
          await delay(1000);
          try { console.log(JSON.stringify(await collectLaw(sample, title, oc, directory, db)), sample.efYd); }
          catch (error) { console.log(JSON.stringify({ title, efYd: sample.efYd, status: 'SKIPPED', reason: String(error?.message ?? error).slice(0, 60) })); }
        }
      } catch (error) {
        console.log(JSON.stringify({ title, status: 'SKIPPED', reason: String(error?.message ?? error).slice(0, 60) }));
      }
      await delay(1000);
    }
  } finally { await db.end(); }
}
if (import.meta.main) {
  try { await main(); } catch (error) { console.error('LAW_HISTORY_COLLECTION_FAILED:', String(error?.message ?? error).slice(0, 80)); process.exitCode = 1; }
}
