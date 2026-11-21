import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PreparedCitation } from './answer.service.js';
import { excerpt, precedentCandidates } from './precedent-candidates.js';

const citation = (label: string, legalVerId: bigint | null = 1n, citeTypeCd = 'LEGAL'): PreparedCitation =>
  ({ label, legalVerId, citeTypeCd, citeCont: '', quoteVerifyCd: 'MATCHED', supportVerifyCd: 'MODEL_REVIEWED' }) as unknown as PreparedCitation;

const row = (idx: number, id: number, old = false) => ({
  idx,
  prec_id: BigInt(id),
  case_no: '2020다' + id,
  case_nm: '손해배상(기)',
  court_nm: '대법원',
  decision_dt: new Date('2021-03-04T00:00:00Z'),
  issue_cont: null,
  summary_cont: '<br/>요지 ' + id,
  old_yn: old,
});

const dbReturning = (rows: ReturnType<typeof row>[]) => ({ $queryRaw: async () => rows }) as unknown as PrismaService;

afterEach(() => {
  delete process.env.AURORE_PRECEDENT_CANDIDATES;
});

describe('excerpt', () => {
  it('br 태그를 줄바꿈으로 바꾸고 길면 줄인다', () => {
    expect(excerpt('<br/>가나다<br/>라')).toBe('가나다\n라');
    expect(excerpt('가'.repeat(600))?.length).toBe(501);
    expect(excerpt('   ')).toBeNull();
    expect(excerpt(null)).toBeNull();
  });
});

describe('precedentCandidates', () => {
  it('법령 조문이 아닌 인용이나 조문 번호가 없는 인용은 건너뛴다', async () => {
    const db = { $queryRaw: async () => { throw new Error('호출되면 안 된다'); } } as unknown as PrismaService;
    expect(await precedentCandidates(db, [citation('대법원 2020다1', 1n, 'PREC'), citation('민법', 1n)])).toEqual([]);
  });

  it('끄면 아무것도 하지 않는다', async () => {
    process.env.AURORE_PRECEDENT_CANDIDATES = '0';
    expect(await precedentCandidates(dbReturning([row(1, 1)]), [citation('민법 제750조')])).toEqual([]);
  });

  it('여러 조문과 겹치는 판례를 먼저 두고 조문별로 최소 한 건을 남긴다', async () => {
    const rows = [row(1, 10), row(1, 11), row(1, 12), row(2, 10), row(2, 20)];
    const result = await precedentCandidates(dbReturning(rows), [citation('민법 제750조(불법행위의 내용)'), citation('민법 제756조')], 2);
    expect(result.map((r) => r.legalPrecId)).toEqual(['10', '20']);
    expect(result[0].matched).toEqual(['민법 제750조', '민법 제756조']);
    expect(result[0].summary).toBe('요지 10');
  });

  it('구 법령 인용은 같은 조건이면 현행 인용보다 뒤로 간다', async () => {
    const rows = [row(1, 1, true), row(1, 2, false)];
    const result = await precedentCandidates(dbReturning(rows), [citation('민법 제750조')], 1);
    expect(result.map((r) => r.legalPrecId)).toEqual(['2']);
  });
});

describe('질문과 겹치는 말로 다시 정렬', () => {
  it('서술어와 흔한 말은 빼고 조사를 뗀 내용어만 쓴다', async () => {
    const { contentStems } = await import('./precedent-candidates.js');
    expect(contentStems('전세 보증금을 못 받았는데 이사를 가면 대항력이 없어지나요?')).toEqual(expect.arrayContaining(['전세', '보증금', '이사', '대항력']));
    expect(contentStems('어떻게 되나요')).toEqual([]);
  });

  it('조문마다 질문과 말이 많이 겹치는 판례를 먼저 고른다', async () => {
    const mk = (id: number, summary: string) => ({ ...row(1, id), summary_cont: summary });
    const rows = [mk(1, '건물 철거에 관한 사건'), mk(2, '권리금 회수를 방해한 임대인의 손해배상'), mk(3, '권리금과 임차인의 보호'), mk(4, '다른 사건'), mk(5, '무관')];
    const result = await precedentCandidates(dbReturning(rows), [citation('상가건물 임대차보호법 제10조의4')], 2, '권리금을 못 받게 방해하면 손해배상을 받나요');
    // 기본은 관련도 순으로만 정렬한다(기준 미만을 빼지 않는다).
    expect(result.map((r) => r.legalPrecId)).toEqual(['2', '3']);
    expect(result[0].score).toBeGreaterThan(result[1].score ?? 0);
    // 최소 관련도를 2로 두면 겹침이 1개뿐인 3번은 뺀다.
    process.env.AURORE_PRECEDENT_MIN_SCORE = '2';
    try {
      const strict = await precedentCandidates(dbReturning(rows), [citation('상가건물 임대차보호법 제10조의4')], 2, '권리금을 못 받게 방해하면 손해배상을 받나요');
      expect(strict.map((r) => r.legalPrecId)).toEqual(['2']);
    } finally {
      delete process.env.AURORE_PRECEDENT_MIN_SCORE;
    }
  });
});
