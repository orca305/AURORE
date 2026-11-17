import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, type LegalTerm } from '../generated/prisma/client.js';
import { AdminGuard } from '../admin/admin.guard.js';
import { MolegTermsClient, sourceFingerprint } from './moleg-terms.js';
import { prepareTerm, termSnapshot } from './terms.service.js';
import type { TermImportItem, TermSourceQuery } from './terms.dto.js';
export type ImportResult = {
  sourceId: string;
  termId: string | null;
  status:
    | 'IMPORTED'
    | 'UPDATED'
    | 'UNCHANGED'
    | 'REPLAYED'
    | 'LOCAL_EDIT'
    | 'DELETED'
    | 'CONFLICT'
    | 'FAILED'
    | 'DEFERRED';
  revision?: number;
};
const localHash = (row: LegalTerm) =>
  sourceFingerprint({
    termName: row.termNm,
    definition: row.defCont,
    sourceName: row.srcNm,
    sourceReference: row.srcRef,
    sourceUrl: row.srcUrl,
  });
const key = (sourceId: string) => ({ srcCd: 'MOLEG_TERM', srcKey: sourceId });
@Injectable()
export class TermImportService {
  private readonly logger = new Logger(TermImportService.name);
  // ponytail: one batch per local process. DB locks protect data across processes; share provider rate limits before multi-instance deployment.
  private running = false;
  constructor(
    private readonly db: PrismaService,
    private readonly access: AdminGuard,
    private readonly source: MolegTermsClient,
  ) {}
  async search(query: TermSourceQuery, authorization?: string) {
    await this.access.require(authorization);
    const page = await this.source.search(
      query.q,
      query.page,
      query.limit,
      query.sort,
    );
    return this.db.$transaction(async (tx) => {
      await this.access.require(authorization, tx);
      const rows = await tx.legalTerm.findMany({
          where: {
            srcCd: 'MOLEG_TERM',
            srcKey: { in: page.items.map((i) => i.sourceId) },
          },
          select: { id: true, srcKey: true, statCd: true, delYn: true },
        }),
        byId = new Map(rows.map((row) => [row.srcKey, row]));
      return {
        ...page,
        items: page.items.map((item) => {
          const row = byId.get(item.sourceId);
          return {
            ...item,
            existing: row
              ? {
                  termId: String(row.id),
                  state: row.delYn ? 'DELETED' : row.statCd,
                }
              : null,
          };
        }),
      };
    });
  }
  async run(items: TermImportItem[], authorization?: string) {
    await this.access.require(authorization);
    if (this.running)
      throw new ConflictException(
        '용어를 가져오는 중입니다. 완료 후 다시 시도해 주세요.',
      );
    this.running = true;
    try {
      const results: ImportResult[] = [],
        deadline = Date.now() + 55000;
      for (const item of items) {
        if (Date.now() > deadline) {
          results.push({
            sourceId: item.sourceId,
            termId: null,
            status: 'DEFERRED',
          });
          continue;
        }
        try {
          results.push(await this.importOne(item, authorization));
        } catch (error) {
          if (
            error instanceof UnauthorizedException ||
            error instanceof ForbiddenException
          )
            throw error;
          this.logger.warn('TERM_IMPORT_ITEM_FAILED');
          results.push({
            sourceId: item.sourceId,
            termId: null,
            status: error instanceof ConflictException ? 'CONFLICT' : 'FAILED',
          });
        }
      }
      return {
        results,
        counts: {
          imported: results.filter((r) => r.status === 'IMPORTED').length,
          updated: results.filter((r) => r.status === 'UPDATED').length,
          unchanged: results.filter(
            (r) => r.status === 'UNCHANGED' || r.status === 'REPLAYED',
          ).length,
          review: results.filter((r) =>
            ['LOCAL_EDIT', 'DELETED', 'CONFLICT'].includes(r.status),
          ).length,
          failed: results.filter(
            (r) => r.status === 'FAILED' || r.status === 'DEFERRED',
          ).length,
        },
      };
    } finally {
      this.running = false;
    }
  }
  private async importOne(
    item: TermImportItem,
    authorization?: string,
  ): Promise<ImportResult> {
    const hash = createHash('sha256')
      .update(JSON.stringify({ action: 'IMPORT', sourceId: item.sourceId }))
      .digest('hex');
    const preflight = await this.db.$transaction(
      async (tx) => {
        const actor = await this.access.require(authorization, tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${item.requestId},0))`;
        const known = await tx.legalTermHist.findUnique({
          where: { id: item.requestId },
        });
        if (known) {
          if (
            known.actorUserId !== BigInt(actor.id) ||
            known.requestHash !== hash ||
            known.actCd !== 'IMPORT'
          )
            throw new ConflictException('다른 요청에 사용한 처리 번호입니다.');
          return {
            result: {
              sourceId: item.sourceId,
              termId: String(known.legalTermId),
              revision: known.revNo,
              status: 'REPLAYED' as const,
            },
          };
        }
        const current = await tx.legalTerm.findUnique({
          where: { srcCd_srcKey: key(item.sourceId) },
        });
        if (current?.delYn)
          return {
            result: {
              sourceId: item.sourceId,
              termId: String(current.id),
              status: 'DELETED' as const,
            },
          };
        if (current && localHash(current) !== current.srcHash)
          return {
            result: {
              sourceId: item.sourceId,
              termId: String(current.id),
              status: 'LOCAL_EDIT' as const,
            },
          };
        return { revision: current?.revNo };
      },
      { timeout: 15000 },
    );
    if (preflight.result) return preflight.result;
    const incoming = await this.source.detail(item.sourceId),
      data = prepareTerm(incoming.data),
      sourceHash = sourceFingerprint(incoming.data);
    return this.db.$transaction(
      async (tx) => {
        const actor = await this.access.require(authorization, tx),
          actorId = BigInt(actor.id);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${item.requestId},0))`;
        const known = await tx.legalTermHist.findUnique({
          where: { id: item.requestId },
        });
        if (known) {
          if (
            known.actorUserId !== actorId ||
            known.requestHash !== hash ||
            known.actCd !== 'IMPORT'
          )
            throw new ConflictException('다른 요청에 사용한 처리 번호입니다.');
          return {
            sourceId: item.sourceId,
            termId: String(known.legalTermId),
            revision: known.revNo,
            status: 'REPLAYED',
          };
        }
        const lockKey = 'moleg-term:' + item.sourceId;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`;
        await tx.$queryRaw`SELECT id FROM legal_term WHERE src_cd='MOLEG_TERM' AND src_key=${item.sourceId} FOR UPDATE`;
        const current = await tx.legalTerm.findUnique({
            where: { srcCd_srcKey: key(item.sourceId) },
          }),
          result = (status: ImportResult['status']): ImportResult => ({
            sourceId: item.sourceId,
            termId: current ? String(current.id) : null,
            status,
          });
        if (current?.delYn) return result('DELETED');
        if (current && localHash(current) !== current.srcHash)
          return result('LOCAL_EDIT');
        if (current?.srcHash === sourceHash) return result('UNCHANGED');
        if (current?.revNo !== preflight.revision) return result('CONFLICT');
        const now = new Date(Math.floor(Date.now() / 1000) * 1000),
          snapshot = await tx.srcSnapshot.upsert({
            where: {
              srcCd_srcKey_contHash: {
                srcCd: 'MOLEG_TERM',
                srcKey: item.sourceId,
                contHash: incoming.rawHash,
              },
            },
            create: {
              srcCd: 'MOLEG_TERM',
              srcKey: item.sourceId,
              srcUrl: data.srcUrl,
              contType: 'application/json',
              srcCont: incoming.raw,
              contHash: incoming.rawHash,
              rgstDttm: now,
            },
            update: {},
          });
        const fields = {
          ...data,
          srcCd: 'MOLEG_TERM',
          srcKey: item.sourceId,
          srcHash: sourceHash,
          srcSnapshotId: snapshot.id,
          statCd: 'DRAFT',
          pubDttm: null,
          easyCont: null,
          uptDttm: now,
        };
        const row = current
          ? await tx.legalTerm.update({
              where: { id: current.id },
              data: {
                ...fields,
                aliases: [
                  ...new Set([...current.aliases, ...data.aliases]),
                ].slice(0, 20),
                revNo: { increment: 1 },
              },
            })
          : await tx.legalTerm.create({ data: { ...fields, rgstDttm: now } });
        await tx.legalTermHist.create({
          data: {
            id: item.requestId,
            legalTermId: row.id,
            actorUserId: actorId,
            revNo: row.revNo,
            actCd: 'IMPORT',
            srcSnapshotId: snapshot.id,
            requestHash: hash,
            bfData: current ? termSnapshot(current) : Prisma.DbNull,
            afData: termSnapshot(row),
            rgstDttm: now,
          },
        });
        return {
          sourceId: item.sourceId,
          termId: String(row.id),
          revision: row.revNo,
          status: current ? 'UPDATED' : 'IMPORTED',
        };
      },
      { timeout: 15000 },
    );
  }
}
