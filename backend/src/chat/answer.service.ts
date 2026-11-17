import { classifyQuestion } from './intent-routing.js';
import type { JobResultCode } from './job-diagnostics.js';
import { missingEvidence, type ClarifyCode } from './clarification.js';
import { retrieveStoredEvidence } from './stored-evidence.js';
import { Injectable } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';

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
  providerCd?: 'LOCAL_RAG' | 'STORED_SEARCH';
  documentQuotes?: DocumentEvidence[];
  phase: Phase;
  text: string;
  citation?: PreparedCitation;
};

@Injectable()
export class ChatAnswerService {
  constructor(private readonly db: PrismaService) {}

  private documentUrl(path: string) {
    const url = new URL(
      path,
      process.env.AURORE_AI_URL || 'http://127.0.0.1:8000',
    );
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
        question,
        ...(context ? { context } : {}),
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

  async generate(question: string, phase: string): Promise<PreparedAnswer> {
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
      return this.generateStored(question);
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
    const answer = await this.generateDocuments(
      question,
      candidates,
      context?.text,
    );
    const quote = answer.documentQuotes?.[0];
    if (!quote) return missingEvidence('RELEVANCE_GAP', supplement);
    const candidate = candidates.find((row) => row.id === quote.documentId)!;
    return {
      phase: 'start',
      providerCd: 'LOCAL_RAG',
      resultCd: 'EVIDENCE_FOUND',
      text: '저장된 법령·판례에서 질문과 관련된 원문을 찾았습니다. 아래 근거를 확인해 주세요. 개별 사건의 적용 여부와 적용 시점은 추가 확인이 필요합니다.',
      citation: {
        ...candidate.citation,
        citeCont: quote.quote,
        supportVerifyCd: 'MODEL_REVIEWED',
      },
    };
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
