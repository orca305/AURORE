// 현행 법령 조문(ARTICLE)을 Ollama bge-m3 로 임베딩해 파일로 저장한다(DB 스키마·확장 변경 없음, 순위용일 뿐 인용 근거가 아니다).
// 사용: node --env-file=local-dev/.env backend/tools/embed-provisions.mjs [출력폴더=D:/DATA/embeddings/bge-m3] [--limit N]
// 재개: ids.json 과 이미 만든 chunk-*.bin 을 건너뛴다. 끝나면 manifest.json 을 쓴다.
// 형식: chunk-NNNNN.bin = int8 벡터(길이 1024, L2 정규화 후 ×127 반올림) × 조문 수, 순서는 ids.json 의 같은 구간.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) ?? 'D:/DATA/embeddings/bge-m3';
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;
const ollama = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const MODEL = 'bge-m3', DIMS = 1024, CHUNK = 2048, BATCH = 32, PARALLEL = 2, TEXT_CHARS = 700;
const url = URL.parse(process.env.DATABASE_URL ?? '');
assert.ok(url && url.hostname === '127.0.0.1' && url.port === '5433' && url.pathname === '/aurore_dev_check', '로컬 개발 DB만 허용합니다');
await mkdir(dir, { recursive: true });
const db = new pg.Client({ connectionString: url.href });
await db.connect();

const idsPath = join(dir, 'ids.json');
let ids;
if (existsSync(idsPath)) ids = JSON.parse(await readFile(idsPath, 'utf8'));
else {
  // 검색(retrieveStoredEvidence)과 같은 대상: 법령별 최신 판본의 현행 개정본 ARTICLE(삭제되지 않은 것).
  const { rows } = await db.query(
    `select p.id::text as id from legal l
       join lateral (select v.* from legal_ver v where v.legal_id=l.id and not v.del_yn order by v.enfc_dt desc limit 1) v on true
       join legal_ver_rev r on r.legal_ver_id=v.id and r.current_yn and r.src_snapshot_id is not null
       join legal_provi p on p.legal_ver_rev_id=r.id and not p.del_yn and p.provi_type_cd='ARTICLE' and p.prnt_provi_id is null
      where not l.del_yn and l.src_cd='MOLEG' order by p.id`);
  ids = rows.map(row => row.id);
  await writeFile(idsPath, JSON.stringify(ids));
}
const total = Math.min(ids.length, limit);
const chunks = Math.ceil(total / CHUNK);
console.log(JSON.stringify({ total, chunks, dir }));

async function embed(texts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(ollama + '/api/embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, input: texts, truncate: true }), signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const { embeddings } = await response.json();
      assert.equal(embeddings.length, texts.length);
      return embeddings;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
}
const quantize = vector => {
  let norm = 0;
  for (const x of vector) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Int8Array.from(vector, x => Math.round((x / norm) * 127));
};
const flat = s => s.replace(/\s+/g, ' ').trim();

const started = Date.now();
let done = 0;
for (let chunk = 0; chunk < chunks; chunk++) {
  const file = join(dir, 'chunk-' + String(chunk).padStart(5, '0') + '.bin');
  const part = ids.slice(chunk * CHUNK, Math.min(total, (chunk + 1) * CHUNK));
  if (existsSync(file)) { done += part.length; continue; }
  const { rows } = await db.query(
    `select p.id::text as id, l.legal_nm, p.provi_cont from legal_provi p
       join legal_ver_rev r on r.id=p.legal_ver_rev_id join legal_ver v on v.id=r.legal_ver_id join legal l on l.id=v.legal_id
      where p.id = any($1::bigint[])`, [part]);
  const byId = new Map(rows.map(row => [row.id, row]));
  // 입력: 법령명 + 조문 제목·본문 앞부분(제목은 provi_cont 첫 줄에 있다).
  const texts = part.map(id => { const row = byId.get(id); return row ? flat(row.legal_nm + ' ' + row.provi_cont).slice(0, TEXT_CHARS + row.legal_nm.length + 1) : '삭제된 조문'; });
  const batches = [];
  for (let at = 0; at < texts.length; at += BATCH) batches.push(texts.slice(at, at + BATCH));
  const out = new Array(batches.length);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < batches.length) { const index = next++; out[index] = await embed(batches[index]); }
  }));
  const bytes = new Int8Array(part.length * DIMS);
  let offset = 0;
  for (const group of out) for (const vector of group) { assert.equal(vector.length, DIMS); bytes.set(quantize(vector), offset); offset += DIMS; }
  await writeFile(file + '.tmp', bytes);
  const { rename } = await import('node:fs/promises');
  await rename(file + '.tmp', file);
  done += part.length;
  const seconds = (Date.now() - started) / 1000;
  console.log(JSON.stringify({ chunk, done, total, seconds: Math.round(seconds), perSecond: +(done / seconds).toFixed(1) }));
}
await db.end();
const hash = createHash('sha256').update(ids.slice(0, total).join(',')).digest('hex');
await writeFile(join(dir, 'manifest.json'), JSON.stringify({ model: MODEL, dims: DIMS, quantization: 'int8-l2norm-x127', chunkSize: CHUNK, count: total, chunks, textChars: TEXT_CHARS, idsHash: hash, createdAt: new Date().toISOString() }, null, 1));
console.log('EMBEDDING_DONE');
