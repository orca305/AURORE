// 법령 인덱스 만들기: 법령별 조문 임베딩(bge-m3)의 평균(중심 벡터)을 계산한다. DB는 읽기 전용이며 Ollama 호출은 없다.
// 이름만 임베딩했을 때(1위 43%)보다 조문 내용 평균이 훨씬 잘 맞아(1위 70%, 5위 안 93%, 122문항) 중심 벡터를 쓴다.
// 시행령·시행규칙 등 하위 규정은 제외한다. 사전: D:/DATA/embeddings/bge-m3 (embed-provisions.mjs 로 생성).
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/embed-law-titles.mjs
import 'reflect-metadata';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';

const dir = process.env.AURORE_LAW_TITLE_DIR ?? 'D:/DATA/embeddings/law-titles';
const vdir = process.env.AURORE_VECTOR_DIR ?? 'D:/DATA/embeddings/bge-m3';
const manifest = JSON.parse(await readFile(join(vdir, 'manifest.json'), 'utf8'));
const ids = JSON.parse(await readFile(join(vdir, 'ids.json'), 'utf8')).slice(0, manifest.count);
const position = new Map(ids.map((id, at) => [id, at]));
const vectors = new Int8Array(manifest.count * 1024);
for (let chunk = 0; chunk < manifest.chunks; chunk++) {
  const bytes = await readFile(join(vdir, 'chunk-' + String(chunk).padStart(5, '0') + '.bin'));
  vectors.set(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length), chunk * manifest.chunkSize * 1024);
}
const db = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
await db.$connect();
const rows = await db.$queryRaw`SELECT l.legal_nm AS name, p.id::text AS id FROM legal_provi p JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id JOIN legal_ver v ON v.id=r.legal_ver_id JOIN legal l ON l.id=v.legal_id WHERE NOT p.del_yn AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL AND r.current_yn AND NOT v.del_yn AND NOT l.del_yn AND l.src_cd='MOLEG' AND l.legal_nm !~ '(시행령|시행규칙|규칙|규정|훈령|예규|고시|지침|조례)$'`;
await db.$disconnect();
const names = [...new Set(rows.map((row) => row.name))].sort();
const index = new Map(names.map((name, at) => [name, at]));
const sum = new Float64Array(names.length * 1024), count = new Int32Array(names.length);
for (const { name, id } of rows) {
  const law = index.get(name), at = position.get(id);
  if (law === undefined || at === undefined) continue;
  count[law]++;
  for (let k = 0; k < 1024; k++) sum[law * 1024 + k] += vectors[at * 1024 + k];
}
const centroids = new Int8Array(names.length * 1024);
for (let law = 0; law < names.length; law++) {
  let norm = 0;
  for (let k = 0; k < 1024; k++) norm += sum[law * 1024 + k] ** 2;
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < 1024; k++) centroids[law * 1024 + k] = Math.round((sum[law * 1024 + k] / norm) * 127);
}
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'names.json'), JSON.stringify(names));
await writeFile(join(dir, 'vectors.bin'), Buffer.from(centroids.buffer));
await writeFile(join(dir, 'manifest.json'), JSON.stringify({ model: 'bge-m3', kind: 'centroid', dims: 1024, count: names.length, withArticles: count.filter((c) => c > 0).length, createdAt: new Date().toISOString() }, null, 1));
console.log('법령', names.length, '중심 벡터 있는 법령', count.filter((c) => c > 0).length, dir);
