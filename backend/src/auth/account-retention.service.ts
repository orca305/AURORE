import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

const withdrawn = {
  delYn: true,
  withdrawArchDttm: null,
  status: {
    cd: 'WITHDRAWN',
    parent: {
      cd: 'USER_STAT',
      parent: { cd: 'AURORE', nodeTypeCd: 'ROOT', prntCdId: null },
    },
  },
};
const second = () => new Date(Math.floor(Date.now() / 1000) * 1000);
@Injectable()
export class AccountRetentionService {
  private readonly logger = new Logger(AccountRetentionService.name);
  private timer?: ReturnType<typeof setInterval>;
  private task?: Promise<unknown>;
  private stopping = false;
  constructor(private readonly db: PrismaService) {}
  onModuleInit() {
    this.timer = setInterval(() => this.kick(), 60000);
    this.timer.unref();
    this.kick();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.task?.catch(() => {});
  }
  private kick() {
    if (this.stopping || this.task) return;
    const task = this.sweep();
    this.task = task;
    void task
      .catch(() => this.logger.warn('ACCOUNT_ARCHIVE_FAILED'))
      .finally(() => {
        if (this.task === task) this.task = undefined;
      });
  }
  async sweep() {
    const users = await this.db.appUser.findMany({
      where: withdrawn,
      select: { id: true },
      orderBy: [{ delDttm: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    let completed = 0;
    for (const user of users) {
      try {
        if (await this.archiveAccount(user.id)) completed++;
      } catch {
        this.logger.warn('ACCOUNT_ARCHIVE_FAILED');
      }
    }
    return { completed };
  }
  async archiveAccount(userId: bigint) {
    return this.db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtext('aurore-withdrawal-archive')) AS locked`;
        if (!lock.locked) return false;
        // SHARE lets an old chat completion finish its own owner check without a user/chat lock cycle.
        await tx.$queryRaw`SELECT id FROM app_user WHERE id=${userId} FOR SHARE`;
        const user = await tx.appUser.findFirst({
          where: { ...withdrawn, id: userId },
          select: { delDttm: true },
        });
        if (!user?.delDttm) return false;
        await tx.$queryRaw`SELECT id FROM user_case WHERE user_id=${userId} ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM chat_sess WHERE user_id=${userId} ORDER BY id FOR UPDATE`;
        const now = second(),
          deletion = { delYn: true, delDttm: now, delId: userId, uptDttm: now };
        // ponytail: one account is archived atomically. Split large-account work into durable batches before public-scale operation.
        const cases = await tx.userCase.findMany({
          where: { userId, delYn: false },
          select: {
            id: true,
            revNo: true,
            caseNm: true,
            type: { select: { cd: true, cdNm: true } },
          },
          orderBy: { id: 'asc' },
        });
        for (const item of cases) {
          const facts = await tx.caseFact.count({
            where: { userCaseId: item.id, delYn: false },
          });
          const before = {
            title: item.caseNm,
            typeCode: item.type.cd,
            typeName: item.type.cdNm,
          };
          await tx.userCase.update({
            where: { id: item.id },
            data: { ...deletion, revNo: { increment: 1 } },
          });
          await tx.caseHist.create({
            data: {
              id: randomUUID(),
              userCaseId: item.id,
              userId,
              revNo: item.revNo + 1,
              actTypeCd: 'DELETE_CASE',
              requestHash: createHash('sha256')
                .update(
                  'WITHDRAWAL:' + userId + ':' + item.id + ':' + item.revNo,
                )
                .digest('hex'),
              bfData: before,
              afData: {
                ...before,
                deleted: true,
                deletedFactCount: facts,
                reason: 'ACCOUNT_WITHDRAWAL',
              },
              rgstDttm: now,
            },
          });
        }
        await tx.caseFact.updateMany({
          where: { case: { userId }, delYn: false },
          data: deletion,
        });
        await tx.chatSess.updateMany({
          where: { userId, delYn: false },
          data: { ...deletion, revNo: { increment: 1 } },
        });
        await tx.chatMsg.updateMany({
          where: { chat: { userId }, delYn: false },
          data: { delYn: true, delDttm: now, delId: userId },
        });
        await tx.attachDoc.updateMany({
          where: { userId, delYn: false },
          data: deletion,
        });
        await tx.aiJob.updateMany({
          where: {
            chat: { userId },
            statCd: { in: ['QUEUED', 'RUNNING', 'RETRY_WAIT'] },
          },
          data: {
            statCd: 'CANCELLED',
            leaseToken: null,
            leaseDttm: null,
            errorCd: 'ACCOUNT_WITHDRAWN',
            uptDttm: now,
          },
        });
        const archivedLink = { delYn: true, delDttm: now, delId: userId };
        await tx.userBmark.updateMany({
          where: { userId, delYn: false },
          data: archivedLink,
        });
        await tx.userNtf.updateMany({
          where: { userId, delYn: false },
          data: archivedLink,
        });
        await tx.userRole.updateMany({
          where: { userId, delYn: false },
          data: archivedLink,
        });
        await tx.appUser.update({
          where: { id: userId },
          data: { withdrawArchDttm: now, uptDttm: now },
        });
        return true;
      },
      { timeout: 30000 },
    );
  }
}
