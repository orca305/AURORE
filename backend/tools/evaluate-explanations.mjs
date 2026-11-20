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

// [id, 기대 법령명(하나라도 포함되면 통과, null이면 근거 없음이 정답), 질문, 이전 질문(후속 질문 시나리오만)]
// 기대 법령은 현재 DB에 실제로 있는 법령(85개) 기준이다. 없는 법령의 질문은 null(근거 없음)로 둔다.
const scenarios = [
  ['deposit', ['주택임대차보호법'], '집 계약이 끝났는데 집주인이 보증금을 안 돌려줘요'],
  ['deposit-followup', ['주택임대차보호법'], '그럼 법원에 뭘 신청할 수 있어?', '전세 계약이 끝났는데 보증금을 돌려받지 못하고 있어요'],
  ['lease-renewal', ['주택임대차보호법'], '전세 계약을 갱신하고 싶은데 언제까지 집주인에게 말해야 하나요?'],
  ['shop-rent', ['상가건물 임대차보호법'], '가게 월세를 한 번에 많이 올리겠대요 얼마까지 올릴 수 있나요?'],
  ['wages', ['근로기준법'], '회사가 세 달째 월급을 안 줘요'],
  ['retirement', ['근로자퇴직급여'], '일 년 반 일했는데 사장이 퇴직금을 안 준대요'],
  ['min-wage', ['최저임금법'], '시급이 최저임금보다 적게 받고 있는 것 같아요'],
  ['dismissal', ['근로기준법'], '갑자기 내일부터 나오지 말라고 해고 통보를 받았어요'],
  ['annual-leave', ['근로기준법'], '일 년 일했는데 연차휴가가 며칠인지 궁금해요'],
  ['overtime', ['근로기준법'], '야근을 많이 하는데 연장근로수당을 안 줘요'],
  ['consumer', ['전자상거래'], '온라인으로 산 물건을 환불받고 싶어요 청약철회는 며칠 안에 해야 하나요?'],
  ['consumer-damage', ['소비자기본법'], '산 물건이 불량인데 소비자 피해보상을 받을 수 있나요?'],
  ['article', ['주택임대차보호법'], '주택임대차보호법 제3조 대항력을 갖추려면 무엇이 필요한가요?'],
  ['privacy', ['개인정보 보호법'], '회사가 제 개인정보를 동의 없이 다른 곳에 넘겨도 되나요?'],
  ['drunk-driving', ['도로교통법'], '술을 마시고 운전하면 어떤 기준으로 단속하나요?'],
  ['condo-common', ['집합건물'], '아파트 공용부분을 고치려면 입주민 동의가 필요한가요?'],
  ['broker-fee', ['공인중개사법'], '부동산 중개수수료를 너무 많이 달라고 하는데 기준이 있나요?'],
  ['registration', ['부동산등기법'], '집을 샀는데 소유권 등기는 어떻게 신청하나요?'],
  ['enforcement', ['민사집행법'], '판결을 받았는데 상대방 재산을 압류하려면 어떻게 해야 하나요?'],
  ['prescription', ['민법'], '빌려준 돈을 오래 못 받았는데 소멸시효가 있나요?'],
  ['inheritance', ['민법'], '아버지가 돌아가셨는데 빚이 많아서 상속을 포기하고 싶어요'],
  ['defamation', ['형법'], '인터넷에 제 험담을 올린 사람을 명예훼손으로 처벌할 수 있나요?'],
  ['building-permit', ['건축법'], '허가 없이 집을 증축해도 되나요?'],
  ['birth-report', ['가족관계의 등록'], '아이가 태어났는데 출생신고는 언제까지 해야 하나요?'],
  ['admin-reason', ['행정절차법'], '행정청이 처분을 하면서 이유를 안 알려줘요'],
  ['no-case', null, '2026가단987654321 판결 내용을 알려줘'],
  ['out-industrial', null, '일하다 다쳤는데 산재보상은 어떻게 받나요?'],
  ['out-parental', null, '육아휴직은 몇 개월까지 쓸 수 있나요?'],
  ['out-terms', null, '계약서의 약관이 너무 불공정한데 무효가 되나요?'],
  ['out-interest', null, '돈을 빌려줬는데 이자를 연 50%로 받아도 되나요?'],
  ['out-traffic', null, '교통사고가 났는데 합의금은 얼마가 적당한가요?'],
  ['out-bankruptcy', null, '빚이 너무 많아서 개인회생을 신청하고 싶어요'],
  ['out-copyright', null, '제 사진을 허락 없이 블로그에 쓴 사람에게 저작권 침해를 주장할 수 있나요?'],
  ['out-weather', null, '오늘 서울 날씨 어때?'],
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
    for (const [id, expectedNames, question, history] of scenarios) {
      if (process.env.EVAL_ONLY && !process.env.EVAL_ONLY.split(',').includes(id)) continue;
      const started = performance.now();
      try {
        // 실제 질문 경로(generate)와 같은 방식: 후속 질문 문맥 + 검색어 힌트(차단·인용 근거로는 쓰지 않음).
        const hints = await answers.searchHints(history ? (history.slice(-600) + ' ' + question).slice(-900) : question);
        const text = [history ? '이전 질문(사용자 설명, 확인되지 않은 사실): ' + history : '', hints.length ? '검색어 힌트: ' + hints.join(' ') : ''].filter(Boolean).join('\n');
        const answer = await answers.generateStored(question, { text, asOf });
        const citation = answer.citation;
        // 기대 법령명 중 하나가 인용 라벨에 있어야 한다(엉뚱한 법령을 인용하면 실패). 근거 없음이 정답인 질문에서 인용이 나오면 과잉 답변이다.
        const sourceOk = expectedNames === null ? !citation : Boolean(citation) && expectedNames.some(name => citation.label.includes(name));
        const explained = answer.providerCd === 'LOCAL_EXPLAIN';
        const record = {
          id, question, history: history ?? null, resultCode: answer.resultCd, provider: answer.providerCd,
          explained, citationLabel: citation?.label ?? null, explanation: explained ? answer.text : null,
          // 인용문은 해설과 별개의 원문이어야 한다.
          quoteIsSeparate: citation ? !answer.text.includes(citation.citeCont) : null,
          inCorpus: expectedNames !== null, passed: expectedNames === null ? sourceOk && ['SOURCE_GAP', 'RELEVANCE_GAP'].includes(answer.resultCd) : sourceOk && answer.resultCd === 'EVIDENCE_FOUND',
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
    // 현재 DB에 법령이 있는 질문: 맞는 법령을 찾았는가 / 법령이 없는 질문: 근거 없이 보류했는가(과잉 답변 방지)
    inCorpus: { cases: results.filter(r => r.inCorpus).length, passed: results.filter(r => r.inCorpus && r.passed).length },
    outOfCorpus: { cases: results.filter(r => r.inCorpus === false).length, heldBack: results.filter(r => r.inCorpus === false && r.passed).length },
    evidenceFound: found.length,
    // 근거는 나왔지만 기대한 법령이 아닌 경우(엉뚱한 인용)와, 법령이 없는 질문에 근거를 낸 경우(과잉 답변)
    wrongCitation: results.filter(r => r.inCorpus && r.resultCode === 'EVIDENCE_FOUND' && !r.passed).length,
    overreach: results.filter(r => r.inCorpus === false && r.resultCode === 'EVIDENCE_FOUND').length,
    missed: results.filter(r => r.inCorpus && r.resultCode !== 'EVIDENCE_FOUND').length,
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
