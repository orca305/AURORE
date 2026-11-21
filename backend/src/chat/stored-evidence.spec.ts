import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  rerankRows,
  retrieveStoredEvidence,
  searchTerms,
  weightedTerms,
} from './stored-evidence.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('search term weighting', () => {
  it('ranks hint terms above plain terms and generic court words lowest', () => {
    const { terms, weight } = weightedTerms(
      '그럼 법원에 뭘 신청할 수 있어?',
      '이전 질문(사용자 설명, 확인되지 않은 사실): 전세 계약\n검색어 힌트: 보증금 법원 신청',
    );
    expect(weight('보증금')).toBe(4);
    expect(weight('법원')).toBe(1);
    expect(weight('뭘')).toBe(2);
    // 힌트 단어는 16개 제한에서 밀리지 않는다.
    expect(terms.slice(0, 2)).toEqual(['보증금', '법원']);
  });
  it('keeps plain weighting without hints and never grants weight to context text alone', () => {
    const { weight } = weightedTerms('보증금 반환', '이전 질문: 전세');
    expect(weight('보증금')).toBe(2);
    expect(weight('전세')).toBe(2);
  });
});

describe('official source field selection', () => {
  it('searches official wage terminology for everyday salary expressions', () => {
    expect(searchTerms('월급을 못 받았어요')).toContain('임금');
    expect(searchTerms('급여가 밀렸어요')).toContain('임금');
  });
  it('quotes an original paragraph instead of the article heading alone', async () => {
    const paragraph =
      '임금은 통화로 직접 근로자에게 그 전액을 지급하여야 한다.';
    const raw = JSON.stringify({
      법령: {
        법령키: 'synthetic-edition',
        기본정보: {
          법령ID: '000001',
          법령명_한글: '합성법',
          시행일자: '20261101',
        },
        조문: {
          조문단위: [
            {
              조문여부: '조문',
              조문번호: '43',
              조문제목: '임금 지급',
              조문내용: '제43조(임금 지급)',
              항: [
                { 항번호: '①', 항내용: paragraph },
                {
                  항번호: '②',
                  항내용:
                    '임금은 매월 한 번 이상 일정한 날짜를 정하여 지급하여야 한다.',
                },
              ],
            },
          ],
        },
      },
    });
    const snapshot = {
      id: 1n,
      srcCd: 'MOLEG',
      srcKey: '000001',
      srcCont: raw,
      contHash: createHash('sha256').update(raw).digest('hex'),
      srcUrl: 'https://www.law.go.kr/',
    };
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          kind: 'LEGAL',
          snapshotId: 1n,
          targetId: 2n,
          legalId: 3n,
          sourceKey: '000001',
          edition: 'synthetic-edition',
          date: '20261101',
          article: '43',
          title: '합성법 제43조',
          score: 1,
        },
      ]),
      srcSnapshot: { findMany: vi.fn().mockResolvedValue([snapshot]) },
    } as unknown as PrismaService;
    const result = await retrieveStoredEvidence(
      db,
      '합성법 제43조 임금은 어떤 방법으로 지급하나요?',
      '2026-11-19',
    );
    expect(result).toHaveLength(2);
    expect(result.map((row) => row.markdown)).toContain(paragraph);
    expect(result[0].markdown).not.toBe('제43조(임금 지급)');
    expect(result[0].citation.citeCont).toBe(result[0].markdown);
    expect(result[0].citation.quoteVerifyCd).toBe('MATCHED');
  });
});

describe('deterministic rerank', () => {
  const row = (sourceKey: string, proviNm: string, score: number) => ({ kind: 'LEGAL', sourceKey, title: sourceKey, proviNm, score });
  it('promotes articles whose heading contains a legal term from the analysis', () => {
    const rows = [row('a', '임대차 기간', 10), row('b', '술에 취한 상태에서의 운전 금지', 8)];
    expect(rerankRows(rows, { legalTerms: ['운전 금지'], limit: 2 }).map((r) => r.sourceKey)).toEqual(['b', 'a']);
  });
  it('keeps the original order without legal terms and caps articles per law', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row('same', '제목' + n, 10 - n)).concat([row('other', '다른 법', 1)]);
    const result = rerankRows(rows, { legalTerms: [], limit: 6, perLawCap: 4 });
    expect(result.map((r) => r.sourceKey)).toEqual(['same', 'same', 'same', 'same', 'other']);
  });
  it('never boosts case rulings', () => {
    const rows = [{ kind: 'PREC', sourceKey: 'p', title: 'p', proviNm: '운전 금지', score: 1 }, row('a', '무관', 2)];
    expect(rerankRows(rows, { legalTerms: ['운전 금지'], limit: 2 }).map((r) => r.sourceKey)).toEqual(['a', 'p']);
  });
});
