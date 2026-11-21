// 수집된 법령의 정의 조문에서 `"○○"란 … 말한다.` 정의를 원문 그대로 잘라 용어사전 초안(DRAFT)으로 등록한다. 공개(PUBLISHED)는 하지 않는다.
// 쉬운 풀이(easy)는 채우지 않는다. 관리자 화면에서 검토·공개해야 대화 하이라이트에 나타난다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/seed-definition-terms.mjs [--apply] [--limit N] [--report <파일>]
//   기본은 미리 보기(저장 안 함). --apply 일 때만 TERMS_ADMIN_ID / TERMS_ADMIN_PW 로 POST /admin/terms 한다(값은 출력하지 않는다).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const apply = process.argv.includes('--apply');
const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const limit = Number(arg('--limit') ?? 0) || Infinity;
const report = arg('--report');
const api = process.env.TERMS_API ?? 'http://127.0.0.1:3001';
const url = URL.parse(process.env.DATABASE_URL ?? '');
assert.ok(url && url.hostname === '127.0.0.1' && url.port === '5433' && url.pathname === '/aurore_dev_check', '로컬 개발 DB만 허용합니다');

// 핵심 생활법령(동음이의일 때 대표로 우선). backend/src/chat/law-priority.ts 와 같은 목록을 쓰지 않고 이름 일부만 둔다.
const PRIORITY = new Set(['헌법', '민법', '형법', '상법', '민사소송법', '민사집행법', '형사소송법', '행정소송법', '행정절차법', '근로기준법', '근로자퇴직급여 보장법', '최저임금법', '고용보험법', '산업재해보상보험법', '주택임대차보호법', '상가건물 임대차보호법', '집합건물의 소유 및 관리에 관한 법률', '공인중개사법', '부동산등기법', '도로교통법', '개인정보 보호법', '저작권법', '소비자기본법', '전자상거래 등에서의 소비자보호에 관한 법률', '약관의 규제에 관한 법률', '이자제한법', '채무자 회생 및 파산에 관한 법률', '국민연금법', '국민건강보험법', '소득세법', '상속세 및 증여세법', '가족관계의 등록 등에 관한 법률', '식품위생법', '건축법', '의료법']);
// 일상어라 하이라이트 오탐이 큰 용어, 법령 정의지만 맥락 없이는 뜻이 달라지는 용어.
const GENERIC = new Set(['사업', '사업자', '장소', '사람', '자', '기관', '시설', '물건', '금액', '기간', '서류', '문서', '기준', '방법', '제품', '상품', '서비스', '정보', '자료', '업무', '사용', '이용', '운영', '관리', '설치', '조사', '검사', '시험', '교육', '훈련', '지원', '사업장', '단체', '법인', '개인', '대상', '지역', '구역', '구간', '장비', '기구', '용지', '토지', '건물', '재산', '자산', '비용', '수수료', '요금', '가격', '위원회', '위원', '공무원', '직원', '종사자', '대표자', '운영자', '관리자', '소유자', '점유자', '신청인', '신청자', '당사자', '제공자', '이용자', '사용자', '가입자', '수급자', '대상자', '해당자']);
const SKIP_LAW = /(시행규칙|규칙|규정|훈령|예규|고시|지침|조례)$/u;
const NOT_STANDALONE = /(다음 각|각 목|각 호|다음의|다음 중|가목|나목|다목)/u;
const flat = s => s.replace(/\s+/g, ' ').trim();
const norm = s => s.replace(/\s/g, '').normalize('NFKC');

const db = new pg.Client({ connectionString: url.href });
await db.connect();
const { rows: articles } = await db.query(
  `select l.legal_nm, p.disp_no, p.provi_cont, v.enfc_dt::text as enfc
     from legal l
     join lateral (select v.* from legal_ver v where v.legal_id=l.id and not v.del_yn order by v.enfc_dt desc limit 1) v on true
     join legal_ver_rev r on r.legal_ver_id=v.id and r.current_yn
     join legal_provi p on p.legal_ver_rev_id=r.id and not p.del_yn and p.provi_type_cd='ARTICLE' and p.prnt_provi_id is null
    where not l.del_yn and l.src_cd='MOLEG' and p.provi_nm like '%정의%'`);
const { rows: existingRows } = await db.query(`select norm_nm from legal_term where not del_yn`);
await db.end();
const existing = new Set(existingRows.map(row => norm(row.norm_nm)));

// 1) 정의 추출: 한 줄이 `"용어"란 … 말한다.`로 끝나야 하고, 하위 목(가·나·다)에 기대는 정의는 제외한다.
const exclusions = {};
const bump = key => { exclusions[key] = (exclusions[key] ?? 0) + 1; };
const found = [];
const line = /^\s*(?:\d+(?:의\d+)?\.\s*|[①-⑳]\s*)?[“"「]([^“”"」\n]{1,40})[”"」]\s*(?:이?란|이라 함은|라 함은)\s*(.+?(?:말한다|뜻한다|의미한다|이른다))\.?\s*$/u;
for (const row of articles) {
  if (SKIP_LAW.test(row.legal_nm)) { bump('규칙·고시·조례 계열 법령'); continue; }
  for (const raw of row.provi_cont.split('\n')) {
    const text = flat(raw);
    if (!/[“"「]/.test(text) || !/(란|함은)/.test(text)) continue;
    const m = line.exec(text);
    if (!m) { if (/^\d+(?:의\d+)?\.\s*[“"「][^”"」]{1,40}[”"」]\s*(?:이?란|라 함은)/u.test(text)) bump('한 줄로 끝나지 않는 정의'); continue; }
    const term = m[1].trim();
    const definition = text.replace(/^(?:\d+(?:의\d+)?\.\s*|[①-⑳]\s*)/u, '');
    found.push({ term, key: norm(term), law: row.legal_nm, article: row.disp_no, enfc: row.enfc, definition });
  }
}

// 2) 규칙 필터와 동음이의 정리
const byTerm = new Map();
for (const item of found) {
  if (item.term.length < 2 || item.term.length > 20) { bump('용어 길이'); continue; }
  if (/[,、·ㆍ]|\s(?:및|또는)\s/.test(item.term)) { bump('여러 용어를 묶은 정의'); continue; }
  if (GENERIC.has(item.key)) { bump('일상어(오탐 위험)'); continue; }
  if (item.definition.length > 1200 || item.definition.length < 10) { bump('정의 길이'); continue; }
  if (NOT_STANDALONE.test(item.definition)) { bump('하위 항목에 기대는 정의'); continue; }
  if (existing.has(item.key)) { bump('이미 사전에 있는 용어'); continue; }
  const list = byTerm.get(item.key) ?? [];
  list.push(item);
  byTerm.set(item.key, list);
}
const level = name => (/시행령$/u.test(name) ? 1 : 2);
const prepared = [];
for (const [key, list] of byTerm) {
  const laws = [...new Set(list.map(item => item.law))];
  let pick;
  if (laws.length === 1) pick = list[0];
  else {
    // 동음이의: 핵심 생활법령이 정의한 것을 대표로 하고, 없으면 법률 계열이 하나뿐일 때만 그것을 쓴다. 그 밖에는 건너뛴다.
    const priority = list.filter(item => PRIORITY.has(item.law));
    const acts = list.filter(item => level(item.law) === 2);
    if (priority.length && new Set(priority.map(item => item.law)).size === 1) pick = priority[0];
    else if (!priority.length && new Set(acts.map(item => item.law)).size === 1) pick = acts[0];
    else { bump('동음이의(대표를 정할 수 없음)'); continue; }
  }
  // 2글자 용어는 핵심 생활법령 정의만 허용한다(일상어와 겹쳐 하이라이트 오탐이 커진다).
  if (pick.term.length === 2 && !PRIORITY.has(pick.law)) { bump('2글자 용어(핵심법령 외)'); continue; }
  prepared.push({
    termName: pick.term, aliases: [], definition: pick.definition,
    sourceName: '국가법령정보센터',
    sourceUrl: `https://www.law.go.kr/법령/${pick.law}/${pick.article}`,
    sourceReference: `${pick.law} ${pick.article} 조문 인용 · ${pick.enfc} 시행본 기준`,
    _key: key,
  });
}
prepared.sort((a, b) => a.sourceReference.localeCompare(b.sourceReference, 'ko'));
const summary = { definitionArticles: articles.length, extracted: found.length, distinctTerms: new Set(found.map(i => i.key)).size, prepared: prepared.length, exclusions };
console.log(JSON.stringify(summary, null, 1));
if (report) await writeFile(report, JSON.stringify({ summary, sample: prepared.slice(0, 200).map(t => ({ term: t.termName, ref: t.sourceReference, def: t.definition.slice(0, 120) })) }, null, 1), { flag: 'w' });
if (!apply) {
  const step = Math.max(1, Math.floor(prepared.length / 20));
  for (let i = 0; i < prepared.length; i += step) console.log(prepared[i].termName + ' | ' + prepared[i].sourceReference + ' | ' + prepared[i].definition.slice(0, 80));
  process.exit(0);
}

assert.ok(process.env.TERMS_ADMIN_ID && process.env.TERMS_ADMIN_PW, '관리자 계정 환경변수가 필요합니다');
const login = await fetch(api + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: process.env.TERMS_ADMIN_ID, password: process.env.TERMS_ADMIN_PW }) });
assert.ok(login.ok, '관리자 로그인 실패');
const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + (await login.json()).token };
const counts = { created: 0, failed: 0 };
for (const { _key, ...term } of prepared.slice(0, limit)) {
  const r = await fetch(api + '/admin/terms', { method: 'POST', headers, body: JSON.stringify({ ...term, requestId: randomUUID() }) });
  if (r.ok) counts.created++; else { counts.failed++; if (counts.failed <= 10) console.log('FAILED', term.termName, r.status, (await r.text()).slice(0, 100)); }
}
console.log(JSON.stringify(counts));
