// 검색 단계 진단(읽기 전용): 질문마다 후보 12개에 정답 법령이 있는지, 몇 번째인지, 앞에 어떤 법령이 오는지 본다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/diagnose-retrieval.mjs
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ChatAnswerService } from '../dist/chat/answer.service.js';
import { retrieveStoredEvidence } from '../dist/chat/stored-evidence.js';

const cases = [
  ['deposit', ['주택임대차보호법'], '집 계약이 끝났는데 집주인이 보증금을 안 돌려줘요'],
  ['retirement', ['근로자퇴직급여'], '일 년 반 일했는데 사장이 퇴직금을 안 준대요'],
  ['dismissal', ['근로기준법'], '갑자기 내일부터 나오지 말라고 해고 통보를 받았어요'],
  ['annual-leave', ['근로기준법'], '일 년 일했는데 연차휴가가 며칠인지 궁금해요'],
  ['overtime', ['근로기준법'], '야근을 많이 하는데 연장근로수당을 안 줘요'],
  ['drunk-driving', ['도로교통법'], '술을 마시고 운전하면 어떤 기준으로 단속하나요?'],
  ['defamation', ['형법'], '인터넷에 제 험담을 올린 사람을 명예훼손으로 처벌할 수 있나요?'],
  ['interest', ['이자제한법'], '돈을 빌려줬는데 이자를 연 50%로 받아도 되나요?'],
  ['income-tax', ['소득세법'], '프리랜서로 번 돈은 종합소득세를 언제 신고하나요?'],
  ['national-pension', ['국민연금법'], '국민연금은 몇 살부터 받을 수 있나요?'],
  ['unemployment', ['고용보험법'], '회사를 그만뒀는데 실업급여는 어떤 조건에서 받을 수 있나요?'],
  ['food-hygiene', ['식품위생법'], '식당에서 유통기한이 지난 음식을 팔면 처벌받나요?'],
];
const asOf = '2026-11-20';
const db = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
const answers = new ChatAnswerService(db);
await db.$connect();
const summary = { inTop12: 0, notInTop12: 0, noCandidates: 0 };
for (const [id, expected, question] of cases) {
  // 실제 질문 경로(generateStored)와 같은 인자: 법령 후보 힌트, 후보 풀, 의미 검색(AURORE_VECTOR_SEARCH=0 이면 끔).
  const analysis = await answers.analyzeQuery(question);
  const hints = [...analysis.keywords, ...analysis.terms].slice(0, 8);
  const text = hints.length ? '검색어 힌트: ' + hints.join(' ') : '';
  const found = await retrieveStoredEvidence(db, question, asOf, text, 12, analysis.laws, process.env.DIAG_LEGACY ? {} : { pool: 36, legalTerms: analysis.terms, vectorQuery: [question, ...analysis.terms].join(' ') });
  const labels = found.map(f => f.citation.label.replace(/ · .*$/, ''));
  const rank = labels.findIndex(l => expected.some(e => l.includes(e)));
  if (!found.length) summary.noCandidates++; else if (rank >= 0) summary.inTop12++; else summary.notInTop12++;
  console.log(`${id.padEnd(17)} 정답순위=${rank >= 0 ? rank + 1 : '없음'}  힌트=[${hints.join(',')}]`);
  console.log('   ' + labels.slice(0, 6).join(' | '));
}
console.log(JSON.stringify(summary));
await db.$disconnect();
