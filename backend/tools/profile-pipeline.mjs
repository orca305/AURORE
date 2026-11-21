// 질문 하나가 처리되는 동안 단계별 시간을 잰다(읽기 전용). 외부 호출(fetch)은 경로별로 합산한다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/profile-pipeline.mjs
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ChatAnswerService } from '../dist/chat/answer.service.js';
import { retrieveStoredEvidence } from '../dist/chat/stored-evidence.js';

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const started = performance.now();
  try { return await realFetch(url, init); }
  finally {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, ms: performance.now() - started });
  }
};

const questions = [
  '집 계약이 끝났는데 집주인이 보증금을 안 돌려줘요',
  '술을 마시고 운전하면 어떤 기준으로 단속하나요?',
  '회사가 세 달째 월급을 안 줘요',
  '프리랜서로 번 돈은 종합소득세를 언제 신고하나요?',
  '식당에서 유통기한이 지난 음식을 팔면 처벌받나요?',
  '오늘 서울 날씨 어때?',
];
const asOf = '2026-11-20';
const db = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
const answers = new ChatAnswerService(db);
await db.$connect();
const fmt = (n) => (n / 1000).toFixed(2) + 's';
for (const question of questions) {
  calls.length = 0;
  const t0 = performance.now();
  const analysis = await answers.analyzeQuery(question);
  const tAnalyze = performance.now() - t0;
  const hints = [...analysis.keywords, ...analysis.terms].slice(0, 8);
  const text = hints.length ? '검색어 힌트: ' + hints.join(' ') : '';
  const t1 = performance.now();
  const found = await retrieveStoredEvidence(db, question, asOf, text, 12, analysis.laws, { pool: 36, legalTerms: analysis.terms, vectorQuery: [question, ...analysis.terms].join(' ') });
  const tRetrieve = performance.now() - t1;
  calls.length = 0;
  const t2 = performance.now();
  const answer = await answers.generateStored(question, { text, asOf });
  const tTotal = performance.now() - t2;
  const by = {};
  for (const c of calls) { by[c.path] = by[c.path] ?? { n: 0, ms: 0 }; by[c.path].n++; by[c.path].ms += c.ms; }
  console.log(`\n${question}`);
  console.log(`  분석 ${fmt(tAnalyze)} | 검색(후보 ${found.length}개) ${fmt(tRetrieve)} | generateStored 전체 ${fmt(tTotal)} → ${answer.resultCd}/${answer.providerCd}`);
  console.log('  generateStored 안의 외부 호출: ' + Object.entries(by).map(([p, v]) => `${p} ×${v.n} ${fmt(v.ms)}`).join(' · '));
}
await db.$disconnect();
