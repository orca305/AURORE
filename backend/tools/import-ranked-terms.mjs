// rank-terms-by-usage.mjs 가 고른 용어를 법제처에서 다시 받아 용어 DB 에 "초안(DRAFT)"으로 가져온다.
// 관리자 화면의 용어 가져오기(term-import.service)와 같은 규칙을 따른다: 공식 원문 보관(src_snapshot), 원문 해시 검증, 변경 이력 기록,
// 쉬운 풀이는 비워 두고 공개로 바꾸지 않는다. 이미 있는 용어(출처 번호 기준)는 건너뛰고, 중단 후 다시 실행하면 이어서 한다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/import-ranked-terms.mjs <selected.json> <진행 기록 파일> [--apply] [--max N] [--actor 사용자번호]
//   --apply 가 없으면 가져올 목록만 보여 준다. 로컬 개발 DB(127.0.0.1:5433/aurore_dev_check)에만 쓴다.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { MolegTermsClient, sourceFingerprint } from '../dist/terms/moleg-terms.js';
import { prepareTerm, termSnapshot } from '../dist/terms/terms.service.js';

const args = process.argv.slice(2);
const [selectedFile, logFile] = args;
const apply = args.includes('--apply');
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const max = Number(option('--max', 100000));
const actorId = BigInt(option('--actor', '1'));
if (!selectedFile || !logFile || !Number.isInteger(max) || max < 1) throw new Error('OPTIONS_INVALID');
const database = URL.parse(process.env.DATABASE_URL ?? '');
if (!database || database.hostname !== '127.0.0.1' || database.port !== '5433' || database.pathname !== '/aurore_dev_check') throw new Error('LOCAL_DB_REQUIRED');
const oc = process.env.MOLEG_OC?.trim();
if (apply && !oc) throw new Error('MOLEG_OC_REQUIRED');

const selected = JSON.parse(await readFile(selectedFile, 'utf8')).items;
const done = new Set(existsSync(logFile) ? (await readFile(logFile, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line).sourceId) : []);
const db = new PrismaService(new ConfigService({ DATABASE_URL: database.href }));
await db.$connect();
const client = new MolegTermsClient(new ConfigService({ MOLEG_OC: oc ?? '' }));
const counts = {};
const record = async (item, status, extra = {}) => {
  counts[status] = (counts[status] ?? 0) + 1;
  await appendFile(logFile, JSON.stringify({ sourceId: item.sourceId, name: item.name, status, ...extra }) + '\n');
};

try {
  let processed = 0;
  for (const item of selected) {
    if (processed >= max) break;
    if (done.has(item.sourceId)) { counts.RESUMED = (counts.RESUMED ?? 0) + 1; continue; }
    const current = await db.legalTerm.findUnique({ where: { srcCd_srcKey: { srcCd: 'MOLEG_TERM', srcKey: item.sourceId } } });
    if (current) { await record(item, 'EXISTS'); continue; }
    if (!apply) { counts.PLANNED = (counts.PLANNED ?? 0) + 1; processed++; continue; }
    processed++;
    try {
      const incoming = await client.detail(item.sourceId);
      if (incoming.rawHash !== item.rawHash) { await record(item, 'HASH_CHANGED'); continue; } // 수집 때와 원문이 달라졌으면 가져오지 않는다.
      const data = prepareTerm(incoming.data);
      const sourceHash = sourceFingerprint(incoming.data);
      const requestHash = createHash('sha256').update(JSON.stringify({ action: 'IMPORT', sourceId: item.sourceId })).digest('hex');
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'moleg-term:' + item.sourceId}, 0))`;
        const snapshot = await tx.srcSnapshot.upsert({
          where: { srcCd_srcKey_contHash: { srcCd: 'MOLEG_TERM', srcKey: item.sourceId, contHash: incoming.rawHash } },
          create: { srcCd: 'MOLEG_TERM', srcKey: item.sourceId, srcUrl: data.srcUrl, contType: 'application/json', srcCont: incoming.raw, contHash: incoming.rawHash, rgstDttm: now },
          update: {},
        });
        const row = await tx.legalTerm.create({
          data: { ...data, srcCd: 'MOLEG_TERM', srcKey: item.sourceId, srcHash: sourceHash, srcSnapshotId: snapshot.id, statCd: 'DRAFT', pubDttm: null, easyCont: null, uptDttm: now, rgstDttm: now },
        });
        await tx.legalTermHist.create({
          data: { id: randomUUID(), legalTermId: row.id, actorUserId: actorId, revNo: row.revNo, actCd: 'IMPORT', srcSnapshotId: snapshot.id, requestHash, bfData: Prisma.DbNull, afData: termSnapshot(row), rgstDttm: now },
        });
      }, { timeout: 15000 });
      await record(item, 'IMPORTED');
    } catch (error) {
      await record(item, 'FAILED', { reason: String(error?.message ?? error).slice(0, 80) });
    }
    if (processed % 50 === 0) console.log(JSON.stringify({ processed, counts }));
  }
} finally {
  await db.$disconnect();
}
console.log(JSON.stringify({ apply, counts }));
