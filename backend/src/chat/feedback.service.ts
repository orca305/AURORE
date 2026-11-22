import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService, type ChatOwner } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

export const FEEDBACK_RATINGS = ['HELPFUL', 'IMPROVE'] as const;
export const FEEDBACK_REASONS = ['WRONG_LAW', 'NOT_MY_CASE', 'TOO_HARD', 'MISSING', 'OTHER'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type FeedbackInput = { rating: FeedbackRating; reason?: FeedbackReason; text?: string };

/** 사용자가 쓴 사유 글을 저장하기 전에 다듬는다. 제어문자는 거절하고 앞뒤 공백을 없앤다. */
export function cleanFeedbackText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const text = value.normalize('NFC').trim();
  if (!text) return null;
  if (Array.from(text).length > 300 || /[\p{Cc}\p{Surrogate}]/u.test(text.replace(/[\r\n\t]/g, '')))
    throw new BadRequestException('의견은 300자 이내로 적어 주세요.');
  return text;
}

/** 답변 하나에 대한 사용자 피드백(도움 됐어요 / 개선이 필요해요). 대화 소유자만 남기고 바꿀 수 있다. */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** 대화 화면에 답변별 피드백을 붙이기 위한 조회. 삭제된 피드백은 제외한다. */
  async forMessages(messageIds: string[]) {
    if (!messageIds.length) return new Map<string, { rating: string; reason: string | null; text: string | null }>();
    const rows = await this.db.ansFeedback.findMany({
      where: { msgId: { in: messageIds }, delYn: false },
      select: { msgId: true, ratingCd: true, reasonCd: true, reasonTxt: true },
    });
    return new Map(rows.map((row) => [row.msgId, { rating: row.ratingCd, reason: row.reasonCd, text: row.reasonTxt }]));
  }

  async submit(chatId: string, messageId: string, owner: ChatOwner, input: FeedbackInput) {
    if (!FEEDBACK_RATINGS.includes(input.rating)) throw new BadRequestException('평가를 확인해 주세요.');
    const improve = input.rating === 'IMPROVE';
    if (improve && (!input.reason || !FEEDBACK_REASONS.includes(input.reason)))
      throw new BadRequestException('개선이 필요한 이유를 골라 주세요.');
    const text = improve ? cleanFeedbackText(input.text) : null;
    const reason = improve ? input.reason! : null;
    return this.db.$transaction(async (tx) => {
      const message = await tx.chatMsg.findFirst({
        where: {
          id: messageId,
          chatSessId: chatId,
          roleCd: 'ASSISTANT',
          delYn: false,
          chat: {
            id: chatId,
            userId: owner.userId,
            guestSessId: owner.guestSessId,
            delYn: false,
            OR: [{ exprDttm: null }, { exprDttm: { gt: new Date() } }],
          },
        },
        select: { id: true },
      });
      if (!message) throw new NotFoundException('답변을 찾을 수 없습니다.');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'feedback:' + messageId}))`);
      const current = await tx.ansFeedback.findFirst({ where: { msgId: messageId, delYn: false }, select: { id: true, ratingCd: true, reasonCd: true, reasonTxt: true } });
      if (current) {
        const changed = current.ratingCd !== input.rating || current.reasonCd !== reason || current.reasonTxt !== text;
        // 내용이 바뀌면 운영자가 다시 볼 수 있게 처리 상태를 처음으로 돌린다.
        if (changed)
          await tx.ansFeedback.update({
            where: { id: current.id },
            data: { ratingCd: input.rating, reasonCd: reason, reasonTxt: text, statCd: 'NEW', handlerUserId: null, handledDttm: null },
          });
      } else {
        await tx.ansFeedback.create({ data: { chatSessId: chatId, msgId: messageId, ratingCd: input.rating, reasonCd: reason, reasonTxt: text } });
      }
      return { rating: input.rating, reason, text };
    });
  }

  /** 피드백을 지운다. 물리 삭제 없이 del_yn만 바꾼다. */
  async clear(chatId: string, messageId: string, owner: ChatOwner) {
    const result = await this.db.ansFeedback.updateMany({
      where: {
        msgId: messageId,
        chatSessId: chatId,
        delYn: false,
        message: { chat: { userId: owner.userId, guestSessId: owner.guestSessId, delYn: false } },
      },
      data: { delYn: true, delDttm: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('남긴 의견이 없습니다.');
    return { cleared: true };
  }
}
