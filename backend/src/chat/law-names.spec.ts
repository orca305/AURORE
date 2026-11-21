import { describe, expect, it } from 'vitest';
import { matchLawName, normalizeLawName, similarity } from './law-names.js';

const names = ['주택임대차보호법', '주택임대차보호법 시행령', '개인정보 보호법', '학교폭력예방 및 대책에 관한 법률', '민법', '근로기준법', '근로기준법 시행령', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률'];

describe('law name matching', () => {
  it('matches exact names ignoring spacing and middle dots', () => {
    expect(matchLawName('개인정보보호법', names)).toBe('개인정보 보호법');
    expect(matchLawName('남녀고용평등과 일·가정 양립 지원에 관한 법률', names)).toBe('남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률');
    expect(normalizeLawName('「민법」')).toBe('민법');
  });
  it('resolves common abbreviations and their decrees', () => {
    expect(matchLawName('주임법', names)).toBe('주택임대차보호법');
    expect(matchLawName('학폭법', names)).toBe('학교폭력예방 및 대책에 관한 법률');
    expect(matchLawName('주임법 시행령', names)).toBe('주택임대차보호법 시행령');
    expect(matchLawName('남녀고용평등법', names)).toBe('남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률');
  });
  it('uses the closest similar name but refuses weak matches and keeps decrees apart', () => {
    expect(matchLawName('학교폭력 예방 및 대책 법률', names)).toBe('학교폭력예방 및 대책에 관한 법률');
    expect(matchLawName('근로기준법시행령', names)).toBe('근로기준법 시행령');
    expect(matchLawName('우주개발진흥법', names)).toBeNull();
    expect(similarity('가나다', '가나다')).toBe(1);
  });
});
