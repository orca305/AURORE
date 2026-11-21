// 검토 단계 진단(읽기 전용): 평가에서 근거를 못 찾은 질문의 후보를 3개씩 검토 서버에 넣어
// 묶음마다 "추출 건수 → 승인 건수"와 정답 조문 포함 여부를 보여 준다. (검토 서버를 AURORE_REVIEW_DEBUG=1 로 띄워야 건수가 보인다)
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/diagnose-review.mjs <평가 결과 json> [main|holdout] [id,id,...]
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ChatAnswerService } from '../dist/chat/answer.service.js';
import { retrieveStoredEvidence } from '../dist/chat/stored-evidence.js';

const [resultFile, setName = 'main', only] = process.argv.slice(2);
const source = readFileSync(new URL('./evaluate-explanations.mjs', import.meta.url), 'utf8');
const grab = (name) => new Function('return ' + source.slice(source.indexOf(`const ${name} = [`) + `const ${name} = `.length, source.indexOf('\n];', source.indexOf(`const ${name} = [`)) + 2))();
const scenarios = grab(setName === 'holdout' ? 'holdout' : 'scenarios');
const previous = JSON.parse(readFileSync(resultFile, 'utf8')).results;
const wanted = only ? new Set(only.split(',')) : null;
const failed = new Set(previous.filter((r) => r.inCorpus && r.resultCode !== 'EVIDENCE_FOUND' || (r.inCorpus && !r.passed)).map((r) => r.id));
const db = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
const answers = new ChatAnswerService(db);
await db.$connect();
const base = process.env.AURORE_AI_URL;
const short = (label) => label.replace(/ · .*$/, '');
const total = { cases: 0, expectedInPool: 0, expectedBatchApproved: 0, anyApproved: 0 };
for (const [id, expected, question] of scenarios) {
  if (wanted ? !wanted.has(id) : !failed.has(id)) continue;
  const analysis = await answers.analyzeQuery(question);
  const hints = [...analysis.keywords, ...analysis.terms].slice(0, 8);
  const text = hints.length ? '검색어 힌트: ' + hints.join(' ') : '';
  const found = await retrieveStoredEvidence(db, question, '2026-11-20', text, 12, analysis.laws, { pool: 36, legalTerms: analysis.terms, vectorQuery: [question, ...analysis.terms].join(' '), termQuery: [...analysis.terms, ...analysis.laws].join(' ') });
  total.cases++;
  const isExpected = (row) => expected.some((name) => row.citation.label.includes(name));
  console.log(`\n## ${id} — ${question}\n   기대=${expected.join('/')}  후보 ${found.length}개`);
  let inPool = false, expApproved = false, anyApproved = false;
  for (let at = 0; at < found.length; at += 3) {
    const batch = found.slice(at, at + 3);
    const response = await fetch(new URL('/documents/answer', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(150000),
      body: JSON.stringify({ question, context: text, source: 'law', documents: batch.map(({ id: docId, name, markdown }) => ({ id: docId, name, markdown })) }),
    }).catch(() => null);
    const value = response?.ok ? await response.json() : null;
    const approved = (value?.quotes ?? []).map((q) => batch.find((row) => row.id === q.documentId));
    const dbg = value?.debug ? `추출 ${value.debug.extracted} → 승인 ${value.debug.approved}` : value ? '(debug 꺼짐)' : '검토 오류';
    const marks = batch.map((row) => (isExpected(row) ? '★' : ' ') + short(row.citation.label));
    if (batch.some(isExpected)) inPool = true;
    if (approved.some((row) => row && isExpected(row))) expApproved = true;
    if (approved.length) anyApproved = true;
    console.log(`   묶음${at / 3 + 1}: ${dbg} | ${marks.join(' | ')}${approved.length ? '  ✔ ' + approved.map((r) => r && short(r.citation.label)).join(',') : ''}`);
  }
  if (inPool) total.expectedInPool++;
  if (expApproved) total.expectedBatchApproved++;
  if (anyApproved) total.anyApproved++;
}
console.log('\n' + JSON.stringify(total));
await db.$disconnect();
