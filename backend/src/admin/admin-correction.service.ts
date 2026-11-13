import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LegalCorrHist } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminGuard } from './admin.guard.js';
import {
  AdminRefreshService,
  type Correction,
} from './admin-refresh.service.js';

export type Approval = {
  requestId: string;
  beforeHash: string;
  afterHash: string;
  confirmed: true;
};
type Sample = {
  hash: string;
  sourceKey: string;
  versionKey: string;
  date: string;
  raw: string;
  chunks: unknown[];
  promulgated: string;
  title: string;
  url: string;
};
const second = () => new Date(Math.floor(Date.now() / 1000) * 1000);
function result(row: LegalCorrHist) {
  return {
    id: row.id,
    status: row.statCd,
    resultCode: row.resultCd,
    revision: row.revNo,
    affectedCount: row.affectedCnt,
    finishedAt: row.endDttm.toISOString(),
  };
}

@Injectable()
export class AdminCorrectionService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly access: AdminGuard,
    private readonly refresh: AdminRefreshService,
  ) {}
  private replay(
    row: LegalCorrHist,
    userId: bigint,
    id: string,
    input: Approval,
  ) {
    if (
      row.userId !== userId ||
      row.reviewKey !== id ||
      row.beforeHash !== input.beforeHash ||
      row.afterHash !== input.afterHash
    )
      throw new ConflictException('이미 다른 요청에 사용된 처리 번호입니다.');
    return result(row);
  }

  async approve(
    id: string,
    input: Approval,
    authorization: string | undefined,
  ) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new ConflictException('검토 대상을 확인해 주세요.');
    const actor = await this.access.require(authorization);
    const userId = BigInt(actor.id);
    const known = await this.db.legalCorrHist.findUnique({
      where: { id: input.requestId },
    });
    if (known) return this.replay(known, userId, id, input);
    const started = second();
    let legalVerId: bigint | null = null;
    let failureCode = 'REVIEW_UNAVAILABLE';
    try {
      const { item, correction } = await this.refresh.verifiedCorrection(id);
      failureCode = 'REVIEW_CHANGED';
      if (
        item.status !== 'ready-to-review' ||
        correction.beforeHash !== input.beforeHash ||
        correction.afterHash !== input.afterHash
      )
        throw new Error('Review no longer matches');
      const version = await this.db.legalVer.findFirst({
        where: {
          verKey: correction.versionKey,
          enfcDt: new Date(correction.effectiveDate),
          delYn: false,
          legal: { srcCd: 'MOLEG', srcKey: correction.lawId, delYn: false },
        },
        select: { id: true },
      });
      if (!version) throw new Error('Edition no longer exists');
      legalVerId = version.id;
      failureCode = 'SOURCE_NOT_CONFIGURED';
      const oc = this.config.get<string>('MOLEG_OC')?.trim();
      if (!oc) throw new Error('Official source access unavailable');
      const tools = (await import(
        new URL('../../tools/check-law-correction.mjs', import.meta.url).href
      )) as {
        getReviewedSample: (
          correction: Correction,
          oc: string,
        ) => Promise<Sample>;
        publishCorrection: (
          db: {
            query: (
              sql: string,
              values?: unknown[],
            ) => Promise<{ rows: unknown[]; rowCount?: number }>;
          },
          correction: Correction,
          sample: Sample,
        ) => Promise<{
          status: string;
          revision?: number;
          affected?: unknown[];
        }>;
      };
      failureCode = 'SOURCE_VERIFY_FAILED';
      // Fetch and verify before taking database locks. Publication rechecks the current source under lock.
      const sample = await tools.getReviewedSample(correction, oc);
      failureCode = 'APPLY_FAILED';
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))`;
          const existing = await tx.legalCorrHist.findUnique({
            where: { id: input.requestId },
          });
          if (existing) return this.replay(existing, userId, id, input);
          failureCode = 'PERMISSION_CHANGED';
          await this.access.require(authorization, tx);
          failureCode = 'APPLY_FAILED';
          const adapter = {
            query: async (sql: string, values: unknown[] = []) => {
              if (
                (/^\s*SELECT\b/i.test(sql) &&
                  !sql.includes('pg_advisory_xact_lock')) ||
                /\bRETURNING\b/i.test(sql)
              )
                return {
                  rows: await tx.$queryRawUnsafe<unknown[]>(sql, ...values),
                };
              return {
                rows: [],
                rowCount: await tx.$executeRawUnsafe(sql, ...values),
              };
            },
          };
          const published = await tools.publishCorrection(
            adapter,
            correction,
            sample,
          );
          if (published.status !== 'corrected' || !published.revision)
            throw new Error('No correction was published');
          return result(
            await tx.legalCorrHist.create({
              data: {
                id: input.requestId,
                reviewKey: id,
                userId,
                legalVerId,
                beforeHash: input.beforeHash,
                afterHash: input.afterHash,
                statCd: 'SUCCEEDED',
                resultCd: 'APPLIED',
                revNo: published.revision,
                affectedCnt: published.affected?.length ?? 0,
                rgstDttm: started,
                endDttm: second(),
              },
            }),
          );
        },
        { timeout: 30000 },
      );
    } catch (error) {
      // If a connection failed after commit, a durable receipt is authoritative.
      const durable = await this.db.legalCorrHist
        .findUnique({ where: { id: input.requestId } })
        .catch(() => null);
      if (durable) return this.replay(durable, userId, id, input);
      try {
        return result(
          await this.db.legalCorrHist.create({
            data: {
              id: input.requestId,
              reviewKey: id,
              userId,
              legalVerId,
              beforeHash: input.beforeHash,
              afterHash: input.afterHash,
              statCd: 'FAILED',
              resultCd: failureCode,
              rgstDttm: started,
              endDttm: second(),
            },
          }),
        );
      } catch {
        const receipt = await this.db.legalCorrHist
          .findUnique({ where: { id: input.requestId } })
          .catch(() => null);
        if (receipt) return this.replay(receipt, userId, id, input);
        if (error instanceof ConflictException) throw error;
        throw new ServiceUnavailableException(
          '처리 결과를 확인하지 못했습니다. 같은 처리 번호로 다시 확인해 주세요.',
        );
      }
    }
  }

  async history() {
    const rows = await this.db.legalCorrHist.findMany({
      orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        id: true,
        statCd: true,
        resultCd: true,
        revNo: true,
        affectedCnt: true,
        beforeHash: true,
        afterHash: true,
        rgstDttm: true,
        endDttm: true,
        user: { select: { loginId: true } },
        version: {
          select: {
            id: true,
            verKey: true,
            legal: { select: { id: true, legalNm: true } },
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.statCd,
      resultCode: row.resultCd,
      revision: row.revNo,
      affectedCount: row.affectedCnt,
      beforeHash: row.beforeHash,
      afterHash: row.afterHash,
      requestedAt: row.rgstDttm.toISOString(),
      finishedAt: row.endDttm.toISOString(),
      operator: row.user.loginId,
      lawName: row.version?.legal.legalNm ?? null,
      versionKey: row.version?.verKey ?? null,
      href: row.version
        ? '/legals/' +
          row.version.legal.id.toString() +
          '/versions/' +
          row.version.id.toString()
        : null,
    }));
  }
}
