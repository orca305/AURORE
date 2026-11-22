import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminFeedbackService } from './admin-feedback.service.js';
import { FeedbackService, cleanFeedbackText } from '../chat/feedback.service.js';
import type { AdminGuard } from './admin.guard.js';
import type { AuthService, ChatOwner } from '../auth/auth.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const owner = { userId: 7n, guestSessId: null } as unknown as ChatOwner;
const chatId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';

function memberDb(overrides: Record<string, unknown> = {}) {
  const tx = {
    chatMsg: { findFirst: vi.fn().mockResolvedValue({ id: messageId }) },
    ansFeedback: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  const db = { ...tx, $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)) };
  return { db: db as unknown as PrismaService, tx };
}

describe('cleanFeedbackText', () => {
  it('앞뒤 공백을 없애고 빈 글은 저장하지 않으며 제어문자·300자 초과는 거절한다', () => {
    expect(cleanFeedbackText('  설명이 어려워요  ')).toBe('설명이 어려워요');
    expect(cleanFeedbackText('   ')).toBeNull();
    expect(cleanFeedbackText(undefined)).toBeNull();
    expect(() => cleanFeedbackText('가'.repeat(301))).toThrow(BadRequestException);
    expect(() => cleanFeedbackText('a\u0000b')).toThrow(BadRequestException);
  });
});

describe('FeedbackService.submit', () => {
  const build = (overrides?: Record<string, unknown>) => {
    const { db, tx } = memberDb(overrides);
    return { service: new FeedbackService(db, {} as AuthService), tx };
  };

  it('도움 됐어요는 사유 없이 저장하고, 대화 소유자 조건으로 답변을 찾는다', async () => {
    const { service, tx } = build();
    await expect(service.submit(chatId, messageId, owner, { rating: 'HELPFUL', reason: 'OTHER', text: '무시' })).resolves.toEqual({ rating: 'HELPFUL', reason: null, text: null });
    expect(tx.ansFeedback.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ratingCd: 'HELPFUL', reasonCd: null, reasonTxt: null }) });
    const where = tx.chatMsg.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ roleCd: 'ASSISTANT', chat: { userId: 7n, guestSessId: null } });
  });

  it('개선이 필요해요는 이유가 있어야 하고 의견은 다듬어 저장한다', async () => {
    const { service, tx } = build();
    await expect(service.submit(chatId, messageId, owner, { rating: 'IMPROVE' })).rejects.toThrow(BadRequestException);
    await service.submit(chatId, messageId, owner, { rating: 'IMPROVE', reason: 'TOO_HARD', text: ' 어려워요 ' });
    expect(tx.ansFeedback.create).toHaveBeenCalledWith({ data: expect.objectContaining({ reasonCd: 'TOO_HARD', reasonTxt: '어려워요' }) });
  });

  it('내 답변이 아니면 찾을 수 없다고 답한다', async () => {
    const { service } = build({ chatMsg: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(service.submit(chatId, messageId, owner, { rating: 'HELPFUL' })).rejects.toThrow(NotFoundException);
  });

  it('같은 내용을 다시 보내면 그대로 두고, 바꾸면 처리 상태를 새 의견으로 되돌린다', async () => {
    const same = build({ ansFeedback: { findFirst: vi.fn().mockResolvedValue({ id: 1n, ratingCd: 'HELPFUL', reasonCd: null, reasonTxt: null }), update: vi.fn(), create: vi.fn() } });
    await same.service.submit(chatId, messageId, owner, { rating: 'HELPFUL' });
    expect(same.tx.ansFeedback.update).not.toHaveBeenCalled();
    const changed = build({ ansFeedback: { findFirst: vi.fn().mockResolvedValue({ id: 1n, ratingCd: 'HELPFUL', reasonCd: null, reasonTxt: null }), update: vi.fn(), create: vi.fn() } });
    await changed.service.submit(chatId, messageId, owner, { rating: 'IMPROVE', reason: 'MISSING' });
    expect(changed.tx.ansFeedback.update).toHaveBeenCalledWith({ where: { id: 1n }, data: expect.objectContaining({ ratingCd: 'IMPROVE', statCd: 'NEW', handlerUserId: null }) });
  });

  it('지울 때는 행을 없애지 않고 삭제 표시만 한다', async () => {
    const { service, tx } = build();
    await service.clear(chatId, messageId, owner);
    expect(tx.ansFeedback.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ delYn: true }) }));
    const none = build({ ansFeedback: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    await expect(none.service.clear(chatId, messageId, owner)).rejects.toThrow(NotFoundException);
  });
});

describe('AdminFeedbackService', () => {
  const row = {
    id: 5n,
    ratingCd: 'IMPROVE',
    reasonCd: 'WRONG_LAW',
    reasonTxt: '다른 법 같아요',
    statCd: 'NEW',
    rgstDttm: new Date('2026-11-22T01:00:00Z'),
    message: { msgCont: '답변 본문', answerJobs: [{ providerCd: 'LOCAL_EXPLAIN', input: { msgCont: '보증금을 돌려받지 못했어요. '.repeat(10) } }] },
  };

  it('목록은 질문을 잘라 보여 주고 평점·이유·상태 집계와 도움 비율을 계산하며, 작성자 정보는 담지 않는다', async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([{ ratingCd: 'HELPFUL', _count: { _all: 3 } }, { ratingCd: 'IMPROVE', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ reasonCd: 'WRONG_LAW', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ statCd: 'NEW', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ ratingCd: 'HELPFUL', _count: { _all: 3 } }, { ratingCd: 'IMPROVE', _count: { _all: 1 } }]);
    const db = { ansFeedback: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([row]), groupBy } } as unknown as PrismaService;
    const result = await new AdminFeedbackService(db, {} as AdminGuard).list({ status: 'all', rating: 'all', reason: 'all', limit: 20, offset: 0 });
    expect(result.summary).toMatchObject({ helpful: 3, improve: 1, helpfulRate: 0.75, byStatus: { NEW: 1, REVIEWING: 0, DONE: 0 } });
    expect(result.items[0]).toMatchObject({ id: '5', rating: 'IMPROVE', reason: 'WRONG_LAW', text: '다른 법 같아요', provider: 'LOCAL_EXPLAIN' });
    expect(result.items[0].question.length).toBeLessThanOrEqual(81);
    expect(JSON.stringify(result)).not.toMatch(/userId|chatSessId|loginId/);
    const select = (db.ansFeedback.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].select;
    expect(JSON.stringify(select)).not.toMatch(/userId|chatSessId|loginId/);
  });

  it('상세는 질문·답변 전문을 돌려주고, 없는 번호는 찾을 수 없다고 답한다', async () => {
    const found = { ...row, adminNote: null, handledDttm: null, uptDttm: row.rgstDttm, handler: null, message: { msgCont: '답변 본문', citations: [{ label: '민법 제618조', supportVerifyCd: 'MODEL_REVIEWED' }], answerJobs: [{ providerCd: 'LOCAL_EXPLAIN', resultCd: 'EVIDENCE_FOUND', input: { msgCont: '질문 전문' } }] } };
    const db = { ansFeedback: { findFirst: vi.fn().mockResolvedValueOnce(found).mockResolvedValueOnce(null) } } as unknown as PrismaService;
    const service = new AdminFeedbackService(db, {} as AdminGuard);
    await expect(service.detail('5')).resolves.toMatchObject({ question: '질문 전문', answer: '답변 본문', citations: [{ label: '민법 제618조' }] });
    await expect(service.detail('9')).rejects.toThrow(NotFoundException);
    await expect(service.detail('abc')).rejects.toThrow(NotFoundException);
  });

  it('처리 상태를 바꾸면 처리자와 시각을 남기고, 새 의견으로 되돌리면 지운다', async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = { ansFeedback: { findFirst: vi.fn().mockResolvedValue({ id: 5n }), update } };
    const db = { $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)) } as unknown as PrismaService;
    const access = { require: vi.fn().mockResolvedValue({ id: '3', loginId: 'admin' }) } as unknown as AdminGuard;
    const service = new AdminFeedbackService(db, access);
    await service.setStatus('5', { status: 'DONE', note: ' 확인함 ' }, 'Bearer x');
    expect(update).toHaveBeenLastCalledWith({ where: { id: 5n }, data: expect.objectContaining({ statCd: 'DONE', adminNote: '확인함', handlerUserId: 3n }) });
    await service.setStatus('5', { status: 'NEW' }, 'Bearer x');
    expect(update).toHaveBeenLastCalledWith({ where: { id: 5n }, data: expect.objectContaining({ statCd: 'NEW', handlerUserId: null, handledDttm: null }) });
    await expect(service.setStatus('5', { status: 'DONE', note: 'a\u0000' }, 'Bearer x')).rejects.toThrow(BadRequestException);
  });
});
