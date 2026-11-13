import { pageSize } from './page-size.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AdminGuard } from './admin.guard.js';

type Db = Prisma.TransactionClient;
type Review = {
  id: string;
  caseSourceKey: string;
  caseName: string;
  caseNumber: string;
  lawName: string;
  reference: string;
  versionKey: string;
  effectiveDate: string;
  status: string;
  caseChanged: boolean;
  lawChanged: boolean;
  beforeCaseHash: string;
  caseHash: string;
  beforeHash: string;
  afterHash: string | null;
  beforeText: string;
  currentText: string | null;
  beforeCaseUrl: string;
  caseUrl: string;
  beforeLawUrl: string;
  lawUrl: string | null;
  provisionId: string | null;
};
export type ReviewInput = {
  requestId: string;
  reviewHash: string;
  decision: 'verified' | 'unverified';
  reason: string;
  confirmed: true;
};
const idValue = (id: string) => {
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
    throw new BadRequestException('검토 번호를 확인해 주세요.');
  return BigInt(id);
};
const offsetValue = (raw?: string) => {
  if (raw !== undefined && !/^\d{1,6}$/.test(raw))
    throw new BadRequestException('페이지를 확인해 주세요.');
  const offset = Number(raw ?? 0);
  if (offset > 100000)
    throw new BadRequestException('페이지 범위를 초과했습니다.');
  return offset;
};
function adapter(db: Db) {
  return {
    query: async (sql: string, values: unknown[] = []) => {
      if (
        (/^\s*(?:SELECT|WITH)\b/i.test(sql) &&
          !sql.includes('pg_advisory_xact_lock')) ||
        /\bRETURNING\b/i.test(sql)
      ) {
        const rows = await db.$queryRawUnsafe<unknown[]>(sql, ...values);
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: await db.$executeRawUnsafe(sql, ...values) };
    },
  };
}
const fingerprint = (row: Review) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        row.id,
        row.beforeCaseHash,
        row.caseHash,
        row.beforeHash,
        row.afterHash,
        row.provisionId,
      ]),
    )
    .digest('hex');
async function list(
  db: Db,
  caseKey: string | null,
  offset: number,
  linkId: string | null = null,
  limit = 20,
) {
  const tool = (await import(
    new URL('../../tools/list-precedent-reviews.mjs', import.meta.url).href
  )) as {
    listPrecedentReviews: (
      db: ReturnType<typeof adapter>,
      key: string | null,
      offset: number,
      options: { limit: number; linkId: string | null },
    ) => Promise<{ pending: Review[]; nextOffset: number | null }>;
  };
  return tool.listPrecedentReviews(adapter(db), caseKey, offset, {
    limit,
    linkId,
  });
}
async function pending(db: Db, id: string) {
  const prior = await db.legalPrecProvi.findUnique({
    where: { id: idValue(id) },
    select: {
      precedentRev: { select: { precedent: { select: { srcKey: true } } } },
    },
  });
  if (!prior) throw new NotFoundException('검토 대상을 찾을 수 없습니다.');
  const result = await list(db, prior.precedentRev.precedent.srcKey, 0, id);
  const row = result.pending[0];
  if (!row)
    throw new ConflictException(
      '이미 처리되었거나 원문이 변경된 검토입니다. 목록을 새로고침해 주세요.',
    );
  return row;
}
@Injectable()
export class AdminPrecedentService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AdminGuard,
  ) {}
  async overview(raw?: string, rawLimit?: string) {
    const offset = offsetValue(raw);
    const limit = pageSize(rawLimit);
    return this.db.$transaction(
      async (tx) => ({ ...(await list(tx, null, offset, null, limit)), offset }),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(id: string) {
    idValue(id);
    return this.db.$transaction(
      async (tx) => {
        const row = await pending(tx, id);
        const before = await tx.legalPrecProvi.findUniqueOrThrow({
          where: { id: BigInt(id) },
          select: { precedentRev: { select: { decisionCont: true } } },
        });
        const current = await tx.legalPrecRev.findFirstOrThrow({
          where: {
            currentYn: true,
            precedent: {
              srcCd: 'MOLEG',
              srcKey: row.caseSourceKey,
              delYn: false,
            },
          },
          select: { decisionCont: true },
        });
        return {
          ...row,
          reviewHash: fingerprint(row),
          beforeDecision: before.precedentRev.decisionCont,
          currentDecision: current.decisionCont,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async resolve(id: string, input: ReviewInput, authorization?: string) {
    idValue(id);
    const actor = await this.access.require(authorization);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('검토 사유를 입력해 주세요.');
    const requestHash = createHash('sha256')
      .update(JSON.stringify([id, input.reviewHash, input.decision, reason]))
      .digest('hex');
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))`;
        await this.access.require(authorization, tx);
        const receipt = await tx.legalPrecReviewHist.findUnique({
          where: { id: input.requestId },
        });
        if (receipt) {
          if (
            receipt.userId !== BigInt(actor.id) ||
            receipt.requestHash !== requestHash
          )
            throw new ConflictException('다른 요청에 사용된 처리 번호입니다.');
          return { id: receipt.id, status: receipt.decision };
        }
        const row = await pending(tx, id);
        if (fingerprint(row) !== input.reviewHash)
          throw new ConflictException(
            '검토 중 원문이 바뀌었습니다. 전후 원문을 다시 확인해 주세요.',
          );
        if (input.decision === 'verified' && row.status !== 'READY_TO_REVIEW')
          throw new ConflictException(
            '대상 조문을 하나로 확인할 수 없어 연결을 확정할 수 없습니다.',
          );
        const tool = (await import(
          new URL(
            '../../tools/restore-reviewed-precedent-link.mjs',
            import.meta.url,
          ).href
        )) as {
          restoreReviewedLink: (
            db: ReturnType<typeof adapter>,
            review: object,
          ) => Promise<{ status: string }>;
        };
        try {
          await tool.restoreReviewedLink(adapter(tx), {
            ...row,
            linkId: id,
            reason,
            decision: input.decision,
          });
        } catch {
          throw new ConflictException(
            '원문 검증에 실패했거나 연결이 변경되었습니다. 새로고침 후 다시 확인해 주세요.',
          );
        }
        await tx.legalPrecProvi.update({
          where: { id: BigInt(id) },
          data: { delId: BigInt(actor.id) },
        });
        const next = await tx.legalPrecProvi.findFirstOrThrow({
          where: {
            delYn: false,
            refKey: row.reference,
            precedentRev: {
              currentYn: true,
              precedent: { srcCd: 'MOLEG', srcKey: row.caseSourceKey },
            },
          },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
        const saved = await tx.legalPrecReviewHist.create({
          data: {
            id: input.requestId,
            requestHash,
            userId: BigInt(actor.id),
            priorRefId: BigInt(id),
            nextRefId: next.id,
            decision: input.decision === 'verified' ? 'VERIFIED' : 'UNVERIFIED',
            reason,
            rgstDttm: new Date(Math.floor(Date.now() / 1000) * 1000),
          },
        });
        return { id: saved.id, status: saved.decision };
      },
      { timeout: 30000 },
    );
  }
  async history(raw?: string, rawLimit?: string) {
    const offset = offsetValue(raw);
    const limit = pageSize(rawLimit);
    const rows = await this.db.legalPrecReviewHist.findMany({
      orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        decision: true,
        reason: true,
        rgstDttm: true,
        user: { select: { loginId: true } },
        nextRef: {
          select: {
            refKey: true,
            precedentRev: { select: { caseNm: true, caseNo: true } },
          },
        },
      },
    });
    return {
      items: rows
        .slice(0, limit)
        .map(({ user, nextRef, ...row }) => ({
          ...row,
          operator: user.loginId,
          reference: nextRef.refKey,
          caseName: nextRef.precedentRev.caseNm,
          caseNumber: nextRef.precedentRev.caseNo,
        })),
      offset,
      nextOffset: rows.length > limit && offset < 100000 ? Math.min(100000, offset + limit) : null,
    };
  }
}
