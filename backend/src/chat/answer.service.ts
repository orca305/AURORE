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
type DemoReply = { phase: Phase; text: string; source?: DemoSource };
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
export type PreparedAnswer = {
  phase: Phase;
  text: string;
  citation?: PreparedCitation;
};

@Injectable()
export class ChatAnswerService {
  constructor(private readonly db: PrismaService) {}

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
    if (!reply.source) return { phase: reply.phase, text: reply.text };
    const citation = await this.prepareCitation(reply.source);
    if (!citation)
      return {
        phase: 'start',
        text: '현재 저장된 판본과 원문을 대조하지 못해 답변을 보류했습니다.',
      };
    return { phase: reply.phase, text: reply.text, citation };
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
