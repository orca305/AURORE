import {
  listAdminJobs,
  readAdminJob,
  safeJobError,
  safeJobProvider,
  type JobsQuery,
} from './admin-jobs.js';
import { listAdminActivity, type ActivityQuery } from './admin-activity.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AdminGuard } from './admin.guard.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const listedMember = {
  delYn: false,
  NOT: { status: { cd: 'WITHDRAWN' } },
} satisfies Prisma.AppUserWhereInput;
const statusCode = (cd: string): Prisma.CmmnCdWhereInput => ({
  cd,
  nodeTypeCd: 'VALUE',
  useYn: true,
  delYn: false,
  parent: {
    cd: 'USER_STAT',
    nodeTypeCd: 'GROUP',
    useYn: true,
    delYn: false,
    parent: {
      cd: 'AURORE',
      nodeTypeCd: 'ROOT',
      prntCdId: null,
      useYn: true,
      delYn: false,
    },
  },
});
const masked = (value: string, visible: number) => {
  const characters = Array.from(value);
  return (
    characters.slice(0, visible).join('') +
    '*'.repeat(Math.max(1, characters.length - visible))
  );
};

@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AdminGuard,
  ) {}

  jobs(query: JobsQuery) {
    return listAdminJobs(this.db, query);
  }
  job(id: string) {
    return readAdminJob(this.db, id);
  }

  activity(query: ActivityQuery) {
    return listAdminActivity(this.db, query);
  }

  async members(query: {
    q: string;
    status: string;
    limit: number;
    offset: number;
  }) {
    const { status, limit, offset } = query;
    // Prisma contains uses SQL LIKE; user-supplied wildcards must remain literal.
    const term = query.q.trim().replace(/[\\%_]/g, '\\$&');
    const where: Prisma.AppUserWhereInput = {
      ...listedMember,
      ...(term
        ? {
            OR: [
              { loginId: { contains: term, mode: 'insensitive' } },
              { nickNm: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(status !== 'all' ? { status: statusCode(status) } : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const [total, members, active, blocked, rows] = await Promise.all([
          tx.appUser.count({ where }),
          tx.appUser.count({ where: listedMember }),
          tx.appUser.count({
            where: { ...listedMember, status: statusCode('ACTIVE') },
          }),
          tx.appUser.count({
            where: { ...listedMember, status: statusCode('BLOCKED') },
          }),
          tx.appUser.findMany({
            where,
            orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
            take: limit,
            skip: offset,
            select: {
              id: true,
              loginId: true,
              nickNm: true,
              rgstDttm: true,
              status: {
                select: {
                  cd: true,
                  nodeTypeCd: true,
                  useYn: true,
                  delYn: true,
                  parent: {
                    select: {
                      cd: true,
                      nodeTypeCd: true,
                      useYn: true,
                      delYn: true,
                      parent: {
                        select: {
                          cd: true,
                          nodeTypeCd: true,
                          prntCdId: true,
                          useYn: true,
                          delYn: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
        ]);
        return {
          total,
          counts: { members, active, blocked },
          offset,
          limit,
          nextOffset:
            offset + limit < total && offset < 100000
              ? Math.min(100000, offset + limit)
              : null,
          items: rows.map((row) => {
            const code = row.status,
              group = code.parent,
              root = group?.parent;
            const enabled =
              code.nodeTypeCd === 'VALUE' &&
              code.useYn &&
              !code.delYn &&
              group?.cd === 'USER_STAT' &&
              group.nodeTypeCd === 'GROUP' &&
              group.useYn &&
              !group.delYn &&
              root?.cd === 'AURORE' &&
              root.nodeTypeCd === 'ROOT' &&
              root.prntCdId === null &&
              root.useYn &&
              !root.delYn;
            return {
              id: row.id.toString(),
              loginIdMasked: masked(row.loginId, 2),
              nicknameMasked: masked(row.nickNm, 1),
              status:
                enabled && ['ACTIVE', 'BLOCKED'].includes(code.cd)
                  ? code.cd
                  : 'UNAVAILABLE',
              joinedAt: row.rgstDttm.toISOString(),
            };
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private memberId(value: string) {
    if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
      throw new BadRequestException('회원 번호를 확인해 주세요.');
    return BigInt(value);
  }

  async member(
    id: string,
    query: { limit: number; offset: number },
    authorization?: string,
  ) {
    const userId = this.memberId(id),
      actor = await this.access.require(authorization);
    return this.db.$transaction(
      async (tx) => {
        const row = await tx.appUser.findFirst({
          where: { id: userId, ...listedMember },
          select: {
            id: true,
            loginId: true,
            nickNm: true,
            rgstDttm: true,
            statuses: {
              orderBy: { id: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        });
        if (!row) throw new NotFoundException('회원을 찾을 수 없습니다.');
        const valid = await tx.appUser.findFirst({
          where: {
            id: userId,
            status: { OR: [statusCode('ACTIVE'), statusCode('BLOCKED')] },
          },
          select: { status: { select: { cd: true } } },
        });
        const status = valid?.status.cd ?? 'UNAVAILABLE';
        const where = { userId, actorUserId: { not: null } };
        const total = await tx.userStatHist.count({ where });
        const history = await tx.userStatHist.findMany({
          where,
          orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
          take: query.limit,
          skip: query.offset,
          select: {
            id: true,
            reason: true,
            rgstDttm: true,
            previousStatus: { select: { cd: true } },
            status: { select: { cd: true } },
            actor: { select: { loginId: true } },
          },
        });
        return {
          member: {
            id,
            loginIdMasked: masked(row.loginId, 2),
            nicknameMasked: masked(row.nickNm, 1),
            joinedAt: row.rgstDttm.toISOString(),
            status,
            revision: row.statuses[0]?.id.toString() ?? '0',
            canChange: id !== actor.id && status !== 'UNAVAILABLE',
            self: id === actor.id,
          },
          history: {
            total,
            offset: query.offset,
            nextOffset:
              query.offset + query.limit < total && query.offset < 100000
                ? Math.min(100000, query.offset + query.limit)
                : null,
            items: history.map((item) => ({
              id: item.id.toString(),
              reason: item.reason,
              previousStatus: item.previousStatus?.cd ?? 'UNAVAILABLE',
              status: item.status.cd,
              operatorMasked: masked(item.actor!.loginId, 2),
              changedAt: item.rgstDttm.toISOString(),
            })),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async changeMemberStatus(
    id: string,
    input: {
      requestId: string;
      revision: string;
      previousStatus: string;
      status: string;
      reason: string;
    },
    authorization?: string,
  ) {
    const userId = this.memberId(id),
      reason = input.reason.normalize('NFC').trim();
    if (
      !reason ||
      reason.length > 1000 ||
      /[\p{Cc}\p{Surrogate}]/u.test(reason.replace(/[\r\n\t]/g, ''))
    )
      throw new BadRequestException('처리 사유를 1~1000자로 입력해 주세요.');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          id,
          input.revision,
          input.previousStatus,
          input.status,
          reason,
        ]),
      )
      .digest('hex');
    return this.db.$transaction(
      async (tx) => {
        // ponytail: status changes serialize globally; use ordered per-account locks if moderation throughput requires it.
        // The locked, active administrator cannot block their own account,
        // so a successful change always leaves at least this administrator active.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-member-status'))`;
        const actor = await this.access.require(authorization, tx);
        if (actor.id === id)
          throw new ConflictException('본인 계정의 상태는 변경할 수 없습니다.');
        const known = await tx.userStatHist.findUnique({
          where: { requestId: input.requestId },
          select: {
            id: true,
            userId: true,
            actorUserId: true,
            requestHash: true,
            status: { select: { cd: true } },
          },
        });
        if (known) {
          if (
            known.userId !== userId ||
            known.actorUserId !== BigInt(actor.id) ||
            known.requestHash !== requestHash
          )
            throw new ConflictException('다른 요청에 사용된 처리 번호입니다.');
          return { revision: known.id.toString(), status: known.status.cd };
        }
        await tx.$queryRaw`SELECT id FROM app_user WHERE id=${userId} FOR UPDATE`;
        const member = await tx.appUser.findFirst({
          where: { id: userId, ...listedMember },
          select: {
            statCdId: true,
            statuses: {
              orderBy: { id: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        });
        if (!member) throw new NotFoundException('회원을 찾을 수 없습니다.');
        if ((member.statuses[0]?.id.toString() ?? '0') !== input.revision)
          throw new ConflictException(
            '다른 관리자가 회원 상태를 변경했습니다. 최신 상태를 다시 확인해 주세요.',
          );
        const codes = await tx.cmmnCd.findMany({
          where: { OR: [statusCode('ACTIVE'), statusCode('BLOCKED')] },
          select: { id: true, cd: true, prntCdId: true },
        });
        if (codes.length !== 2)
          throw new ConflictException('회원 상태 설정을 확인해 주세요.');
        const next = codes.find((code) => code.cd === input.status),
          prior = codes.find((code) => code.id === member.statCdId);
        if (
          !next ||
          !prior ||
          prior.cd !== input.previousStatus ||
          next.id === prior.id
        )
          throw new ConflictException(
            '회원 상태가 변경되었거나 이미 같은 상태입니다. 새로고침 후 확인해 주세요.',
          );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM cmmn_cd WHERE id IN (${Prisma.join([...codes.map((code) => code.id), codes[0].prntCdId!])}) ORDER BY id FOR SHARE`,
        );
        const currentCodes = await tx.cmmnCd.count({
          where: { OR: [statusCode('ACTIVE'), statusCode('BLOCKED')] },
        });
        if (currentCodes !== 2)
          throw new ConflictException(
            '회원 상태 설정이 변경되었습니다. 다시 확인해 주세요.',
          );
        const now = new Date(Math.floor(Date.now() / 1000) * 1000);
        await tx.appUser.update({
          where: { id: userId },
          data: { statCdId: next.id, uptDttm: now },
        });
        // Revoke on both transitions: unblocking never revives a session from before the block.
        await tx.userSess.updateMany({
          where: { userId, revokeDttm: null },
          data: { revokeDttm: now },
        });
        const receipt = await tx.userStatHist.create({
          data: {
            userId,
            statCdId: next.id,
            prevStatCdId: prior.id,
            actorUserId: BigInt(actor.id),
            reason,
            requestId: input.requestId,
            requestHash,
            rgstDttm: now,
          },
          select: { id: true },
        });
        return { revision: receipt.id.toString(), status: input.status };
      },
      { timeout: 15000 },
    );
  }

  async overview() {
    return this.db.$transaction(
      async (tx) => {
        const now = new Date();
        const chat = {
          delYn: false,
          OR: [{ exprDttm: null }, { exprDttm: { gt: now } }],
        } satisfies Prisma.ChatSessWhereInput;
        const jobs = {
          chat,
          input: { delYn: false },
        } satisfies Prisma.AiJobWhereInput;
        const [
          members,
          conversations,
          legals,
          versions,
          provisions,
          precedents,
          snapshots,
          statuses,
          recentJobs,
          recentSources,
        ] = await Promise.all([
          tx.appUser.count({ where: listedMember }),
          tx.chatSess.count({ where: chat }),
          tx.legal.count({ where: { delYn: false } }),
          tx.legalVer.count({
            where: { delYn: false, legal: { delYn: false } },
          }),
          tx.legalProvi.count({
            where: {
              delYn: false,
              revision: {
                currentYn: true,
                version: { delYn: false, legal: { delYn: false } },
              },
            },
          }),
          tx.legalPrec.count({
            where: { delYn: false, revisions: { some: { currentYn: true } } },
          }),
          tx.srcSnapshot.count(),
          tx.aiJob.groupBy({
            by: ['statCd'],
            where: jobs,
            _count: { _all: true },
          }),
          tx.aiJob.findMany({
            where: jobs,
            select: {
              id: true,
              statCd: true,
              providerCd: true,
              attemptNo: true,
              errorCd: true,
              rgstDttm: true,
              uptDttm: true,
            },
            orderBy: [{ uptDttm: 'desc' }, { id: 'desc' }],
            take: 20,
          }),
          tx.srcSnapshot.findMany({
            select: { id: true, srcCd: true, contType: true, rgstDttm: true },
            orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
            take: 10,
          }),
        ]);
        return {
          asOf: now.toISOString(),
          personalDataAccess: false,
          counts: {
            members,
            conversations,
            legals,
            versions,
            provisions,
            precedents,
            snapshots,
          },
          jobs: statuses.map((row) => ({
            status: row.statCd,
            count: row._count._all,
          })),
          recentJobs: recentJobs.map((row) => ({
            id: row.id,
            status: row.statCd,
            provider: safeJobProvider(row.providerCd),
            attempts: row.attemptNo,
            errorCode: safeJobError(row.errorCd),
            createdAt: row.rgstDttm.toISOString(),
            updatedAt: row.uptDttm.toISOString(),
          })),
          recentSources: recentSources.map((row) => ({
            id: row.id.toString(),
            source: row.srcCd,
            contentType: row.contType,
            collectedAt: row.rgstDttm.toISOString(),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
