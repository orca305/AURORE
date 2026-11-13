import { highlightText } from './text-diff.js';
describe('원문 비교 하이라이트', () => {
  for (const [before, after] of [
    ['같음\n', '같음\n'],
    ['제1조 임대인\n공통\n옛 문장', '제1조 임차인\n공통\n새 문장'],
    ['', '추가\r\n'],
    ['삭제😀', ''],
    ['앞😀뒤', '앞🌅뒤'],
  ])
    it('원문을 정확히 재구성한다: ' + before, () => {
      const diff = highlightText(before, after);
      expect(diff.before.map((x) => x.text).join('')).toBe(before);
      expect(diff.after.map((x) => x.text).join('')).toBe(after);
      expect(
        diff.before.some((x) => x.changed) || diff.after.some((x) => x.changed),
      ).toBe(before !== after);
    });
  it('변경되지 않은 줄은 하이라이트하지 않는다', () => {
    const result = highlightText('옛줄\n공통줄\n옛끝', '새줄\n공통줄\n새끝');
    expect(
      result.before
        .filter((x) => x.changed)
        .map((x) => x.text)
        .join(''),
    ).not.toContain('공통줄');
  });

  it('공백·탭·줄바꿈만 달라지면 강조하지 않고 원문은 보존한다', () => {
    for (const [before, after] of [
      ['제2조 부터\n제4조까지', '제2조부터 제4조까지'],
      ['가\t나\r\n다', '가나 다'],
      ['가\u00a0나\u3000다', '가나 다'],
    ]) {
      const result = highlightText(before, after);
      expect(result.before.map((x) => x.text).join('')).toBe(before);
      expect(result.after.map((x) => x.text).join('')).toBe(after);
      expect(
        result.before.some((x) => x.changed) ||
          result.after.some((x) => x.changed),
      ).toBe(false);
    }
  });
  it('문구 변경과 공백 변경이 섞여도 달라진 글자만 강조한다', () => {
    const result = highlightText('제2조 부터 임대인', '제2조부터 임차인');
    expect(
      result.before
        .filter((x) => x.changed)
        .map((x) => x.text)
        .join(''),
    ).toBe('대');
    expect(
      result.after
        .filter((x) => x.changed)
        .map((x) => x.text)
        .join(''),
    ).toBe('차');
  });
  it('큰 비교는 메모리를 제한하며 원문을 보존한다', () => {
    const before = '이전\n'.repeat(600),
      after = '이후\n'.repeat(600);
    const diff = highlightText(before, after);
    expect(diff.coarse).toBe(true);
    expect(diff.before.map((x) => x.text).join('')).toBe(before);
    expect(diff.after.map((x) => x.text).join('')).toBe(after);
  });
});
