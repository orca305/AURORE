import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatAnswerService, formatExplanation } from './answer.service.js';
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
  vi.spyOn(service, 'explainEvidence').mockResolvedValue(undefined);
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

const QUOTE =
  '임대차가 끝난 후 보증금이 반환되지 아니한 경우 임차인은 임차권등기명령을 신청할 수 있다.';
const EXPLAINED = {
  verified: true,
  summary: '보증금을 못 받았다면 임차권등기명령을 신청할 수 있습니다.',
  summaryBasis: '임차권등기명령을 신청할 수 있다',
  points: [
    {
      kind: 'CONDITION',
      text: '임대차가 끝난 뒤여야 합니다.',
      basis: '임대차가 끝난 후',
    },
  ],
  checkFacts: ['계약 기간이 끝났나요?'],
  needsExpert: true,
};

describe('plain-language explanation of a verified quote', () => {
  it('uses the verified explanation text while keeping the original quote as citation', async () => {
    const { service, candidates } = fixture(1);
    vi.mocked(service.explainEvidence).mockResolvedValue('쉬운 설명');
    vi.spyOn(service, 'generateDocuments').mockResolvedValue({
      phase: 'start',
      text: '',
      documentQuotes: [
        {
          documentId: candidates[0].id,
          quote: candidates[0].markdown,
          mdHash: candidates[0].mdHash,
        },
      ],
    });
    const result = await service.generateStored('보증금 반환', {
      text: '이전 질문',
    });
    expect(result.providerCd).toBe('LOCAL_EXPLAIN');
    expect(result.text).toBe('쉬운 설명');
    expect(result.citation?.citeCont).toBe(candidates[0].markdown);
    expect(service.explainEvidence).toHaveBeenCalledWith(
      '보증금 반환',
      '이전 질문',
      '합성법',
      candidates[0].markdown,
      expect.any(Number),
    );
  });
  it('falls back to the fixed safe text when explanation is unavailable', async () => {
    const { service, candidates } = fixture(1);
    vi.spyOn(service, 'generateDocuments').mockResolvedValue({
      phase: 'start',
      text: '',
      documentQuotes: [
        {
          documentId: candidates[0].id,
          quote: candidates[0].markdown,
          mdHash: candidates[0].mdHash,
        },
      ],
    });
    const result = await service.generateStored('보증금 반환');
    expect(result.providerCd).toBe('LOCAL_RAG');
    expect(result.text).toContain('원문을 찾았습니다');
  });
  it('formats only explanations whose basis spans are in the quote', () => {
    const text = formatExplanation(EXPLAINED, QUOTE)!;
    expect(text).toContain('[조건] 임대차가 끝난 뒤여야 합니다.');
    expect(text).toContain('· 계약 기간이 끝났나요?');
    expect(text).toContain('전문가 상담');
    expect(
      formatExplanation({ ...EXPLAINED, summaryBasis: '즉시 반환' }, QUOTE),
    ).toBeUndefined();
    expect(
      formatExplanation(
        {
          ...EXPLAINED,
          points: [{ kind: 'RULE', text: '설명', basis: '원문에 없음' }],
        },
        QUOTE,
      ),
    ).toBeUndefined();
    expect(
      formatExplanation({ ...EXPLAINED, verified: false }, QUOTE),
    ).toBeUndefined();
  });
  it('masks personal patterns before the question leaves for the explainer', async () => {
    const service = new ChatAnswerService({} as PrismaService);
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await service.explainEvidence(
      '제 번호는 010-1234-5678 이고 test@example.com 입니다. 보증금을 못 받았어요',
      '주민등록번호: 900101-1234567\n이전 질문 내용',
      '주택임대차보호법 제3조의3',
      QUOTE,
      60_000,
    );
    const sent = String(fetcher.mock.calls[0][1]?.body);
    expect(sent).not.toMatch(/010-1234-5678|test@example\.com|1234567/u);
    expect(sent).toContain('[연락처 제외]');
    expect(sent).toContain('보증금을 못 받았어요');
    fetcher.mockRestore();
  });
  it('skips the model call when too little time remains', async () => {
    const service = new ChatAnswerService({} as PrismaService);
    const fetcher = vi.spyOn(globalThis, 'fetch');
    expect(await service.explainEvidence('q', '', 'l', QUOTE, 5_000)).toBe(
      undefined,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('follow-up detection', () => {
  it('flags referential and short questions only', async () => {
    const { isFollowUpQuestion } = await import('./clarification.js');
    expect(isFollowUpQuestion('그럼 내용증명은 어떻게 보내?')).toBe(true);
    expect(isFollowUpQuestion('어떻게 해?')).toBe(true);
    expect(
      isFollowUpQuestion(
        '임대인이 계약 종료 후에도 보증금을 돌려주지 않는데 임차권등기명령은 어느 법원에 신청하나요',
      ),
    ).toBe(false);
  });
});
