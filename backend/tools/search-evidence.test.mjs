import assert from 'node:assert/strict';
import test from 'node:test';
import {
  searchTerms,
  searchSelectors,
  evidenceWindow,
} from '../dist/chat/stored-evidence.js';
test('selectors normalize article and case spacing without interpreting dates as case numbers', () => {
  assert.equal(
    searchSelectors('주택임대차보호법 제 03 조 의 003').article,
    '3의3',
  );
  assert.equal(
    searchSelectors('2023 다 258672 판결').caseNumber,
    '2023다258672',
  );
  assert.equal(searchSelectors('2023년 11월 8일').caseNumber, null);
  assert.equal(searchSelectors('제3조의6 관련 판례').includeRelatedCases, true);
  assert.equal(searchSelectors('주택 임대차 보호법의 제3조').namedLaw, true);
  assert.equal(searchSelectors('제3조').namedLaw, false);
});
test('short legal nouns survive particle removal and aliases remain bounded', () => {
  const terms = searchTerms('동의 허가 인가 효과');
  for (const term of ['동의', '허가', '인가', '효과'])
    assert.ok(terms.includes(term));
  assert.deepEqual(searchTerms('세입자는 집주인에게 전세금을 알려주세요'), [
    '임차인',
    '임대인',
    '보증금',
  ]);
  assert.equal(searchTerms('알려주세요').length, 0);
  assert.ok(searchTerms('긴검색어를 '.repeat(100)).length <= 16);
});
test('the window retains the original text and selects a later, denser passage', () => {
  const text =
    '임차인에 관한 가상 도입문입니다. ' +
    '무관한 설명입니다. '.repeat(180) +
    '임차인은 확정일자 기록을 요청했습니다. 보증금 반환에 관한 가상 문장입니다.';
  const result = evidenceWindow(text, ['임차인', '확정일자', '보증금']);
  assert.ok(result.includes('확정일자'));
  assert.ok(result.includes('보증금'));
  assert.ok(text.includes(result));
  assert.ok(result.length <= 1200);
  assert.equal(
    evidenceWindow('가상의 짧은 원문입니다.', []),
    '가상의 짧은 원문입니다.',
  );
});
