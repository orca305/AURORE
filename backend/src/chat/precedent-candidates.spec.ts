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
