import { describe, expect, it } from 'vitest';
import { articleNorm, clip, referencedArticles } from './related-provisions.js';
import { helpContactLines } from './help-contacts.js';

describe('related provisions helpers', () => {
  it('normalises article numbers from labels', () => {
    expect(articleNorm('주택임대차보호법 제7조 · 2026-01-02 시행본')).toBe('7');
    expect(articleNorm('민법 제1112조의2')).toBe('1112의2');
    expect(articleNorm('부칙')).toBeNull();
  });
  it('keeps references to the same law only, without itself or duplicates', () => {
    const text = '제3조에 따른 대항력과 제3조의2제2항에 따른 우선변제권은 제7조와 같다. 「민법」 제618조, 같은 법 제5조, 법 제9조를 준용한다. 제3조';
    expect(referencedArticles(text, '7')).toEqual(['3', '3의2']);
  });
  it('clips long text at a line boundary without rewriting it', () => {
    const text = '첫째 줄입니다.\n둘째 줄입니다.\n셋째 줄입니다.';
    expect(clip(text, 18)).toBe('첫째 줄입니다.\n둘째 줄입니다.');
    expect(clip('짧은 글', 100)).toBe('짧은 글');
  });
});

describe('help contacts', () => {
  it('maps the cited law (and its decrees) to fixed contacts and always ends with legal aid', () => {
    expect(helpContactLines('학교폭력예방 및 대책에 관한 법률 제20조 · 2026-06-02 시행본')[0]).toContain('117');
    expect(helpContactLines('근로기준법 시행령 제30조')[0]).toContain('1350');
    const lines = helpContactLines('주택임대차보호법 제3조의3');
    expect(lines.filter((line) => line.includes('132'))).toHaveLength(1);
    expect(helpContactLines('알 수 없는 법 제1조')).toEqual(['· 대한법률구조공단 법률상담: 132']);
  });
  it('can be switched off', () => {
    process.env.AURORE_HELP_CONTACTS = '0';
    expect(helpContactLines('근로기준법 제1조')).toEqual([]);
    delete process.env.AURORE_HELP_CONTACTS;
  });
});
