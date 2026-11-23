// 용어 후보를 "현행 법령 조문에서 얼마나 많이 쓰이는지"로 순위를 매겨 상위 N개를 고른다(읽기 전용, DB 변경 없음).
// 사용: node --env-file=local-dev/.env backend/tools/rank-terms-by-usage.mjs <조문 본문 파일> <details.jsonl> <출력 JSON> [개수, 기본 1000]
//  - 조문 본문 파일: 현행 시행본 조문 본문을 한 줄에 하나씩 적은 텍스트(줄바꿈은 공백으로 바꾼 것)
//  - details.jsonl: collect-all-terms.mjs 가 모은 용어별 공식 정의(법제처 법령 정의 조문 인용 용어만 후보로 쓴다)
// 사용량 = 그 용어 이름이 들어 있는 조문 개수(한 조문에 여러 번 나와도 1번). 이미 DB에 있는 용어(띄어쓰기·대소문자 무시)는 뺀다.
// 같은 이름의 정의가 여러 법령에 있으면 법률 → 대통령령 → 총리령·부령 순으로, 같으면 번호가 작은 것을 고른다.
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import pg from 'pg';

const [corpusFile, detailsFile, outFile, countArg] = process.argv.slice(2);
if (!corpusFile || !detailsFile || !outFile) throw new Error('OPTIONS_INVALID');
const top = Number(countArg ?? 1000);
if (!Number.isInteger(top) || top < 1 || top > 20000) throw new Error('COUNT_INVALID');
const norm = (name) => name.replace(/\s/gu, '').toLowerCase();
// 출처 문구 "법령정의사전 · 법령명[법률 제n호, 날짜, 개정]" 에서 법령 종류를 읽는다. 법률·대통령령·총리령·부령의 정의만 쓴다(고시·훈령·예규 같은 행정규칙은 뺀다).
const kindOf = (ref) => ref.match(/\[([^\[\]\s]+) 제/u)?.[1] ?? '';
const kindRank = (kind) => (kind === '법률' ? 0 : kind === '대통령령' ? 1 : kind === '총리령' || kind.endsWith('부령') ? 2 : 9);

// 1) 이미 DB에 있는 용어(삭제된 것 포함) 이름
const url = URL.parse(process.env.DATABASE_URL ?? '');
if (!url || url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/aurore_dev_check') throw new Error('LOCAL_DB_REQUIRED');
const db = new pg.Client({ connectionString: url.href });
await db.connect();
const existing = new Set((await db.query('SELECT norm_nm FROM legal_term')).rows.map((row) => row.norm_nm));
await db.end();

// 2) 후보: 법령 정의 조문을 인용한 한국어 용어(영문 사전·생활용어는 제외)
const candidates = new Map(); // norm → { name, sourceIds: [{id, ref}] }
let excludedExisting = 0;
for (const line of (await readFile(detailsFile, 'utf8')).split('\n')) {
  if (!line) continue;
  const row = JSON.parse(line);
  const ref = row.data?.sourceReference ?? '';
  const name = String(row.termName ?? '').trim();
  const definition = String(row.data?.definition ?? '');
  if (ref === '법령한영사전' || ref === '생활용어사전' || ref === '법령용어사전') continue;
  if (kindRank(kindOf(ref)) > 2) continue;
  // "대통령령으로 정하는 …", "특별한 사유" 같은 법령 관용구는 용어가 아니다.
  if (/정하는|정한|인정되는|필요한|기여한|정당한|특별한|경미한|중요한|이에 준하는|그 밖/u.test(name)) continue;
  if (name.startsWith('그 밖에') || name.length < 2 || name.length > 40 || !/[가-힣]/u.test(name) || !definition.trim() || definition.length > 10000) continue;
  const key = norm(name);
  if (existing.has(key)) { excludedExisting++; continue; }
  if (!candidates.has(key)) candidates.set(key, { name, entries: [] });
  candidates.get(key).entries.push({ sourceId: String(row.sourceId), ref, rawHash: row.rawHash });
}

// 3) 이름으로 트라이를 만들어 조문 전체를 한 번 훑으며 조문 수를 센다
const root = new Map();
const terms = [...candidates.keys()];
terms.forEach((key, index) => {
  let node = root;
  for (const ch of candidates.get(key).name) {
    let next = node.get(ch);
    if (!next) { next = new Map(); node.set(ch, next); }
    node = next;
  }
  node.set(0, index); // 0 은 글자가 될 수 없으므로 끝 표시로 쓴다
});
const counts = new Uint32Array(terms.length);
const stamp = new Uint32Array(terms.length);
let doc = 0;
for await (const line of createInterface({ input: createReadStream(corpusFile, 'utf8'), crlfDelay: Infinity })) {
  doc++;
  for (let i = 0; i < line.length; i++) {
    let node = root.get(line[i]);
    if (!node) continue;
    for (let j = i + 1; ; j++) {
      const end = node.get(0);
      if (end !== undefined && stamp[end] !== doc) { stamp[end] = doc; counts[end]++; }
      node = node.get(line[j]);
      if (!node) break;
    }
  }
}

// 4) 상위 N개 + 같은 이름이 여럿이면 법률 정의를 우선
const ranked = terms
  .map((key, index) => ({ key, count: counts[index] }))
  .filter((row) => row.count > 0)
  .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ko'))
  .slice(0, top)
  .map((row, rank) => {
    const { name, entries } = candidates.get(row.key);
    const pick = [...entries].sort((a, b) => kindRank(kindOf(a.ref)) - kindRank(kindOf(b.ref)) || Number(a.sourceId) - Number(b.sourceId))[0];
    return { rank: rank + 1, name, articles: row.count, ...pick, definitions: entries.length };
  });
await writeFile(outFile, JSON.stringify({ corpusDocs: doc, candidates: terms.length, excludedExisting, selected: ranked.length, items: ranked }, null, 1), { flag: 'wx' });
console.log(JSON.stringify({ corpusDocs: doc, candidates: terms.length, excludedExisting, selected: ranked.length, first: ranked.slice(0, 5).map((r) => r.name + ':' + r.articles), last: ranked.slice(-3).map((r) => r.name + ':' + r.articles) }));
