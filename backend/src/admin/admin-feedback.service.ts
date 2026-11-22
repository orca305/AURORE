import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminGuard } from './admin.guard.js';

export const FEEDBACK_STATUSES = ['NEW', 'REVIEWING', 'DONE'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const cut = (value: string, length: number) => {
  const chars = Array.from(value);
  return chars.length > length ? chars.slice(0, length).join('') + '…' : value;
};

type ListQuery = { status: string; rating: string; reason: string; limit: number; offset: number };

/**
 * 사용자 피드백 목록·상세·처리 상태. 운영자는 피드백이 붙은 질문과 답변 내용을 볼 수 있지만
 * 작성자(회원·비회원) 식별 정보와 대화 번호는 내려주지 않는다.
 */
@Injectable()
export class AdminFeedbackService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AdminGuard,
  ) {}

  private where(query: Pick<ListQuery, 'status' | 'rating' | 'reason'>): Prisma.AnsFeedbackWhereInput {
    return {
      delYn: false,
      ...(query.status !== 'all' ? { statCd: query.status } : {}),
      ...(query.rating !== 'all' ? { ratingCd: query.rating } : {}),
      ...(query.reason !== 'all' ? { reasonCd: query.reason } : {}),
    };
  }

  async list(query: ListQuery) {
    const where = this.where(query);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, rows, byRating, byReason, byStatus, recent] = await Promise.all([
      this.db.ansFeedback.count({ where }),
      this.db.ansFeedback.findMany({
        where,
        orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
        select: {
          id: true,
          ratingCd: true,
          reasonCd: true,
          reasonTxt: true,
          statCd: true,
          rgstDttm: true,
          message: {
            select: {
              msgCont: true,
              answerJobs: { take: 1, select: { providerCd: true, input: { select: { msgCont: true } } } },
            },
          },
        },
      }),
      this.db.ansFeedback.groupBy({ by: ['ratingCd'], where: { delYn: false }, _count: { _all: true } }),
      this.db.ansFeedback.groupBy({ by: ['reasonCd'], where: { delYn: false, ratingCd: 'IMPROVE' }, _count: { _all: true } }),
      this.db.ansFeedback.groupBy({ by: ['statCd'], where: { delYn: false }, _count: { _all: true } }),
      this.db.ansFeedback.groupBy({ by: ['ratingCd'], where: { delYn: false, rgstDttm: { gte: since } }, _count: { _all: true } }),
    ]);
    const count = (list: { _count: { _all: number } }[], pick: (row: never) => boolean) =>
      list.filter((row) => pick(row as never)).reduce((sum, row) => sum + row._count._all, 0);
    const helpful = count(byRating, (row: { ratingCd: string }) => row.ratingCd === 'HELPFUL');
    const improve = count(byRating, (row: { ratingCd: string }) => row.ratingCd === 'IMPROVE');
    const recentHelpful = count(recent, (row: { ratingCd: string }) => row.ratingCd === 'HELPFUL');
    const recentImprove = count(recent, (row: { ratingCd: string }) => row.ratingCd === 'IMPROVE');
    return {
      total,
      offset: query.offset,
      limit: query.limit,
      nextOffset: query.offset + rows.length < total ? query.offset + rows.length : null,
      summary: {
        helpful,
        improve,
        helpfulRate: helpful + improve ? Math.round((helpful / (helpful + improve)) * 1000) / 1000 : null,
        recentHelpful,
        recentImprove,
        recentHelpfulRate: recentHelpful + recentImprove ? Math.round((recentHelpful / (recentHelpful + recentImprove)) * 1000) / 1000 : null,
        byReason: byReason.map((row) => ({ reason: row.reasonCd ?? 'NONE', count: row._count._all })),
        byStatus: Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, byStatus.find((row) => row.statCd === status)?._count._all ?? 0])),
      },
      items: rows.map((row) => ({
        id: row.id.toString(),
        rating: row.ratingCd,
        reason: row.reasonCd,
        text: row.reasonTxt,
        status: row.statCd,
        at: row.rgstDttm.toISOString(),
        question: cut(row.message.answerJobs[0]?.input.msgCont ?? '', 80),
        provider: row.message.answerJobs[0]?.providerCd ?? null,
      })),
    };
  }

  async detail(id: string) {
    if (!/^[1-9]\d{0,17}$/.test(id)) throw new NotFoundException('피드백을 찾을 수 없습니다.');
    const row = await this.db.ansFeedback.findFirst({
      where: { id: BigInt(id), delYn: false },
      select: {
        id: true,
        ratingCd: true,
        reasonCd: true,
        reasonTxt: true,
        statCd: true,
        adminNote: true,
        handledDttm: true,
        rgstDttm: true,
        uptDttm: true,
        handler: { select: { loginId: true } },
        message: {
          select: {
            msgCont: true,
            citations: { select: { label: true, supportVerifyCd: true } },
            answerJobs: { take: 1, select: { providerCd: true, resultCd: true, input: { select: { msgCont: true } } } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('피드백을 찾을 수 없습니다.');
    const job = row.message.answerJobs[0];
    return {
      id: row.id.toString(),
      rating: row.ratingCd,
      reason: row.reasonCd,
      text: row.reasonTxt,
      status: row.statCd,
      note: row.adminNote,
      handledBy: row.handler?.loginId ?? null,
      handledAt: row.handledDttm?.toISOString() ?? null,
      at: row.rgstDttm.toISOString(),
      updatedAt: row.uptDttm.toISOString(),
      question: job?.input.msgCont ?? null,
      answer: row.message.msgCont,
      provider: job?.providerCd ?? null,
      result: job?.resultCd ?? null,
      citations: row.message.citations.map((citation) => ({ label: citation.label, verification: citation.supportVerifyCd })),
    };
  }

  private cleanNote(value: string | undefined) {
    if (value === undefined) return null;
    const note = value.normalize('NFC').trim();
    if (!note) return null;
    if (Array.from(note).length > 500 || /[\p{Cc}\p{Surrogate}]/u.test(note.replace(/[\r\n\t]/g, '')))
      throw new BadRequestException('처리 메모는 500자 이내로 적어 주세요.');
    return note;
  }

  async setStatus(id: string, input: { status: FeedbackStatus; note?: string }, authorization: string | undefined) {
    const note = this.cleanNote(input.note);
    if (!/^[1-9]\d{0,17}$/.test(id)) throw new NotFoundException('피드백을 찾을 수 없습니다.');
    return this.db.$transaction(async (tx) => {
      const actor = await this.access.require(authorization, tx);
      const found = await tx.ansFeedback.findFirst({ where: { id: BigInt(id), delYn: false }, select: { id: true } });
      if (!found) throw new NotFoundException('피드백을 찾을 수 없습니다.');
      await tx.ansFeedback.update({
        where: { id: found.id },
        data: {
          statCd: input.status,
          adminNote: note,
          handlerUserId: input.status === 'NEW' ? null : BigInt(actor.id),
          handledDttm: input.status === 'NEW' ? null : new Date(),
        },
      });
      return { id, status: input.status };
    });
  }
}
