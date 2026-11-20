import { classifyQuestion } from './intent-routing.js';
import type { JobResultCode } from './job-diagnostics.js';
import { missingEvidence, type ClarifyCode } from './clarification.js';
import { retrieveStoredEvidence } from './stored-evidence.js';
import { Injectable } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { redactDocument } from '../documents/document-text.js';

export type Phase = 'start' | 'lease-end' | 'renewal-delivery';
type DemoSource = {
  kind: 'law' | 'case';
  sourceKey: string;
  hash: string;
  quote: string;
  label: string;
  url: string;
  date?: string;
  article?: string;
  caseNumber?: string;
};
type DemoReply = {
  phase: Phase;
  text: string;
  source?: DemoSource;
  search?: boolean;
};
export type PreparedCitation = {
  srcSnapshotId: bigint;
  legalVerId: bigint | null;
  legalPrecId: bigint | null;
  citeTypeCd: string;
  citeCont: string;
  label: string;
  srcUrl: string;
  viewHref: string;
  quoteVerifyCd: string;
  supportVerifyCd: string;
};
export type DocumentInput = {
  id: string;
  name: string;
  markdown: string;
  mdHash: string;
};
export type DocumentEvidence = {
  documentId: string;
  quote: string;
  mdHash: string;
};
export type PreparedAnswer = {
  resultCd?: JobResultCode;
  clarifyCd?: ClarifyCode;
  providerCd?: 'LOCAL_RAG' | 'LOCAL_EXPLAIN' | 'STORED_SEARCH';
  documentQuotes?: DocumentEvidence[];
  phase: Phase;
  text: string;
  citation?: PreparedCitation;
};

const EXPLAIN_KINDS: Record<string, string> = {
  RULE: '내용',
  CONDITION: '조건',
  EXCEPTION: '예외',
};
// 공백·줄바꿈 차이만 허용하고 글자는 원문과 같아야 한다(AI 서버 검증과 동일).
const inQuote = (quote: string, span: string) => {
  const flat = span.replace(/\s+/gu, '');
  return flat.length >= 4 && quote.replace(/\s+/gu, '').includes(flat);
};
/** Re-checks the AI server's contract (basis spans are verbatim) before display. */
export function formatExplanation(
  value: unknown,
  quote: string,
): string | undefined {
  const row = value as {
    verified?: unknown;
    summary?: unknown;
    summaryBasis?: unknown;
    points?: unknown;
    checkFacts?: unknown;
    needsExpert?: unknown;
  };
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (
    !row ||
    row.verified !== true ||
    !text(row.summary, 300) ||
    !text(row.summaryBasis, 600) ||
    !inQuote(quote, row.summaryBasis as string) ||
    !Array.isArray(row.points) ||
    row.points.length < 1 ||
    row.points.length > 4 ||
    !Array.isArray(row.checkFacts) ||
    row.checkFacts.length > 3 ||
    typeof row.needsExpert !== 'boolean'
  )
    return;
  const points: string[] = [];
  for (const point of row.points as {
    kind?: unknown;
    text?: unknown;
    basis?: unknown;
  }[]) {
    if (
      !point ||
      typeof point.kind !== 'string' ||
      !EXPLAIN_KINDS[point.kind] ||
      !text(point.text, 300) ||
      !text(point.basis, 600) ||
      !inQuote(quote, point.basis as string)
    )
      return;
    points.push(
      '· [' + EXPLAIN_KINDS[point.kind] + '] ' + (point.text as string).trim(),
    );
  }
  if (!row.checkFacts.every((fact) => text(fact, 160))) return;
  const lines = [(row.summary as string).trim(), '', ...points];
  if (row.checkFacts.length)
    lines.push(
      '',
      '이 조문이 적용되는지 확인할 점',
      ...(row.checkFacts as string[]).map((fact) => '· ' + fact.trim()),
    );
  lines.push(
    '',
    row.needsExpert
      ? '실제 분쟁이나 절차 진행이 걸린 문제라면 변호사·법률구조공단 등 전문가 상담을 함께 받아 보세요.'
      : '개별 사정에 따라 결론이 달라질 수 있으니 아래 원문과 시행일을 함께 확인해 주세요.',
  );
  return lines.join('\n');
}

@Injectable()
export class ChatAnswerService {
  constructor(private readonly db: PrismaService) {}

  private documentUrl(path: string) {
    // 해설만 별도 서버(예: 외부 모델을 붙인 AI 서버)로 보낼 수 있다. 어느 쪽이든 루프백만 허용한다.
    const base =
      (path === '/legal/explain' && process.env.AURORE_EXPLAIN_URL) ||
      (path === '/documents/answer' && process.env.AURORE_REVIEW_URL) ||
      process.env.AURORE_AI_URL ||
      'http://127.0.0.1:8000';
    const url = new URL(path, base);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol)
    )
      throw new Error('DocumentAiMustBeLocal');
    return url;
  }
  async documentsReady() {
    try {
      const response = await fetch(this.documentUrl('/documents/health'), {
        signal: AbortSignal.timeout(1500),
        redirect: 'error',
      });
      if (!response.ok) return false;
      const value = (await response.json()) as { ready?: boolean };
      return value.ready === true;
    } catch {
      return false;
    }
  }
  async generateDocuments(
    question: string,
    documents: DocumentInput[],
    context?: string,
  ): Promise<PreparedAnswer> {
    const response = await fetch(this.documentUrl('/documents/answer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 관련성 검토 모델(외부 모델일 수 있음)로 나가는 사용자 문장은 항상 패턴 마스킹을 거친다.
        question: redactDocument(question).slice(0, 1000) || '질문',
        ...(context ? { context: redactDocument(context).slice(0, 8000) } : {}),
        documents: documents.map(({ id, name, markdown }) => ({
          id,
          name,
          markdown,
        })),
      }),
      signal: AbortSignal.timeout(150000),
      redirect: 'error',
    }).catch(() => {
      throw new Error('DocumentAiUnavailable');
    });
    if (!response.ok)
      throw new Error(
        response.status === 502
          ? 'DocumentAiUpstreamFailure'
          : 'DocumentAiUnavailable',
      );
    const body = await response.text().catch(() => {
      throw new Error('DocumentAiUnavailable');
    });
    if (body.length > 20000) throw new Error('DocumentAiResponseLimit');
    let value: {
      quotes?: { documentId: string; quote: string }[];
      supportChecked?: boolean;
    };
    try {
      value = JSON.parse(body) as typeof value;
    } catch {
      throw new Error('DocumentEvidenceInvalid');
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !Array.isArray(value.quotes) ||
      value.quotes.length > 3 ||
      value.supportChecked !== true
    )
      throw new Error('DocumentEvidenceInvalid');
    const seen = new Set<string>();
    const quotes = value.quotes.map((row) => {
      if (!row || typeof row !== 'object')
        throw new Error('DocumentEvidenceInvalid');
      const source = documents.find((doc) => doc.id === row.documentId);
      if (
        !source ||
        typeof row.quote !== 'string' ||
        Array.from(row.quote).length < 8 ||
        Array.from(row.quote).length > 1200 ||
        !source.markdown.includes(row.quote)
      )
        throw new Error('DocumentQuoteMismatch');
      const key = row.documentId + ':' + row.quote;
      if (seen.has(key)) throw new Error('DocumentQuoteDuplicate');
      seen.add(key);
      return { documentId: source.id, quote: row.quote, mdHash: source.mdHash };
    });
    return {
      phase: 'start',
      text: quotes.length
        ? '선택한 첨부자료에서 질문과 관련된 내용을 찾았습니다. 아래 인용문을 확인해 주세요.'
        : '선택한 첨부자료에서 질문에 직접 관련된 원문을 확인하지 못했습니다. 자료나 질문을 구체적으로 확인해 주세요.',
      resultCd: quotes.length ? 'EVIDENCE_FOUND' : 'DOCUMENT_GAP',
      documentQuotes: quotes,
    };
  }

  async generate(
    question: string,
    phase: string,
    history?: string,
  ): Promise<PreparedAnswer> {
    const tools = (await import(
      new URL('../../tools/demo-conversation.mjs', import.meta.url).href
    )) as {
      answerDemoConversation: (
        question: string,
        phase: string,
        load: () => Promise<unknown>,
      ) => Promise<DemoReply>;
    };
    const reply = await tools.answerDemoConversation(
      question,
      phase,
      async () => {
        const directory = process.env.AURORE_LAW_SNAPSHOT_DIR;
        if (!directory || !isAbsolute(directory))
          throw new Error('Source directory unavailable');
        const evidence = (await import(
          new URL('../../tools/law-evidence.mjs', import.meta.url).href
        )) as {
          loadEvidence: (directory: string) => Promise<unknown>;
        };
        return evidence.loadEvidence(directory);
      },
    );
    if (reply.search) {
      const intent = await classifyQuestion(
        question,
        process.env.AURORE_AI_URL || 'http://127.0.0.1:8000',
      );
      if (intent === 'GENERAL')
        return {
          phase: 'start',
          resultCd: 'GUIDANCE',
          text: '일상 이야기도 괜찮아요. 어떤 이야기를 나누고 싶으세요?',
        };
      if (intent === 'CLARIFY')
        return {
          phase: 'start',
          resultCd: 'FACTS_UNCONFIRMED',
          text: '어떤 상황인지 조금 더 설명해 주시겠어요? 법률 문제라면 궁금한 점과 관련된 사실을 함께 알려 주세요.',
        };
      // 의도 분석은 검색어 힌트로만 쓴다. 차단·분기·인용 근거로는 쓰지 않는다.
      // 후속 질문은 이전 질문과 함께 분석해야 "법원에 뭘 신청해?" 같은 흔한 단어에 검색이 끌려가지 않는다.
      const hints = await this.searchHints(
        history
          ? (history.replace(/^[^:]*:\s*/u, '').slice(-600) + ' ' + question).slice(-900)
          : question,
      );
      const text = [history, hints.length ? '검색어 힌트: ' + hints.join(' ') : '']
        .filter(Boolean)
        .join('\n');
      return this.generateStored(question, text ? { text } : undefined);
    }
    if (!reply.source)
      return {
        phase: reply.phase,
        text: reply.text,
        resultCd: reply.phase === 'start' ? 'GUIDANCE' : 'FACTS_UNCONFIRMED',
      };
    const citation = await this.prepareCitation(reply.source);
    if (!citation)
      return {
        phase: 'start',
        resultCd: 'SOURCE_CHANGED',
        text: '현재 저장된 판본과 원문을 대조하지 못해 답변을 보류했습니다.',
      };
    return { phase: reply.phase, text: reply.text, citation };
  }

  async generateStored(
    question: string,
    context?: { text: string; asOf?: string },
    supplement = false,
  ): Promise<PreparedAnswer> {
    const candidates = await retrieveStoredEvidence(
      this.db,
      question,
      context?.asOf,
      context?.text,
      12,
    );
    if (!candidates.length) return missingEvidence('SOURCE_GAP', supplement);
    if (!(await this.documentsReady()))
      return {
        phase: 'start',
        providerCd: 'STORED_SEARCH',
        resultCd: 'AI_NOT_READY',
        text: '저장된 법령·판례에서 검색어가 일치하는 원문 후보를 찾았습니다. 로컬 AI가 준비되지 않아 질문 관련성은 검토하지 못했습니다. 이 자료가 상황에 적용된다는 판단은 아닙니다.',
        citation: candidates[0].citation,
      };
    const started = Date.now();
    // Check at most 12 bounded candidates in the existing three-document contract.
    // Stop starting additional batches after 30s; an in-flight call keeps its existing timeout.
    for (let offset = 0; offset < candidates.length; offset += 3) {
      if (offset && Date.now() - started >= 30_000) break;
      const batch = candidates.slice(offset, offset + 3);
      const answer = await this.generateDocuments(
        question,
        batch,
        context?.text,
      );
      const quote = answer.documentQuotes?.[0];
      if (!quote) continue;
      const candidate = batch.find((row) => row.id === quote.documentId)!;
      const explanation = await this.explainEvidence(
        question,
        context?.text ?? '',
        candidate.citation.label,
        quote.quote,
        // Stay well inside the 180s per-attempt race; fall back instead of timing out.
        Math.min(110_000, 150_000 - (Date.now() - started)),
      );
      return {
        phase: 'start',
        providerCd: explanation ? 'LOCAL_EXPLAIN' : 'LOCAL_RAG',
        resultCd: 'EVIDENCE_FOUND',
        text:
          explanation ??
          '저장된 법령·판례에서 질문과 관련된 원문을 찾았습니다. 아래 근거를 확인해 주세요. 개별 사건의 적용 여부와 적용 시점은 추가 확인이 필요합니다.',
        citation: {
          ...candidate.citation,
          citeCont: quote.quote,
          supportVerifyCd: 'MODEL_REVIEWED',
        },
      };
    }
    return missingEvidence('RELEVANCE_GAP', supplement);
  }

  /**
   * 로컬 모델이 뽑은 최대 5개의 한국어 검색 키워드. 일상 표현("월급을 안 줘요")을
   * 법령 용어로 이어 주는 용도이며, 실패하거나 비활성화되면 빈 목록이다.
   */
  async searchHints(question: string): Promise<string[]> {
    if (process.env.AURORE_SEARCH_HINTS === '0') return [];
    try {
      const response = await fetch(this.documentUrl('/intent/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      if (!response.ok) return [];
      const body = await response.text();
      if (body.length > 4000) return [];
      const value = JSON.parse(body) as {
        available?: boolean;
        keywords?: unknown;
      };
      if (value.available !== true || !Array.isArray(value.keywords)) return [];
      return value.keywords
        .filter(
          (word): word is string =>
            typeof word === 'string' &&
            word.length >= 1 &&
            word.length <= 40 &&
            /^[가-힣a-zA-Z0-9 ]+$/u.test(word),
        )
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  /**
   * Plain-language explanation of one verified quote. Returns undefined on any
   * failure so the caller keeps its fixed safe text; the quote itself is stored
   * separately as the citation and is never replaced by model output.
   */
  async explainEvidence(
    question: string,
    context: string,
    label: string,
    quote: string,
    budgetMs = 110_000,
  ): Promise<string | undefined> {
    if (process.env.AURORE_EXPLAIN === '0' || budgetMs < 20_000) return;
    try {
      const response = await fetch(this.documentUrl('/legal/explain'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 해설 모델(외부 모델일 수 있음)로 나가는 사용자 문장은 항상 패턴 마스킹을 거친다.
        // 서술 속 이름·주소까지 완전히 가리지는 못하므로 정책·동의 문구와 함께 판단한다.
        body: JSON.stringify({
          question: redactDocument(question).slice(0, 1000) || '질문',
          context: redactDocument(context).slice(0, 2000),
          evidence: { label: label.slice(0, 200), quote },
        }),
        signal: AbortSignal.timeout(budgetMs),
        redirect: 'error',
      });
      if (!response.ok) return;
      const body = await response.text();
      if (body.length > 20000) return;
      return formatExplanation(JSON.parse(body), quote);
    } catch {
      return;
    }
  }

  private async prepareCitation(
    source: DemoSource,
  ): Promise<PreparedCitation | undefined> {
    const common = {
      citeCont: source.quote,
      label: source.label,
      srcUrl: source.url,
      quoteVerifyCd: 'MATCHED',
      supportVerifyCd: 'REVIEWED_DEMO',
    };
    if (source.kind === 'case') {
      const revision = await this.db.legalPrecRev.findFirst({
        where: {
          currentYn: true,
          caseNo: source.caseNumber,
          precedent: { srcCd: 'MOLEG', srcKey: source.sourceKey, delYn: false },
          snapshot: { contHash: source.hash },
        },
        select: { legalPrecId: true, srcSnapshotId: true },
      });
      if (!revision) return;
      return {
        ...common,
        srcSnapshotId: revision.srcSnapshotId,
        legalPrecId: revision.legalPrecId,
        legalVerId: null,
        citeTypeCd: 'PREC',
        viewHref:
          '/precedents?' +
          new URLSearchParams({ q: source.caseNumber ?? '' }) +
          '#case-' +
          source.sourceKey,
      };
    }
    if (!source.date || !source.article) return;
    const revision = await this.db.legalVerRev.findFirst({
      where: {
        currentYn: true,
        snapshot: { contHash: source.hash },
        version: {
          delYn: false,
          enfcDt: new Date(source.date),
          legal: { srcCd: 'MOLEG', srcKey: source.sourceKey, delYn: false },
        },
      },
      select: {
        legalVerId: true,
        srcSnapshotId: true,
        version: { select: { legalId: true } },
      },
    });
    if (!revision?.srcSnapshotId) return;
    return {
      ...common,
      srcSnapshotId: revision.srcSnapshotId,
      legalVerId: revision.legalVerId,
      legalPrecId: null,
      citeTypeCd: 'LEGAL',
      viewHref:
        '/legals/' +
        revision.version.legalId +
        '/versions/' +
        revision.legalVerId +
        '?' +
        new URLSearchParams({ q: source.article, asOf: source.date }),
    };
  }
}
