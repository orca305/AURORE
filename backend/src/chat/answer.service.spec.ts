import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatAnswerService, formatExplanation } from './answer.service.js';
import {
  retrieveStoredEvidence,
  type StoredEvidence,
} from './stored-evidence.js';
import type { PrismaService } from '../prisma/prisma.service.js';

vi.mock('./stored-evidence.js', () => ({ retrieveStoredEvidence: vi.fn() }));
// 기존 시험은 추출·검토 방식(classic)을 전제로 한다. 기본값인 등급 방식은 아래 별도 시험에서 확인한다.
beforeEach(() => {
  process.env.AURORE_REVIEW_MODE = 'classic';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env.AURORE_REVIEW_MODE;
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
  // 질의 분석은 로컬 AI를 호출하므로 검색 단위 시험에서는 빈 결과로 고정한다.
  vi.spyOn(service, 'analyzeQuery').mockResolvedValue({
    keywords: [],
    terms: [],
    laws: [],
  });
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
      [],
      expect.objectContaining({ pool: 36 }),
    );
  });
  it('reviews two batches at once but prefers the earlier batch', async () => {
    const { service, candidates } = fixture(6);
    const quote = (index: number) => ({ phase: 'start' as const, text: '', documentQuotes: [{ documentId: candidates[index].id, quote: candidates[index].markdown, mdHash: candidates[index].mdHash }] });
    const model = vi.spyOn(service, 'generateDocuments').mockResolvedValueOnce(quote(1)).mockResolvedValueOnce(quote(4));
    const result = await service.generateStored('보증금 반환');
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.citation?.srcSnapshotId).toBe(2n);
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
  it('shows the closest candidate as unreviewed when the AI named its law but the review rejected everything', async () => {
    const { service, candidates } = fixture(4);
    candidates.forEach((row, index) => {
      row.citation.label = `합성법 제${index + 1}조 · 2026-01-01 시행본`;
    });
    vi.spyOn(service, 'analyzeQuery').mockResolvedValue({
      keywords: [],
      terms: [],
      laws: ['합성법'],
    });
    vi.spyOn(service, 'generateDocuments').mockResolvedValue({
      phase: 'start',
      text: '',
      documentQuotes: [],
    });
    const result = await service.generateStored('근거가 애매한 질문');
    expect(result.resultCd).toBe('RELEVANCE_GAP');
    expect(result.providerCd).toBe('STORED_SEARCH');
    expect(result.citation?.supportVerifyCd).toBe('UNREVIEWED');
    expect(result.citation?.label).toContain('합성법 제1조');
    expect(result.text).toContain('참고용');
    // 후보 표시는 끌 수 있고, 끄면 근거 없이 보류한다.
    vi.stubEnv('AURORE_GAP_CANDIDATE', '0');
    const off = await service.generateStored('근거가 애매한 질문');
    expect(off.citation).toBeUndefined();
    vi.unstubAllEnvs();
  });
  it('does not show a candidate when its law was not named by the AI', async () => {
    const { service, candidates } = fixture(4);
    candidates.forEach((row, index) => {
      row.citation.label = `다른법 제${index + 1}조 · 2026-01-01 시행본`;
    });
    vi.spyOn(service, 'analyzeQuery').mockResolvedValue({
      keywords: [],
      terms: [],
      laws: ['합성법'],
    });
    vi.spyOn(service, 'generateDocuments').mockResolvedValue({
      phase: 'start',
      text: '',
      documentQuotes: [],
    });
    const result = await service.generateStored('무관한 질문');
    expect(result.resultCd).toBe('RELEVANCE_GAP');
    expect(result.citation).toBeUndefined();
  });
  it('stops launching more batches after its search budget', async () => {
    process.env.AURORE_REVIEW_PARALLEL = '1';
    const { service } = fixture(12);
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(35_000);
    const model = vi
      .spyOn(service, 'generateDocuments')
      .mockResolvedValue({ phase: 'start', text: '', documentQuotes: [] });
    expect((await service.generateStored('추가 확인')).resultCd).toBe(
      'RELEVANCE_GAP',
    );
    expect(model).toHaveBeenCalledTimes(1);
    delete process.env.AURORE_REVIEW_PARALLEL;
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

describe('grade-based review (default)', () => {
  beforeEach(() => {
    delete process.env.AURORE_REVIEW_MODE;
  });
  it('quotes the highest-ranked direct candidate after the strict re-check', async () => {
    const { service, candidates } = fixture(6);
    const grade = vi
      .spyOn(service, 'gradeDocuments')
      .mockResolvedValueOnce(['none', 'direct', 'direct']) // 묶음 1: 순위 2·3번이 direct
      .mockResolvedValueOnce(['direct', 'none', 'none']) // 묶음 2
      .mockResolvedValueOnce(['direct']); // 엄격 재확인: 2번째 후보 통과
    const result = await service.generateStored('보증금 반환');
    expect(result.resultCd).toBe('EVIDENCE_FOUND');
    expect(result.citation?.srcSnapshotId).toBe(candidates[1].citation.srcSnapshotId);
    expect(result.citation?.citeCont).toBe(candidates[1].markdown);
    expect(result.citation?.supportVerifyCd).toBe('MODEL_REVIEWED');
    expect(grade.mock.calls.at(-1)?.[3]).toBe('verify');
  });
  it('falls through to the next direct candidate when the re-check rejects the first', async () => {
    const { service, candidates } = fixture(3);
    vi.spyOn(service, 'gradeDocuments')
      .mockResolvedValueOnce(['direct', 'direct', 'none'])
      .mockResolvedValueOnce(['none'])
      .mockResolvedValueOnce(['direct']);
    const result = await service.generateStored('보증금 반환');
    expect(result.citation?.srcSnapshotId).toBe(candidates[1].citation.srcSnapshotId);
  });
  it('reports a relevance gap and never cites when nothing is direct or the re-check rejects', async () => {
    const { service } = fixture(3);
    vi.spyOn(service, 'gradeDocuments')
      .mockResolvedValueOnce(['related', 'none', 'direct'])
      .mockResolvedValueOnce(['none']);
    const result = await service.generateStored('날씨');
    expect(result.resultCd).toBe('RELEVANCE_GAP');
    expect(result.citation).toBeUndefined();
  });
  it('surfaces a model failure instead of reporting a false gap', async () => {
    const { service } = fixture(3);
    vi.spyOn(service, 'gradeDocuments').mockRejectedValue(new Error('DocumentAiUpstreamFailure'));
    await expect(service.generateStored('보증금')).rejects.toThrow('DocumentAiUpstreamFailure');
  });
});

describe('choose-one review mode', () => {
  beforeEach(() => {
    process.env.AURORE_REVIEW_MODE = 'choose';
  });
  it('re-checks the chosen candidate and cites it', async () => {
    const { service, candidates } = fixture(6);
    const choose = vi
      .spyOn(service, 'chooseDocument')
      .mockResolvedValue({ best: 4, alternates: [1] });
    const grade = vi.spyOn(service, 'gradeDocuments').mockResolvedValue(['direct']);
    const result = await service.generateStored('보증금 반환');
    expect(result.resultCd).toBe('EVIDENCE_FOUND');
    expect(result.citation?.srcSnapshotId).toBe(candidates[4].citation.srcSnapshotId);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose.mock.calls[0][1]).toHaveLength(6);
    expect(grade).toHaveBeenCalledTimes(1);
    expect(grade.mock.calls[0][3]).toBe('verify');
  });
  it('falls back to the alternate when the re-check rejects the best, and reports a gap when all are rejected', async () => {
    const { service, candidates } = fixture(4);
    vi.spyOn(service, 'chooseDocument').mockResolvedValue({ best: 0, alternates: [2] });
    vi.spyOn(service, 'gradeDocuments')
      .mockResolvedValueOnce(['none'])
      .mockResolvedValueOnce(['direct']);
    const result = await service.generateStored('보증금 반환');
    expect(result.citation?.srcSnapshotId).toBe(candidates[2].citation.srcSnapshotId);
    vi.spyOn(service, 'gradeDocuments').mockResolvedValue(['none']);
    const gap = await service.generateStored('보증금 반환');
    expect(gap.resultCd).toBe('RELEVANCE_GAP');
    expect(gap.citation).toBeUndefined();
  });
  it('never cites anything when nothing was chosen', async () => {
    const { service } = fixture(3);
    vi.spyOn(service, 'chooseDocument').mockResolvedValue({ best: null, alternates: [] });
    const grade = vi.spyOn(service, 'gradeDocuments');
    const result = await service.generateStored('날씨');
    expect(result.resultCd).toBe('RELEVANCE_GAP');
    expect(grade).not.toHaveBeenCalled();
  });
  it('surfaces a model failure instead of reporting a false gap', async () => {
    const { service } = fixture(3);
    vi.spyOn(service, 'chooseDocument').mockRejectedValue(new Error('DocumentAiUpstreamFailure'));
    await expect(service.generateStored('보증금')).rejects.toThrow('DocumentAiUpstreamFailure');
  });
});

describe('cited-law consistency gate', () => {
  beforeEach(() => {
    delete process.env.AURORE_REVIEW_MODE;
    delete process.env.AURORE_LAW_GATE;
  });
  afterEach(() => {
    delete process.env.AURORE_LAW_GATE;
  });
  const named = (service: ChatAnswerService, laws: string[]) =>
    vi.spyOn(service, 'analyzeQuery').mockResolvedValue({ keywords: [], terms: [], laws });
  it('does not confirm a citation whose law the analysis did not point at', async () => {
    const { service } = fixture(3);
    named(service, ['다른법']);
    const grade = vi.spyOn(service, 'gradeDocuments').mockResolvedValue(['direct', 'direct', 'direct']);
    const result = await service.generateStored('질문');
    expect(result.resultCd).toBe('RELEVANCE_GAP');
    expect(result.citation).toBeUndefined();
    // 통과하지 못한 후보는 엄격 재확인(추가 모델 호출)도 하지 않는다.
    expect(grade).toHaveBeenCalledTimes(1);
  });
  it('allows a citation from a pointed-at law and its decree', async () => {
    const { service } = fixture(3);
    named(service, ['합성법']);
    vi.spyOn(service, 'gradeDocuments').mockResolvedValue(['direct', 'direct', 'direct']);
    expect((await service.generateStored('질문')).resultCd).toBe('EVIDENCE_FOUND');
  });
  it('does not judge when nothing was pointed at, and can be switched off', async () => {
    const { service } = fixture(3);
    vi.spyOn(service, 'gradeDocuments').mockResolvedValue(['direct', 'direct', 'direct']);
    expect((await service.generateStored('질문')).resultCd).toBe('EVIDENCE_FOUND');
    named(service, ['다른법']);
    process.env.AURORE_LAW_GATE = '0';
    expect((await service.generateStored('질문')).resultCd).toBe('EVIDENCE_FOUND');
  });
});
