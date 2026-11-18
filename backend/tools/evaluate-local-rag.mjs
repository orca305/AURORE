import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ChatAnswerService } from '../dist/chat/answer.service.js';
import { collectEvidence } from './law-evidence.mjs';

const questions = [
  ['housing', '001248', '주택임대차보호법 제3조 대항력을 갖추려면 무엇이 필요한가요?'],
  ['labor', '001872', '근로기준법 제43조 임금은 어떤 방법으로 지급해야 하나요?'],
  ['retirement', '009883', '근로자퇴직급여 보장법 제8조 퇴직금 기준은 무엇인가요?'],
  ['privacy', '011357', '개인정보 보호법 제15조 개인정보 수집과 이용은 어떤 경우 가능한가요?'],
  ['criminal', '001692', '형법 제347조 사기죄에 해당하는 행위는 무엇인가요?'],
  ['civil', '001706', '민법 제750조 손해배상 책임은 언제 생기나요?'],
  ['consumer', '009318', '전자상거래 등에서의 소비자보호에 관한 법률 제17조 청약철회 기간은?'],
  ['administrative', '001362', '행정절차법 제21조 처분 사전통지 내용은 무엇인가요?'],
  ['natural-wages', '001872', '회사가 세 달째 월급을 안 줘요'],
  ['natural-deposit', '001248', '집 계약이 끝났는데 집주인이 보증금을 안 돌려줘요'],
  ['natural-retirement', '009883', '일 년 반 일했는데 사장이 퇴직금을 안 준대요'],
  ['natural-privacy', '011357', '제 동의 없이 개인정보를 광고에 이용했어요'],
  ['missing-case', null, '2026가단987654321 판결 내용을 알려줘'],
];

async function main() {
  const [out, asOf] = process.argv.slice(2);
  assert.ok(out && /^\d{4}-\d{2}-\d{2}$/.test(asOf ?? ''), 'Provide output file and evaluation date');
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(database.hostname === '127.0.0.1' && database.port === '5433' && database.pathname === '/aurore_dev_check');
  const ai = new URL(process.env.AURORE_AI_URL);
  assert.ok(ai.hostname === '127.0.0.1' && ai.protocol === 'http:');
  const db = new PrismaService(new ConfigService({ DATABASE_URL: database.href }));
  const answers = new ChatAnswerService(db);
  const results = [];
  try {
    await db.$connect();
    for (const [id, expectedSourceKey, question] of questions) {
      const started = performance.now();
      const response = await fetch(new URL('/intent/analyze', ai), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal: AbortSignal.timeout(16000), redirect: 'error' });
      assert.ok(response.ok);
      const analysis = await response.json();
      // In this evaluation, hints improve search terms but can never become cited legal evidence.
      const context = { asOf, text: (analysis.keywords ?? []).join(' ') };
      let answer;
      try {
        answer = await answers.generateStored(question, context);
      } catch (error) {
        const allowed = new Set(['DocumentAiUpstreamFailure', 'DocumentAiUnavailable', 'DocumentQuoteMismatch', 'DocumentEvidenceInvalid', 'DocumentQuoteDuplicate']);
        const code = allowed.has(error?.message) ? error.message : 'EVALUATION_ERROR';
        results.push({ id, question, analysis, expectedSourceKey, error: code, passed: false, seconds: (performance.now() - started) / 1000 });
        console.log(JSON.stringify({ id, passed: false, error: code }));
        continue;
      }
      const citation = answer.citation;
      let originalMatches = false, sourceMatches = false;
      if (citation) {
        const snapshot = await db.srcSnapshot.findUniqueOrThrow({ where: { id: citation.srcSnapshotId } });
        const validHash = createHash('sha256').update(snapshot.srcCont).digest('hex') === snapshot.contHash;
        const chunks = collectEvidence(JSON.parse(snapshot.srcCont), snapshot.contHash);
        originalMatches = validHash && chunks.some(chunk => chunk.text.includes(citation.citeCont));
        sourceMatches = snapshot.srcKey === expectedSourceKey;
      }
      const passed = expectedSourceKey === null
        ? !citation && ['SOURCE_GAP', 'RELEVANCE_GAP'].includes(answer.resultCd)
        : analysis.available === true && analysis.intent === 'LEGAL' && answer.resultCd === 'EVIDENCE_FOUND' && originalMatches && sourceMatches;
      const record = { id, question, analysis, expectedSourceKey, resultCode: answer.resultCd, provider: answer.providerCd, citationLabel: citation?.label, originalMatches, sourceMatches, passed, seconds: (performance.now() - started) / 1000 };
      results.push(record);
      console.log(JSON.stringify({ id, resultCode: record.resultCode, passed, seconds: record.seconds }));
    }
  } finally {
    await db.$disconnect();
  }
  const latency = results.map(row => row.seconds).sort((a, b) => a - b);
  const summary = { cases: results.length, passed: results.filter(row => row.passed).length, meanSeconds: latency.reduce((a, b) => a + b, 0) / latency.length, p95Seconds: latency[Math.ceil(latency.length * .95) - 1] };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ asOf, syntheticQuestions: true, realOfficialSources: true, databaseWrites: false, summary, results }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(summary));
  if (summary.passed !== summary.cases) process.exitCode = 1;
}
try { await main(); } catch { console.error('LOCAL_RAG_EVALUATION_FAILED: check local services and output path.'); process.exitCode = 1; }
