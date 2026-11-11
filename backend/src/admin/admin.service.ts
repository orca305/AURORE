import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminService {
  constructor(private readonly db: PrismaService) {}

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
          tx.appUser.count({ where: { delYn: false } }),
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
            provider: row.providerCd,
            attempts: row.attemptNo,
            errorCode: row.errorCd,
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
