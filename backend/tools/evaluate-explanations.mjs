// 대표 시나리오의 "근거 기반 쉬운 해설" 실제 평가 도구. 실제 DB(읽기 전용)와 실제 로컬 AI가 필요하다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/evaluate-explanations.mjs <새 결과 파일> <기준일 YYYY-MM-DD>
// 사전: backend에서 pnpm build. 결과 파일이 이미 있으면 덮어쓰지 않고 실패한다.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ChatAnswerService } from '../dist/chat/answer.service.js';

// [id, 기대 법령 srcKey, 질문, 이전 질문(후속 질문 시나리오만)]
const scenarios = [
  ['deposit', '001248', '집 계약이 끝났는데 집주인이 보증금을 안 돌려줘요'],
  ['deposit-followup', '001248', '그럼 법원에 뭘 신청할 수 있어?', '전세 계약이 끝났는데 보증금을 돌려받지 못하고 있어요'],
  ['wages', '001872', '회사가 세 달째 월급을 안 줘요'],
  ['retirement', '009883', '일 년 반 일했는데 사장이 퇴직금을 안 준대요'],
  ['consumer', '009318', '온라인으로 산 물건을 환불받고 싶어요 청약철회는 며칠 안에 해야 하나요?'],
  ['article', '001248', '주택임대차보호법 제3조 대항력을 갖추려면 무엇이 필요한가요?'],
  ['no-source', null, '2026가단987654321 판결 내용을 알려줘'],
];

async function main() {
  const [out, asOf] = process.argv.slice(2);
  assert.ok(out && /^\d{4}-\d{2}-\d{2}$/.test(asOf ?? ''), '결과 파일과 기준일(YYYY-MM-DD)이 필요합니다');
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(database.hostname === '127.0.0.1' && ['5433', '15433'].includes(database.port) && database.pathname === '/aurore_dev_check', '개발 확인용 DB만 허용합니다');
  const ai = new URL(process.env.AURORE_AI_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(ai.hostname) && ai.protocol === 'http:', '로컬 AI 주소만 허용합니다');
  const db = new PrismaService(new ConfigService({ DATABASE_URL: database.href }));
  const answers = new ChatAnswerService(db);
  const results = [];
  try {
    await db.$connect();
    for (const [id, expectedSourceKey, question, history] of scenarios) {
      const started = performance.now();
      try {
        // 실제 질문 경로(generate)와 같은 방식: 후속 질문 문맥 + 검색어 힌트(차단·인용 근거로는 쓰지 않음).
        const hints = await answers.searchHints(history ? (history.slice(-600) + ' ' + question).slice(-900) : question);
        const text = [history ? '이전 질문(사용자 설명, 확인되지 않은 사실): ' + history : '', hints.length ? '검색어 힌트: ' + hints.join(' ') : ''].filter(Boolean).join('\n');
        const answer = await answers.generateStored(question, { text, asOf });
        const citation = answer.citation;
        const sourceOk = expectedSourceKey === null ? !citation : Boolean(citation);
        const explained = answer.providerCd === 'LOCAL_EXPLAIN';
        const record = {
          id, question, history: history ?? null, resultCode: answer.resultCd, provider: answer.providerCd,
          explained, citationLabel: citation?.label ?? null, explanation: explained ? answer.text : null,
          // 인용문은 해설과 별개의 원문이어야 한다.
          quoteIsSeparate: citation ? !answer.text.includes(citation.citeCont) : null,
          passed: expectedSourceKey === null ? sourceOk && ['SOURCE_GAP', 'RELEVANCE_GAP'].includes(answer.resultCd) : sourceOk && answer.resultCd === 'EVIDENCE_FOUND',
          seconds: (performance.now() - started) / 1000,
        };
        results.push(record);
        console.log(JSON.stringify({ id, resultCode: record.resultCode, provider: record.provider, passed: record.passed, seconds: +record.seconds.toFixed(1) }));
      } catch (error) {
        results.push({ id, question, error: String(error?.message ?? error).slice(0, 80), passed: false, seconds: (performance.now() - started) / 1000 });
        console.log(JSON.stringify({ id, passed: false, error: results.at(-1).error }));
      }
    }
  } finally {
    await db.$disconnect();
  }
  const found = results.filter(row => row.resultCode === 'EVIDENCE_FOUND');
  const seconds = results.map(row => row.seconds).sort((a, b) => a - b);
  const summary = {
    cases: results.length,
    passed: results.filter(row => row.passed).length,
    evidenceFound: found.length,
    explained: found.filter(row => row.explained).length,
    // 해설 검증 실패로 고정 문구로 되돌아간 비율: 이 값이 높으면 검증이 지나치게 엄격하거나 모델 출력이 불안정하다.
    fallbackRate: found.length ? 1 - found.filter(row => row.explained).length / found.length : null,
    meanSeconds: seconds.reduce((a, b) => a + b, 0) / seconds.length,
    p95Seconds: seconds[Math.ceil(seconds.length * 0.95) - 1],
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ asOf, syntheticQuestions: true, databaseWrites: false, summary, results }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(summary));
  if (summary.passed !== summary.cases) process.exitCode = 1;
}
try { await main(); } catch (error) { console.error('EXPLANATION_EVALUATION_FAILED: ' + String(error?.message ?? error).slice(0, 120)); process.exitCode = 1; }
