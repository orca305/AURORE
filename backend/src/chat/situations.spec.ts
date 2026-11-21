import { describe, expect, it } from 'vitest';
import { SITUATIONS, matchSituations, toNormNo } from './situations.js';

describe('situation map', () => {
  it('maps differently worded questions about the same situation to the key articles', () => {
    for (const question of [
      '집 계약이 끝났는데 집주인이 보증금을 안 돌려줘요',
      '전세 만기가 지났는데 보증금을 못 받고 있어요',
      '임대인이 전세금 반환을 계속 미뤄요',
    ])
      expect(matchSituations(question)[0]).toBe('주택임대차보호법|제3조의3');
  });
  it('separates housing from shop leases', () => {
    expect(matchSituations('가게 보증금을 못 돌려받고 있어요')[0]).toBe('상가건물 임대차보호법|제6조');
    expect(matchSituations('가게 월세를 많이 올리겠대요')).toContain('상가건물 임대차보호법|제11조');
    expect(matchSituations('가게 월세를 많이 올리겠대요')).not.toContain('주택임대차보호법|제7조');
  });
  it('ignores spacing and returns nothing for unrelated questions', () => {
    expect(matchSituations('연 장 근 로 수 당을 안 줘요')).toContain('근로기준법|제56조');
    expect(matchSituations('오늘 서울 날씨 어때?')).toEqual([]);
    expect(matchSituations('다음 주 로또 당첨 번호를 알려줘')).toEqual([]);
    expect(matchSituations('')).toEqual([]);
  });
  it('requires every group, so a single common word does not trigger a situation', () => {
    expect(matchSituations('이자')).toEqual([]);
    expect(matchSituations('휴대전화를 샀어요')).not.toContain('도로교통법|제49조');
  });
  it('keeps the first entries first, without duplicates, and bounded', () => {
    const keys = matchSituations('해고 통보를 받았는데 퇴직금과 연차도 못 받았어요', 5);
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('uses well-formed law|article keys with unique ids', () => {
    expect(new Set(SITUATIONS.map((s) => s.id)).size).toBe(SITUATIONS.length);
    for (const situation of SITUATIONS) {
      expect(situation.needs.length).toBeGreaterThan(0);
      for (const key of situation.articles) {
        const [law, article] = key.split('|');
        expect(law.length).toBeGreaterThan(1);
        expect(toNormNo(article)).not.toBeNull();
      }
    }
  });
  it('converts article numbers to the stored norm_no form', () => {
    expect(toNormNo('제3조의3')).toBe('3의3');
    expect(toNormNo('제44조')).toBe('44');
    expect(toNormNo('3조')).toBeNull();
  });
});
