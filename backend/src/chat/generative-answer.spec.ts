import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatAnswerService, formatGenerative } from './answer.service.js';
import { retrieveStoredEvidence, type StoredEvidence } from './stored-evidence.js';
import type { PrismaService } from '../prisma/prisma.service.js';

vi.mock('./stored-evidence.js', () => ({ retrieveStoredEvidence: vi.fn() }));

const labels = ['민법 제759조(동물의 점유자의 책임)', '동물보호법 제101조(과태료)'];

describe('formatGenerative', () => {
  it('marks grounded items with their article and the rest as general guidance', () => {
    const text = formatGenerative(
      {
        conclusion: '네, 원칙적으로 배상할 책임이 있어요.',
        conclusionRefs: [0],
        actions: [{ text: '치료비 영수증을 받아 두세요.', refs: [] }],
        details: [{ text: '과태료가 나올 수 있어요.', refs: [1, 7] }],
        checkFacts: ['목줄을 했나요?'],
        needsExpert: true,
      },
      labels,
    )!;
    expect(text.startsWith('결론\n네, 원칙적으로 배상할 책임이 있어요. — 근거: 민법 제759조')).toBe(true);
    expect(text).toContain('이렇게 해 보세요\n· 치료비 영수증을 받아 두세요.\n');
    expect(text).not.toContain('일반 안내');
    expect(text).toContain('알아 둘 내용\n· 과태료가 나올 수 있어요. — 근거: 동물보호법 제101조');
    expect(text).toContain('근거 조문 (원문 확인됨)\n· 민법 제759조(동물의 점유자의 책임)\n· 동물보호법 제101조(과태료)');
    expect(text).toContain('전문가 상담');
    expect(formatGenerative({ conclusion: '' }, labels)).toBeUndefined();
  });
});

describe('formatGenerative unverified figures', () => {
  it('keeps sentences with unverified numbers but marks them, and explains why', () => {
    const text = formatGenerative(
      {
        conclusion: '네, 3개월 안에 청구할 수 있어요.',
        conclusionUnverifiedFigure: true,
        conclusionRefs: [],
        details: [{ text: '과태료는 50만원 이하예요.', refs: [1], unverifiedFigure: true }, { text: '기한을 지켜 주세요.', refs: [0] }],
        needsExpert: true,
      },
      labels,
    )!;
    expect(text).toContain('네, 3개월 안에 청구할 수 있어요. (숫자는 원문으로 확인되지 않았어요)\n');
    expect(text).toContain('과태료는 50만원 이하예요. (숫자는 원문으로 확인되지 않았어요) — 근거: 동물보호법 제101조');
    expect(text).toContain('원문으로 확인되지 않은 숫자는 법령 원문이나 관할 기관에서 다시 확인해 주세요.');
    expect(formatGenerative({ conclusion: '네, 할 수 있어요.', needsExpert: true }, labels)).not.toContain('숫자는');
  });
});

describe('generative answer mode', () => {
  beforeEach(() => {
    process.env.AURORE_ANSWER_MODE = 'generative';
  });
  afterEach(() => {
    delete process.env.AURORE_ANSWER_MODE;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  const candidates: StoredEvidence[] = labels.map((label, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    name: label,
    markdown: '원문 ' + (index + 1),
    mdHash: 'a'.repeat(64),
    citation: {
      srcSnapshotId: BigInt(index + 1), legalVerId: BigInt(index + 1), legalPrecId: null, citeTypeCd: 'LEGAL', citeCont: '원문 ' + (index + 1),
      label: label.replace(/\(.*$/u, '') + ' · 2026-01-01 시행본', srcUrl: 'https://www.law.go.kr/', viewHref: '/legals/1', quoteVerifyCd: 'MATCHED', supportVerifyCd: 'UNREVIEWED',
    },
  }));
  const setup = () => {
    vi.mocked(retrieveStoredEvidence).mockResolvedValue(candidates);
    const service = new ChatAnswerService({ $queryRaw: vi.fn().mockResolvedValue([{ name: '민법' }]) } as unknown as PrismaService);
    vi.spyOn(service, 'analyzeQuery').mockResolvedValue({ keywords: [], terms: [], laws: [] });
    return service;
  };
  it('puts proposed articles first in the search and cites the first grounded provision', async () => {
    const service = setup();
    vi.spyOn(service, 'proposeArticles').mockResolvedValue({ legal: true, citations: [{ law: '민법', article: '제759조' }] });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ verified: true, legal: true, conclusion: '네, 책임이 있어요.', conclusionRefs: [0], actions: [], details: [], cautions: [], checkFacts: [], needsExpert: true })),
    );
    const result = await service.generateStored('반려견이 이웃을 물었어요');
    // 검색은 조문 짚기가 끝나기 전에 시작하고, 짚은 조문은 약속(promise)으로 넘긴다.
    expect(await vi.mocked(retrieveStoredEvidence).mock.calls[0][6]?.priorityArticles).toEqual(['민법|759']);
    expect(result.resultCd).toBe('EVIDENCE_FOUND');
    expect(result.citation?.srcSnapshotId).toBe(1n);
    expect(result.citation?.supportVerifyCd).toBe('MODEL_REVIEWED');
    expect(result.text).toContain('도움 받을 곳');
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    // 짚은 법령(민법)이 아닌 동물보호법 조문은 인용 법령 일치 검사로 근거 목록에서 빠진다.
    expect(body.provisions.map((p: { label: string }) => p.label)).toEqual(['민법 제759조']);
  });
  it('does not answer non-legal questions', async () => {
    const service = setup();
    vi.spyOn(service, 'proposeArticles').mockResolvedValue({ legal: false, citations: [] });
    const result = await service.generateStored('오늘 점심 뭐 먹지');
    expect(result.resultCd).toBe('RELEVANCE_GAP');
    expect(result.citation).toBeUndefined();
  });
});

describe('generative answer: provisions from unrelated laws are not offered as evidence', () => {
  afterEach(() => {
    delete process.env.AURORE_ANSWER_MODE;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it('filters candidates by the cited-law check before the answer model sees them', async () => {
    process.env.AURORE_ANSWER_MODE = 'generative';
    const make = (label: string, id: number) => ({
      id: `00000000-0000-4000-8000-00000000000${id}`, name: label, markdown: '원문 ' + id, mdHash: 'a'.repeat(64),
      citation: { srcSnapshotId: BigInt(id), legalVerId: BigInt(id), legalPrecId: null, citeTypeCd: 'LEGAL', citeCont: '원문 ' + id, label: label + ' · 2026-01-01 시행본', srcUrl: 'https://www.law.go.kr/', viewHref: '/legals/1', quoteVerifyCd: 'MATCHED', supportVerifyCd: 'UNREVIEWED' },
    });
    vi.mocked(retrieveStoredEvidence).mockResolvedValue([make('여권법 제15조', 1), make('상속세 및 증여세법 제68조', 2), make('여권법 시행규칙 제11조', 3)]);
    const service = new ChatAnswerService({ $queryRaw: vi.fn().mockResolvedValue([{ name: '여권법' }]) } as unknown as PrismaService);
    vi.spyOn(service, 'analyzeQuery').mockResolvedValue({ keywords: [], terms: [], laws: ['여권법'] });
    vi.spyOn(service, 'proposeArticles').mockResolvedValue({ legal: true, citations: [{ law: '여권법', article: '제15조' }] });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ verified: true, legal: true, conclusion: '네, 재발급할 수 있어요.', conclusionRefs: [1], actions: [], details: [], cautions: [], checkFacts: [], needsExpert: true })),
    );
    const result = await service.generateStored('여권을 잃어버렸어요');
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.provisions.map((p: { label: string }) => p.label)).toEqual(['여권법 제15조', '여권법 시행규칙 제11조']);
    expect(result.citation?.label).toContain('여권법 시행규칙 제11조');
  });
});

describe('formatGenerative precedents', () => {
  const labels = ['민법 제759조(동물의 점유자의 책임)'];
  const precedents = [
    { short: '대법원 2024다208865', full: '대법원 2024다208865 (2025-01-09 선고) · 손해배상(기)' },
    { short: '대법원 2019다100', full: '대법원 2019다100 (2020-02-03 선고) · 보증금반환' },
  ];

  it('판례 항목에는 판례 표시를 붙이고, 근거 판례 목록에는 쓴 판례만 넣는다', () => {
    const text = formatGenerative(
      { conclusion: '네, 책임이 있을 수 있어요.', conclusionRefs: [0], precedentNotes: [{ text: '법원은 목줄 없이 산책시킨 경우 주의의무를 다했다고 보기 어렵다고 판단했어요.', refs: [0] }] },
      labels,
      precedents,
    )!;
    expect(text).toContain('관련 판례');
    expect(text).toContain('· 법원은 목줄 없이 산책시킨 경우 주의의무를 다했다고 보기 어렵다고 판단했어요. — 판례: 대법원 2024다208865');
    expect(text).toContain('근거 판례 (판결 요지 확인됨)\n· 대법원 2024다208865 (2025-01-09 선고) · 손해배상(기)');
    expect(text).not.toContain('2019다100');
    expect(text.indexOf('근거 조문 (원문 확인됨)')).toBeLessThan(text.indexOf('근거 판례'));
  });

  it('범위 밖 번호와 후보에 없는 사건번호가 든 판례 문장은 버리고, 남는 것이 없으면 판례 구역을 만들지 않는다', () => {
    const text = formatGenerative(
      {
        conclusion: '네, 책임이 있을 수 있어요.',
        precedentNotes: [
          { text: '법원은 그렇게 판단했어요.', refs: [9] },
          { text: '대법원 2099다1 판결은 그렇게 봤어요.', refs: [0] },
          { text: '', refs: [0] },
        ],
      },
      labels,
      precedents,
    )!;
    expect(text).not.toContain('관련 판례');
    expect(text).not.toContain('근거 판례');
  });

  it('판례 후보가 없으면 판례 항목이 와도 표시하지 않는다', () => {
    const text = formatGenerative({ conclusion: '네.', precedentNotes: [{ text: '법원은 판단했어요.', refs: [0] }] }, labels)!;
    expect(text).not.toContain('판례');
  });
});
