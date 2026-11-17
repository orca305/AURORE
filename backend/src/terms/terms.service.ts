import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, type LegalTerm } from '../generated/prisma/client.js';
import { AdminGuard } from '../admin/admin.guard.js';
import type {
  AdminTermsQuery,
  TermsQuery,
  TermHistoryQuery,
  TermData,
} from './terms.dto.js';
const second = () => new Date(Math.floor(Date.now() / 1000) * 1000);
function text(value: string, max: number, required = true) {
  const v = value.trim().normalize('NFC');
  if (
    (required && !v) ||
    v.length > max ||
    /\p{Cc}/u.test(v.replace(/[\r\n\t]/g, ''))
  )
    throw new BadRequestException(
      '용어·내용의 길이와 입력 형식을 확인해 주세요.',
    );
  return v;
}
export function prepareTerm(input: TermData) {
  const termNm = text(input.termName, 100),
    aliases = [...new Set(input.aliases.map((a) => text(a, 100)))];
  let source: URL;
  try {
    source = new URL(input.sourceUrl.trim());
  } catch {
    throw new BadRequestException('출처 주소를 확인해 주세요.');
  }
  if (
    source.protocol !== 'https:' ||
    !source.hostname.endsWith('.go.kr') ||
    source.port ||
    source.username ||
    source.password ||
    source.href.length > 2000 ||
    source.pathname.startsWith('/DRF/') ||
    [...source.searchParams.keys()].some((k) =>
      /^(oc|key|api_?key|servicekey|token|authorization)$/i.test(k),
    )
  )
    throw new BadRequestException(
      '출처는 인증정보가 없는 공공기관의 HTTPS 원문 주소를 입력해 주세요.',
    );
  return {
    termNm,
    normNm: termNm.replace(/\s/gu, '').toLowerCase(),
    aliases,
    defCont: text(input.definition, 10000),
    easyCont: text(input.explanation ?? '', 8000, false) || null,
    srcNm: text(input.sourceName, 200),
    srcUrl: source.href,
    srcRef: text(input.sourceReference ?? '', 4000, false) || null,
  };
}
export function termSnapshot(row: LegalTerm) {
  return {
    id: String(row.id),
    sourceKind: row.srcCd,
    sourceId: row.srcKey,
    termName: row.termNm,
    aliases: row.aliases,
    definition: row.defCont,
    explanation: row.easyCont,
    sourceName: row.srcNm,
    sourceUrl: row.srcUrl,
    sourceReference: row.srcRef,
    state: row.statCd,
    revision: row.revNo,
    publishedAt: row.pubDttm?.toISOString() ?? null,
    deleted: row.delYn,
    createdAt: row.rgstDttm.toISOString(),
    updatedAt: row.uptDttm.toISOString(),
  };
}
@Injectable()
export class TermsService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AdminGuard,
  ) {}
  async list(query: TermsQuery | AdminTermsQuery, authorization?: string) {
    const administrative = 'state' in query,
      term = query.q
        .trim()
        .normalize('NFC')
        .replace(/[\\%_]/g, '\\$&'),
      pattern = '%' + term + '%',
      direction = query.sort === 'oldest' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const visibility = administrative
      ? query.state === 'DELETED'
        ? Prisma.sql`t.del_yn`
        : query.state === 'ALL'
          ? Prisma.sql`NOT t.del_yn`
          : Prisma.sql`NOT t.del_yn AND t.stat_cd=${query.state}`
      : Prisma.sql`NOT t.del_yn AND t.stat_cd='PUBLISHED'`;
    const filter = Prisma.sql`${visibility} ${term ? Prisma.sql`AND(t.term_nm ILIKE ${pattern} OR t.def_cont ILIKE ${pattern} OR coalesce(t.easy_cont,'') ILIKE ${pattern} OR EXISTS(SELECT 1 FROM unnest(t.aliases) a WHERE a ILIKE ${pattern}))` : Prisma.empty}`;
    return this.db.$transaction(
      async (tx) => {
        if (administrative) await this.access.require(authorization, tx);
        const [count] = await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT count(*) AS total FROM legal_term t WHERE ${filter}`,
        );
        const ids = await tx.$queryRaw<{ id: bigint }[]>(
          Prisma.sql`SELECT t.id FROM legal_term t WHERE ${filter} ORDER BY t.upt_dttm ${direction},t.id ${direction} LIMIT ${query.limit} OFFSET ${query.offset}`,
        );
        const rows = await tx.legalTerm.findMany({
            where: { id: { in: ids.map((x) => x.id) } },
          }),
          byId = new Map(rows.map((x) => [x.id, x]));
        const total = Number(count.total);
        return {
          items: ids.map((x) => {
            const row = termSnapshot(byId.get(x.id)!);
            return {
              ...row,
              definition: row.definition.slice(0, 240),
              explanation: row.explanation?.slice(0, 240) ?? null,
            };
          }),
          total,
          limit: query.limit,
          offset: query.offset,
          nextOffset:
            query.offset + query.limit < total && query.offset < 100000
              ? Math.min(100000, query.offset + query.limit)
              : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async read(id: bigint, query?: TermHistoryQuery, authorization?: string) {
    return this.db.$transaction(
      async (tx) => {
        if (query) await this.access.require(authorization, tx);
        const row = await tx.legalTerm.findFirst({
          where: {
            id,
            ...(!query ? { delYn: false, statCd: 'PUBLISHED' } : {}),
          },
        });
        if (!row) throw new NotFoundException('용어를 찾을 수 없습니다.');
        if (!query) return termSnapshot(row);
        const total = await tx.legalTermHist.count({
            where: { legalTermId: id },
          }),
          history = await tx.legalTermHist.findMany({
            where: { legalTermId: id },
            orderBy: { revNo: 'desc' },
            take: query.limit,
            skip: query.offset,
            select: { revNo: true, actCd: true, rgstDttm: true },
          });
        const selected = query.historyRevision
          ? await tx.legalTermHist.findUnique({
              where: {
                legalTermId_revNo: {
                  legalTermId: id,
                  revNo: query.historyRevision,
                },
              },
              select: {
                revNo: true,
                actCd: true,
                bfData: true,
                afData: true,
                rgstDttm: true,
              },
            })
          : null;
        return {
          ...termSnapshot(row),
          history: {
            total,
            items: history.map((h) => ({
              revision: h.revNo,
              action: h.actCd,
              recordedAt: h.rgstDttm.toISOString(),
            })),
            nextOffset:
              query.offset + query.limit < total && query.offset < 100000
                ? Math.min(100000, query.offset + query.limit)
                : null,
          },
          selectedHistory: selected
            ? {
                revision: selected.revNo,
                action: selected.actCd,
                before: selected.bfData,
                after: selected.afData,
                recordedAt: selected.rgstDttm.toISOString(),
              }
            : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async save(
    action: 'CREATE' | 'UPDATE' | 'PUBLISH' | 'DELETE',
    id: bigint | null,
    input: { requestId: string; revision?: number } & Partial<TermData>,
    authorization?: string,
  ) {
    const data =
      action === 'CREATE' || action === 'UPDATE'
        ? prepareTerm(input as TermData)
        : null;
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          action,
          id: id === null ? null : String(id),
          revision: input.revision ?? null,
          data,
        }),
      )
      .digest('hex');
    try {
      return await this.db.$transaction(
        async (tx) => {
          const actor = await this.access.require(authorization, tx),
            actorId = BigInt(actor.id);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId},0))`;
          const known = await tx.legalTermHist.findUnique({
            where: { id: input.requestId },
          });
          if (known) {
            if (
              known.actorUserId !== actorId ||
              known.requestHash !== hash ||
              (id !== null && known.legalTermId !== id)
            )
              throw new ConflictException(
                '다른 처리에 사용한 요청 번호입니다.',
              );
            return { id: String(known.legalTermId), revision: known.revNo };
          }
          let before: LegalTerm | null = null;
          if (id !== null) {
            await tx.$queryRaw`SELECT id FROM legal_term WHERE id=${id} FOR UPDATE`;
            before = await tx.legalTerm.findFirst({
              where: { id, delYn: false },
            });
            if (!before)
              throw new NotFoundException('용어를 찾을 수 없습니다.');
            if (before.revNo !== input.revision)
              throw new ConflictException(
                '다른 화면에서 용어가 변경됐습니다. 새로고침 후 다시 확인해 주세요.',
              );
          }
          const now = second();
          let row: LegalTerm;
          if (action === 'CREATE') {
            row = await tx.legalTerm.create({
              data: { ...data!, rgstDttm: now, uptDttm: now },
            });
          } else {
            if (action === 'PUBLISH' && before!.statCd !== 'DRAFT')
              throw new ConflictException('이미 공개된 용어입니다.');
            row = await tx.legalTerm.update({
              where: { id: id! },
              data: {
                ...(action === 'UPDATE'
                  ? { ...data!, statCd: 'DRAFT', pubDttm: null }
                  : action === 'PUBLISH'
                    ? { statCd: 'PUBLISHED', pubDttm: now }
                    : { delYn: true, delDttm: now, delId: actorId }),
                revNo: { increment: 1 },
                uptDttm: now,
              },
            });
          }
          await tx.legalTermHist.create({
            data: {
              id: input.requestId,
              legalTermId: row.id,
              srcSnapshotId: row.srcSnapshotId,
              actorUserId: actorId,
              revNo: row.revNo,
              actCd: action,
              requestHash: hash,
              bfData: before ? termSnapshot(before) : Prisma.DbNull,
              afData: termSnapshot(row),
              rgstDttm: now,
            },
          });
          return { id: String(row.id), revision: row.revNo };
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          '이미 등록된 용어입니다. 기존 용어를 확인해 주세요.',
        );
      throw error;
    }
  }
}
