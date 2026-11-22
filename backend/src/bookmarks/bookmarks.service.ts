import { periodRange } from '../common/period.js';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, type ChatOwner } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
type Owner = ChatOwner & { userId: bigint };
export type BookmarkKind = 'LEGAL' | 'PREC';
type Query = {
  sort?: 'newest' | 'oldest';
  q: string;
  kind: 'ALL' | BookmarkKind;
  limit: number;
  offset: number;
  from?: string;
  to?: string;
};
const visible: Prisma.UserBmarkWhereInput = {
  delYn: false,
  OR: [
    { legal: { delYn: false } },
    { precedent: { delYn: false, revisions: { some: { currentYn: true } } } },
  ],
};
const target = (kind: BookmarkKind, id: bigint) =>
  kind === 'LEGAL' ? { legalId: id } : { legalPrecId: id };
@Injectable()
export class BookmarksService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}
  private async active(tx: Prisma.TransactionClient, owner: Owner) {
    if (
      !(await this.auth.ownerIsActive(owner.userId, null, owner.authHash, tx))
    )
      throw new UnauthorizedException('다시 로그인해 주세요.');
  }
  async list(owner: Owner, query: Query) {
    const q = query.q.trim().replace(/[\\%_]/g, '\\$&');
    const period = periodRange(query.from, query.to);
    const where: Prisma.UserBmarkWhereInput = {
      userId: owner.userId,
      ...(period ? { rgstDttm: period } : {}),
      AND: [
        visible,
        ...(query.kind === 'ALL'
          ? []
          : [
              query.kind === 'LEGAL'
                ? { legalId: { not: null } }
                : { legalPrecId: { not: null } },
            ]),
        ...(q
          ? [
              {
                OR: [
                  {
                    legal: {
                      legalNm: { contains: q, mode: 'insensitive' as const },
                    },
                  },
                  {
                    precedent: {
                      revisions: {
                        some: {
                          currentYn: true,
                          OR: [
                            {
                              caseNm: {
                                contains: q,
                                mode: 'insensitive' as const,
                              },
                            },
                            {
                              caseNo: {
                                contains: q,
                                mode: 'insensitive' as const,
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    return this.db.$transaction(
      async (tx) => {
        await this.active(tx, owner);
        const total = await tx.userBmark.count({ where });
        const rows = await tx.userBmark.findMany({
          where,
          take: query.limit,
          skip: query.offset,
          orderBy: [{ rgstDttm: query.sort==='oldest'?'asc':'desc' }, { id: query.sort==='oldest'?'asc':'desc' }],
          select: {
            id: true,
            rgstDttm: true,
            legal: { select: { id: true, legalNm: true } },
            precedent: {
              select: {
                id: true,
                srcKey: true,
                revisions: {
                  where: { currentYn: true },
                  take: 1,
                  select: { caseNm: true, caseNo: true, courtNm: true },
                },
              },
            },
          },
        });
        return {
          total,
          offset: query.offset,
          nextOffset:
            query.offset + query.limit < total && query.offset < 100000
              ? Math.min(100000, query.offset + query.limit)
              : null,
          items: rows.map((row) => {
            const prec = row.precedent,
              rev = prec?.revisions[0];
            return {
              id: String(row.id),
              kind: row.legal ? 'LEGAL' : 'PREC',
              targetId: String(row.legal?.id ?? prec!.id),
              title: row.legal?.legalNm ?? rev!.caseNm,
              subtitle: rev ? rev.courtNm + ' · ' + rev.caseNo : '법령',
              savedAt: row.rgstDttm.toISOString(),
              href: row.legal
                ? '/legals/' + row.legal.id + '/versions'
                : '/precedents?' +
                  new URLSearchParams({ q: rev!.caseNo }) +
                  '#case-' +
                  prec!.srcKey,
            };
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async states(owner: Owner, kind: BookmarkKind, ids: bigint[]) {
    return this.db.$transaction(async (tx) => {
      await this.active(tx, owner);
      const rows = await tx.userBmark.findMany({
        where: {
          userId: owner.userId,
          AND: [visible],
          ...(kind === 'LEGAL'
            ? { legalId: { in: ids } }
            : { legalPrecId: { in: ids } }),
        },
        select: { legalId: true, legalPrecId: true },
      });
      return {
        savedIds: rows.map((row) =>
          String(kind === 'LEGAL' ? row.legalId : row.legalPrecId),
        ),
      };
    });
  }
  async set(owner: Owner, kind: BookmarkKind, id: bigint, saved: boolean) {
    return this.db.$transaction(async (tx) => {
      // Serialize this member's mutations; active-only uniqueness remains enforced by PostgreSQL.
      await tx.$queryRaw`SELECT id FROM app_user WHERE id=${owner.userId} FOR UPDATE`;
      await this.active(tx, owner);
      const where = { userId: owner.userId, ...target(kind, id), delYn: false };
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      if (!saved) {
        await tx.userBmark.updateMany({
          where,
          data: {
            delYn: true,
            delDttm: now,
            delId: owner.userId,
            uptDttm: now,
          },
        });
      } else {
        const found =
          kind === 'LEGAL'
            ? await tx.$queryRaw<
                { id: bigint }[]
              >`SELECT id FROM legal WHERE id=${id} AND NOT del_yn FOR SHARE`
            : await tx.$queryRaw<
                { id: bigint }[]
              >`SELECT p.id FROM legal_prec p WHERE p.id=${id} AND NOT p.del_yn AND EXISTS(SELECT 1 FROM legal_prec_rev r WHERE r.legal_prec_id=p.id AND r.current_yn) FOR SHARE OF p`;
        if (!found.length)
          throw new NotFoundException('관심 등록할 자료를 찾을 수 없습니다.');
        if (!(await tx.userBmark.findFirst({ where, select: { id: true } })))
          await tx.userBmark.create({
            data: {
              userId: owner.userId,
              ...target(kind, id),
              rgstDttm: now,
              uptDttm: now,
            },
          });
      }
      return { kind, targetId: String(id), saved };
    });
  }
}
