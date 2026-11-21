import { classifyQuestion } from './intent-routing.js';
import type { JobResultCode } from './job-diagnostics.js';
import { missingEvidence, type ClarifyCode } from './clarification.js';
import { retrieveStoredEvidence, type StoredEvidence } from './stored-evidence.js';
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
  // 후보 조문(최대 3개)마다 질문과의 관련 등급을 한 번에 받는다. 인용 선택은 호출자가 검색 순위와 함께 한다.
  async gradeDocuments(
    question: string,
    documents: DocumentInput[],
    context?: string,
    // 'verify': 선택된 후보 하나를 더 엄격한 기준으로 다시 확인한다.
    mode: 'law' | 'verify' = 'law',
  ): Promise<('direct' | 'related' | 'none')[]> {
    const response = await fetch(this.documentUrl('/documents/grade'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: redactDocument(question).slice(0, 1000) || '질문',
        ...(context ? { context: redactDocument(context).slice(0, 8000) } : {}),
        source: mode,
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
    if (!response.ok) throw new Error('DocumentAiUpstreamFailure');
    const value = (await response.json().catch(() => null)) as {
      grades?: unknown;
      supportChecked?: boolean;
    } | null;
    if (
      !value ||
      value.supportChecked !== true ||
      !Array.isArray(value.grades) ||
      value.grades.length !== documents.length ||
      !value.grades.every((g) => g === 'direct' || g === 'related' || g === 'none')
    )
      throw new Error('DocumentEvidenceInvalid');
    return value.grades as ('direct' | 'related' | 'none')[];
  }
  // 후보 전체(최대 12개)를 한 번에 보여 주고 가장 알맞은 하나와 대안(최대 2개)의 순번을 받는다. 없으면 best 가 null.
  async chooseDocument(
    question: string,
    documents: DocumentInput[],
    context?: string,
  ): Promise<{ best: number | null; alternates: number[] }> {
    const response = await fetch(this.documentUrl('/documents/choose'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: redactDocument(question).slice(0, 1000) || '질문',
        ...(context ? { context: redactDocument(context).slice(0, 8000) } : {}),
        documents: documents.map(({ id, name, markdown }) => ({ id, name, markdown })),
      }),
      signal: AbortSignal.timeout(150000),
      redirect: 'error',
    }).catch(() => {
      throw new Error('DocumentAiUnavailable');
    });
    if (!response.ok) throw new Error('DocumentAiUpstreamFailure');
    const value = (await response.json().catch(() => null)) as {
      best?: unknown;
      alternates?: unknown;
      supportChecked?: boolean;
    } | null;
    const inRange = (n: unknown): n is number =>
      Number.isInteger(n) && (n as number) >= 0 && (n as number) < documents.length;
    if (
      !value ||
      value.supportChecked !== true ||
      !(value.best === null || inRange(value.best)) ||
      !Array.isArray(value.alternates) ||
      value.alternates.length > 2 ||
      !value.alternates.every(inRange) ||
      (value.best === null && value.alternates.length > 0) ||
      new Set([value.best, ...value.alternates]).size !== 1 + value.alternates.length
    )
      throw new Error('DocumentEvidenceInvalid');
    return { best: value.best, alternates: value.alternates as number[] };
  }
  async generateDocuments(
    question: string,
    documents: DocumentInput[],
    context?: string,
    // 'law': 저장된 법령 조문 후보 검토(법령 전용 기준). 생략하면 사용자 첨부자료 기준.
    source?: 'law',
  ): Promise<PreparedAnswer> {
    const response = await fetch(this.documentUrl('/documents/answer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 관련성 검토 모델(외부 모델일 수 있음)로 나가는 사용자 문장은 항상 패턴 마스킹을 거친다.
        question: redactDocument(question).slice(0, 1000) || '질문',
        ...(context ? { context: redactDocument(context).slice(0, 8000) } : {}),
        ...(source ? { source } : {}),
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
    const analysis = await this.analyzeQuery(question);
    // 인용 법령 일치 검사: 인용할 조문의 법령이 질문 분석이 짚은 법령이나 질문과 뜻이 가까운 법령(또는 그 시행령·시행규칙)에
    // 없으면 근거로 확정하지 않는다(다른 후보를 보거나 근거 없음으로 처리). 짚은 법령이 하나도 없으면 판단하지 않는다.
    // AURORE_LAW_GATE=0 으로 끈다.
    const hintedLaws = new Set<string>(analysis.laws);
    const candidates = await retrieveStoredEvidence(
      this.db,
      question,
      context?.asOf,
      context?.text,
      12,
      analysis.laws,
      {
        pool: Number(process.env.AURORE_RETRIEVAL_POOL ?? 36) || 12,
        legalTerms: analysis.terms,
        vectorQuery: [question, ...analysis.terms].join(' '),
        termQuery: [...analysis.terms, ...analysis.laws].join(' '),
        hintedLaws,
      },
    );
    if (!candidates.length) return missingEvidence('SOURCE_GAP', supplement);
    const lawAllowed = (candidate: StoredEvidence) => {
      if (process.env.AURORE_LAW_GATE === '0' || hintedLaws.size === 0) return true;
      if (candidate.citation.citeTypeCd !== 'LEGAL') return true;
      const name = candidate.citation.label.replace(/\s제\d+조.*$/u, '').trim();
      return hintedLaws.has(name) || hintedLaws.has(name.replace(/\s*(시행령|시행규칙)$/u, ''));
    };
    if (!(await this.documentsReady()))
      return {
        phase: 'start',
        providerCd: 'STORED_SEARCH',
        resultCd: 'AI_NOT_READY',
        text: '저장된 법령·판례에서 검색어가 일치하는 원문 후보를 찾았습니다. 로컬 AI가 준비되지 않아 질문 관련성은 검토하지 못했습니다. 이 자료가 상황에 적용된다는 판단은 아닙니다.',
        citation: candidates[0].citation,
      };
    const started = Date.now();
    // 후보 최대 12개를 3개씩 묶어 검토한다. 묶음 2개를 동시에 검토하되 결과는 항상 앞 묶음을 우선한다.
    // 30초가 지나면 새 묶음을 시작하지 않는다(진행 중 호출은 기존 제한 시간을 따른다).
    const batches: StoredEvidence[][] = [];
    for (let offset = 0; offset < candidates.length; offset += 3)
      batches.push(candidates.slice(offset, offset + 3));
    const finish = async (candidate: StoredEvidence, quoteText: string) => {
      const explanation = await this.explainEvidence(
        question,
        context?.text ?? '',
        candidate.citation.label,
        quoteText,
        // Stay well inside the 180s per-attempt race; fall back instead of timing out.
        Math.min(110_000, 150_000 - (Date.now() - started)),
      );
      return {
        phase: 'start' as const,
        providerCd: (explanation ? 'LOCAL_EXPLAIN' : 'LOCAL_RAG') as 'LOCAL_EXPLAIN' | 'LOCAL_RAG',
        resultCd: 'EVIDENCE_FOUND' as const,
        text:
          explanation ??
          '저장된 법령·판례에서 질문과 관련된 원문을 찾았습니다. 아래 근거를 확인해 주세요. 개별 사건의 적용 여부와 적용 시점은 추가 확인이 필요합니다.',
        citation: {
          ...candidate.citation,
          citeCont: quoteText,
          supportVerifyCd: 'MODEL_REVIEWED' as const,
        },
      };
    };
    let reviewed = false;
    let firstFailure: unknown;
    const wave = Math.max(1, Number(process.env.AURORE_REVIEW_PARALLEL ?? 2) || 1);
    // 인용은 원문 그대로여야 하므로 길면 문장 끝에서 잘라 원문의 앞부분을 쓴다.
    const quoteOf = (candidate: StoredEvidence) => {
      const body = candidate.markdown.trim();
      return body.length <= 1200
        ? body
        : body.slice(0, 1200).replace(/[^.。다]*$/u, '') || body.slice(0, 1200);
    };
    const reviewMode = process.env.AURORE_REVIEW_MODE ?? 'grade';
    // 선택 방식(AURORE_REVIEW_MODE=choose): 후보 전체를 한 번에 보고 가장 알맞은 하나를 고른 뒤, 고른 후보(와 대안)를
    // 하나씩 엄격하게 재확인한다. 후보를 서로 비교하므로 독립 등급보다 상대 판단이 가능하고 모델 호출도 적다.
    if (reviewMode === 'choose') {
      const choice = await this.chooseDocument(question, candidates, context?.text);
      reviewed = true;
      const order = choice.best === null ? [] : [choice.best, ...choice.alternates];
      for (const index of order) {
        const candidate = candidates[index];
        if (!lawAllowed(candidate)) continue;
        const verdict = await this.gradeDocuments(
          question,
          [candidate],
          context?.text,
          'verify',
        ).catch((error) => {
          firstFailure ??= error;
          return undefined;
        });
        if (verdict?.[0] === 'direct') return finish(candidate, quoteOf(candidate));
      }
    } else if (reviewMode !== 'classic') {
    // 등급 방식(기본, AURORE_REVIEW_MODE=classic 이면 예전 추출·검토 방식): 묶음마다 후보를 direct/related/none 으로 분류하고,
    // "direct" 후보 중 검색 순위가 가장 높은 것을 인용한다. 추출·검토를 하나로 합쳐 호출 수도 줄어든다.
      for (let at = 0; at < batches.length; at += wave) {
        if (at && Date.now() - started >= 30_000) break;
        const graded = await Promise.allSettled(
          batches
            .slice(at, at + wave)
            .map((batch) => this.gradeDocuments(question, batch, context?.text)),
        );
        const directs: { candidate: StoredEvidence; rank: number }[] = [];
        for (const [index, result] of graded.entries()) {
          if (result.status === 'rejected') {
            firstFailure ??= result.reason;
            continue;
          }
          reviewed = true;
          const batch = batches[at + index];
          for (const [position, grade] of result.value.entries()) {
            const rank = (at + index) * 3 + position;
            if (grade === 'direct') directs.push({ candidate: batch[position], rank });
          }
        }
        // 검색 순위가 높은 "direct" 후보부터 하나씩 엄격하게 다시 확인하고, 통과한 첫 후보를 인용한다(최대 2개 확인).
        directs.sort((x, y) => x.rank - y.rank);
        let pick: { candidate: StoredEvidence; rank: number } | undefined;
        for (const direct of directs.filter((row) => lawAllowed(row.candidate)).slice(0, 2)) {
          const verdict = await this.gradeDocuments(
            question,
            [direct.candidate],
            context?.text,
            'verify',
          ).catch((error) => {
            firstFailure ??= error;
            return undefined;
          });
          if (verdict?.[0] === 'direct') {
            pick = direct;
            break;
          }
        }
        if (pick) return finish(pick.candidate, quoteOf(pick.candidate));
      }
    } else
    for (let at = 0; at < batches.length; at += wave) {
      if (at && Date.now() - started >= 30_000) break;
      const reviews = await Promise.allSettled(
        batches
          .slice(at, at + wave)
          .map((batch) => this.generateDocuments(question, batch, context?.text, 'law')),
      );
      for (const [index, review] of reviews.entries()) {
        if (review.status === 'rejected') {
          firstFailure ??= review.reason;
          continue;
        }
        reviewed = true;
        const batch = batches[at + index];
        // 승인된 인용이 여럿이면 모델이 나열한 순서가 아니라 검색 순위(법령 우선순위·의미 검색 반영)가 높은 후보를 쓴다.
        const quote = [...(review.value.documentQuotes ?? [])].sort(
          (x, y) =>
            batch.findIndex((row) => row.id === x.documentId) -
            batch.findIndex((row) => row.id === y.documentId),
        )[0];
        if (!quote) continue;
        const candidate = batch.find((row) => row.id === quote.documentId)!;
        if (!lawAllowed(candidate)) continue;
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
          providerCd: (explanation ? 'LOCAL_EXPLAIN' : 'LOCAL_RAG') as 'LOCAL_EXPLAIN' | 'LOCAL_RAG',
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
    }
    // 모든 묶음이 검토 자체에 실패했다면(거절이 아니라 오류) 호출자가 알 수 있게 전달한다.
    if (!reviewed && firstFailure) throw firstFailure;
    const gap = missingEvidence('RELEVANCE_GAP', supplement);
    // AI 검토가 거절했더라도, AI가 짚은 법령의 조문이 상위 후보에 있으면 "질문 관련성 미검증" 후보로 함께 보여 준다.
    // 근거로 단정하지 않으며(인용은 UNREVIEWED), AI가 법령을 짚지 못한 질문(날씨·복권 등)에는 보여 주지 않는다.
    // AURORE_GAP_CANDIDATE=0 으로 끈다.
    if (process.env.AURORE_GAP_CANDIDATE !== '0') {
      const named = new Set(analysis.laws);
      const top = candidates
        .slice(0, 6)
        .find((row) => named.has(/^(.+?) 제\d/u.exec(row.citation.label)?.[1] ?? ''));
      if (top)
        return {
          ...gap,
          providerCd: 'STORED_SEARCH',
          text:
            '가장 가까운 검색 후보를 참고용으로 함께 보여 드립니다. 이 조문이 질문에 직접 해당하는지는 AI 검토에서 확인되지 않았습니다. ' +
            gap.text,
          citation: { ...top.citation, supportVerifyCd: 'UNREVIEWED' },
        };
    }
    return gap;
  }

  /**
   * 로컬 모델이 뽑은 최대 5개의 한국어 검색 키워드. 일상 표현("월급을 안 줘요")을
   * 법령 용어로 이어 주는 용도이며, 실패하거나 비활성화되면 빈 목록이다.
   */
  async searchHints(question: string): Promise<string[]> {
    const analysis = await this.analyzeQuery(question);
    return [...analysis.keywords, ...analysis.terms].slice(0, 8);
  }

  private readonly analysisCache = new Map<
    string,
    { keywords: string[]; terms: string[]; laws: string[] }
  >();

  /**
   * 의도 분석 한 번으로 일상어 키워드, 법률용어, 해당 법령 후보를 얻는다. 모두 검색 순위용 힌트일 뿐이다.
   * 법령 후보는 DB에 실제 있는 법령명과 일치할 때만 가점이 되며 인용 근거로 쓰이지 않는다.
   */
  async analyzeQuery(
    question: string,
  ): Promise<{ keywords: string[]; terms: string[]; laws: string[] }> {
    const empty = { keywords: [], terms: [], laws: [] };
    if (process.env.AURORE_SEARCH_HINTS === '0') return empty;
    const cached = this.analysisCache.get(question);
    if (cached) return cached;
    try {
      const response = await fetch(this.documentUrl('/intent/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      if (!response.ok) return empty;
      const body = await response.text();
      if (body.length > 4000) return empty;
      const value = JSON.parse(body) as {
        available?: boolean;
        keywords?: unknown;
        legal_terms?: unknown;
        law_names?: unknown;
      };
      if (value.available !== true || !Array.isArray(value.keywords))
        return empty;
      const clean = (list: unknown, max: number, size: number) =>
        Array.isArray(list)
          ? list
              .filter(
                (word): word is string =>
                  typeof word === 'string' &&
                  word.length >= 1 &&
                  word.length <= size &&
                  /^[가-힣a-zA-Z0-9ㆍ·\s]+$/u.test(word),
              )
              .map((word) => word.trim())
              .slice(0, max)
          : [];
      const result = {
        keywords: clean(value.keywords, 5, 40),
        terms: clean(value.legal_terms, 5, 40),
        laws: clean(value.law_names, 3, 60),
      };
      if (this.analysisCache.size >= 100)
        this.analysisCache.delete(this.analysisCache.keys().next().value!);
      this.analysisCache.set(question, result);
      return result;
    } catch {
      return empty;
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
