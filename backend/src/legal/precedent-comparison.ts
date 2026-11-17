import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { highlightText } from './text-diff.js';
export async function compareStoredPrecedent(
  db: PrismaService,
  id: bigint,
  beforeId: bigint,
  afterId: bigint,
) {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.legalPrecRev.findMany({
        where: {
          legalPrecId: id,
          id: { in: [beforeId, afterId] },
          precedent: { delYn: false, revisions: { some: { currentYn: true } } },
        },
        select: {
          id: true,
          revNo: true,
          caseNo: true,
          caseNm: true,
          courtNm: true,
          decisionDt: true,
          issueCont: true,
          summaryCont: true,
          decisionCont: true,
          rgstDttm: true,
          snapshot: { select: { srcUrl: true } },
        },
      });
      const before = rows.find((r) => r.id === beforeId),
        after = rows.find((r) => r.id === afterId);
      if (!before || !after)
        throw new NotFoundException('비교할 판례 원문을 찾을 수 없습니다.');
      const metadata = (r: typeof before) =>
        r.caseNm +
        '\n' +
        r.courtNm +
        ' · ' +
        r.caseNo +
        ' · ' +
        r.decisionDt.toISOString().slice(0, 10) +
        ' 선고';
      const sections = [
        ['기본 정보', metadata(before), metadata(after)],
        ['판시사항', before.issueCont ?? '', after.issueCont ?? ''],
        ['판결요지', before.summaryCont ?? '', after.summaryCont ?? ''],
        ['판결문', before.decisionCont, after.decisionCont],
      ];
      if (
        sections.reduce(
          (size, row) => size + row[1].length + row[2].length,
          0,
        ) > 1000000
      )
        throw new BadRequestException(
          '원문이 길어 화면 비교 범위를 초과했습니다. 공식 원문에서 확인해 주세요.',
        );
      const summary = (r: typeof before) => ({
        id: String(r.id),
        revision: r.revNo,
        sourceUrl: r.snapshot.srcUrl,
        collectedAt: r.rgstDttm.toISOString(),
      });
      return {
        caseName: after.caseNm,
        caseNumber: after.caseNo,
        before: summary(before),
        after: summary(after),
        sections: sections.map(([title, a, b]) => ({
          title,
          before: a,
          after: b,
          changed: a.replace(/\s/gu, '') !== b.replace(/\s/gu, ''),
          highlights: highlightText(a, b),
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
