// 법령 조문 인용 + 쉬운 풀이로 법률용어를 초안(DRAFT) 등록한다. 공개(PUBLISHED)는 관리자 검토 후 별도로 한다.
// 정의 칸은 DB에 저장된 현행 조문 원문에서 앵커 사이를 그대로 잘라 쓴다(직접 타이핑하지 않는다).
// 사용: TERMS_ADMIN_ID=... TERMS_ADMIN_PW=... node --env-file=local-dev/.env backend/tools/seed-easy-terms.mjs [--apply]
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const apply = process.argv.includes('--apply');
const refresh = process.argv.includes('--refresh'); // 이미 등록된 용어의 쉬운 풀이만 easy-explanations.txt 내용으로 바꾸고 다시 공개한다.
const api = process.env.TERMS_API ?? 'http://127.0.0.1:3001';
const entries = JSON.parse(await readFile(new URL('./easy-terms.json', import.meta.url), 'utf8'));
const url = URL.parse(process.env.DATABASE_URL ?? '');
assert.ok(url && url.hostname === '127.0.0.1' && url.port === '5433' && url.pathname === '/aurore_dev_check', '로컬 개발 DB만 허용합니다');
const db = new pg.Client({ connectionString: url.href });
await db.connect();
const flat = s => s.replace(/\s+/g, ' ').trim();

async function provision(law, article) {
  const { rows } = await db.query(
    `select p.provi_cont, v.enfc_dt::text as enfc from legal l
       join legal_ver v on v.legal_id=l.id and not v.del_yn
       join legal_ver_rev r on r.legal_ver_id=v.id and r.current_yn
       join legal_provi p on p.legal_ver_rev_id=r.id and not p.del_yn and p.provi_type_cd='ARTICLE' and p.disp_no=$2
      where l.legal_nm=$1 and not l.del_yn order by v.enfc_dt desc limit 1`, [law, article]);
  return rows[0];
}

// easy-explanations.txt: "## 용어" 줄 다음에 풀이 본문. 있으면 easy-terms.json의 easy를 대신한다.
const detailed = new Map();
try {
  const raw = await readFile(new URL('./easy-explanations.txt', import.meta.url), 'utf8');
  for (const block of raw.split(/^## /m).slice(1)) {
    const nl = block.indexOf('\n');
    detailed.set(block.slice(0, nl).trim(), block.slice(nl + 1).trim());
  }
} catch { /* 파일이 없으면 json의 easy를 쓴다 */ }
for (const e of entries) if (detailed.has(e.term)) e.easy = detailed.get(e.term);

const prepared = [], problems = [];
for (const e of entries) {
  const row = await provision(e.law, e.article);
  if (!row) { problems.push([e.term, 'ARTICLE_NOT_FOUND']); continue; }
  const text = flat(row.provi_cont), start = text.indexOf(e.from);
  if (start < 0) { problems.push([e.term, 'FROM_NOT_FOUND']); continue; }
  const end = text.indexOf(e.to, start);
  if (end < 0) { problems.push([e.term, 'TO_NOT_FOUND']); continue; }
  const definition = text.slice(start, end + e.to.length);
  if (definition.length < 10 || definition.length > 1200) { problems.push([e.term, 'LENGTH ' + definition.length]); continue; }
  prepared.push({
    termName: e.term, aliases: e.aliases, definition, explanation: e.easy,
    sourceName: '국가법령정보센터',
    sourceUrl: `https://www.law.go.kr/법령/${e.law}/${e.article}`,
    sourceReference: `${e.law} ${e.article} 조문 인용 · ${row.enfc} 시행본 기준`,
  });
}
await db.end();
console.log(JSON.stringify({ entries: entries.length, prepared: prepared.length, problems }));
if (!apply) { for (const t of prepared) console.log(t.termName + ' | ' + t.definition.slice(0, 90)); process.exit(problems.length ? 1 : 0); }
assert.ok(!problems.length, '문제 항목을 먼저 고쳐 주세요');

const login = await fetch(api + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: process.env.TERMS_ADMIN_ID, password: process.env.TERMS_ADMIN_PW }) });
assert.ok(login.ok, '관리자 로그인 실패');
const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + (await login.json()).token };
const existing = new Set();
for (let offset = 0; offset < 1000; offset += 50) {
  const page = await (await fetch(`${api}/admin/terms?limit=50&offset=${offset}`, { headers })).json();
  for (const item of page.items ?? page.terms ?? []) existing.add((item.termName ?? '').replace(/\s/g, ''));
  if ((page.items ?? page.terms ?? []).length < 50) break;
}
const counts = { created: 0, skipped: 0, failed: 0, refreshed: 0 };
if (refresh) {
  const current = new Map();
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await (await fetch(`${api}/admin/terms?limit=50&offset=${offset}`, { headers })).json();
    for (const item of page.items) current.set(item.termName.replace(/\s/g, ''), item);
    if (page.items.length < 50) break;
  }
  for (const t of prepared) {
    const row = current.get(t.termName.replace(/\s/g, ''));
    if (!row) { counts.skipped++; continue; }
    if ((row.explanation ?? '') === t.explanation && row.state === 'PUBLISHED') { counts.skipped++; continue; }
    // 이름·동의어·정의·출처는 현재 등록된 값을 유지하고 쉬운 풀이만 바꾼다.
    const body = { requestId: randomUUID(), revision: row.revision, termName: row.termName, aliases: row.aliases, definition: row.definition, explanation: t.explanation, sourceName: row.sourceName, sourceUrl: row.sourceUrl, sourceReference: row.sourceReference };
    const u = await fetch(`${api}/admin/terms/${row.id}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!u.ok) { counts.failed++; console.log('FAILED update', t.termName, u.status); continue; }
    const revision = (await u.json()).revision;
    const p = await fetch(`${api}/admin/terms/${row.id}/publish`, { method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), revision, confirmed: true }) });
    if (p.ok) counts.refreshed++; else { counts.failed++; console.log('FAILED publish', t.termName, p.status); }
  }
  console.log(JSON.stringify(counts));
  process.exit(counts.failed ? 1 : 0);
}
for (const t of prepared) {
  if (existing.has(t.termName.replace(/\s/g, ''))) { counts.skipped++; continue; }
  const r = await fetch(api + '/admin/terms', { method: 'POST', headers, body: JSON.stringify({ ...t, requestId: randomUUID() }) });
  if (r.ok) counts.created++; else { counts.failed++; console.log('FAILED', t.termName, r.status, (await r.text()).slice(0, 120)); }
}
console.log(JSON.stringify(counts));
