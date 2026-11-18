import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatAnswerService } from './answer.service.js';
import {
  retrieveStoredEvidence,
  type StoredEvidence,
} from './stored-evidence.js';
import type { PrismaService } from '../prisma/prisma.service.js';

vi.mock('./stored-evidence.js', () => ({ retrieveStoredEvidence: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function fixture(count: number) {
  const candidates: StoredEvidence[] = Array.from(
    { length: count },
    (_, index) => {
      const text = `합성 검증 원문 ${index + 1}입니다.`;
      return {
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        name: `합성 자료 ${index + 1}`,
        markdown: text,
        mdHash: 'a'.repeat(64),
        citation: {
          srcSnapshotId: BigInt(index + 1),
          legalVerId: 1n,
          legalPrecId: null,
          citeTypeCd: 'LEGAL',
          citeCont: text,
          label: '합성법',
          srcUrl: 'https://www.law.go.kr/',
          viewHref: '/legals/1',
          quoteVerifyCd: 'MATCHED',
          supportVerifyCd: 'UNREVIEWED',
        },
      };
    },
  );
  vi.mocked(retrieveStoredEvidence).mockResolvedValue(candidates);
  const service = new ChatAnswerService({} as PrismaService);
  vi.spyOn(service, 'documentsReady').mockResolvedValue(true);
  return { service, candidates };
}

describe('bounded source relevance search', () => {
  it('checks the next batch when the first candidates contain no relevant quote', async () => {
    const { service, candidates } = fixture(4);
    const model = vi
      .spyOn(service, 'generateDocuments')
      .mockResolvedValueOnce({ phase: 'start', text: '', documentQuotes: [] })
      .mockResolvedValueOnce({
        phase: 'start',
        text: '',
        documentQuotes: [
          {
            documentId: candidates[3].id,
            quote: candidates[3].markdown,
            mdHash: candidates[3].mdHash,
          },
        ],
      });
    const result = await service.generateStored('보증금 반환');
    expect(result.resultCd).toBe('EVIDENCE_FOUND');
    expect(result.citation?.srcSnapshotId).toBe(4n);
    expect(result.citation?.supportVerifyCd).toBe('MODEL_REVIEWED');
    expect(model.mock.calls.map((call) => call[1].length)).toEqual([3, 1]);
    expect(retrieveStoredEvidence).toHaveBeenCalledWith(
      expect.anything(),
      '보증금 반환',
      undefined,
      undefined,
      12,
    );
  });
  it('exhausts at most four batches without inventing a citation', async () => {
    const { service } = fixture(12);
    const model = vi
      .spyOn(service, 'generateDocuments')
      .mockResolvedValue({ phase: 'start', text: '', documentQuotes: [] });
    const result = await service.generateStored('근거가 부족한 질문');
    expect(result.resultCd).toBe('RELEVANCE_GAP');
    expect(result.citation).toBeUndefined();
    expect(model).toHaveBeenCalledTimes(4);
  });
  it('stops launching more batches after its search budget', async () => {
    const { service } = fixture(12);
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(35_000);
    const model = vi
      .spyOn(service, 'generateDocuments')
      .mockResolvedValue({ phase: 'start', text: '', documentQuotes: [] });
    expect((await service.generateStored('추가 확인')).resultCd).toBe(
      'RELEVANCE_GAP',
    );
    expect(model).toHaveBeenCalledTimes(1);
  });
});
