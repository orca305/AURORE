import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CaseTasksService, cleanTaskText, MAX_CASE_TASKS } from './case-tasks.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const caseId = '11111111-1111-4111-8111-111111111111';

function build(options: { owned?: boolean; seqs?: number[]; updated?: number } = {}) {
  const tx = {
    userCase: { findFirst: vi.fn().mockResolvedValue(options.owned === false ? null : { id: caseId }) },
    caseTask: {
      findMany: vi.fn().mockResolvedValue((options.seqs ?? []).map((seq) => ({ seq }))),
      create: vi.fn().mockResolvedValue({ id: 5n }),
      updateMany: vi.fn().mockResolvedValue({ count: options.updated ?? 1 }),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)) };
  return { service: new CaseTasksService(db as unknown as PrismaService), tx };
}

describe('cleanTaskText', () => {
  it('공백을 정리하고 빈 글·200자 초과·제어문자는 거절한다', () => {
    expect(cleanTaskText('  내용증명   발송 ')).toBe('내용증명 발송');
    expect(() => cleanTaskText('   ')).toThrow(BadRequestException);
    expect(() => cleanTaskText('가'.repeat(201))).toThrow(BadRequestException);
    expect(() => cleanTaskText('a\u0000b')).toThrow(BadRequestException);
  });
});

describe('CaseTasksService', () => {
  it('내 사건에만 추가하고 번호는 마지막 번호 다음으로 붙인다', async () => {
    const { service, tx } = build({ seqs: [1, 3] });
    await expect(service.add(caseId, 7n, '신청서 준비')).resolves.toEqual({ id: '5' });
    expect(tx.caseTask.create).toHaveBeenCalledWith({ data: { userCaseId: caseId, userId: 7n, seq: 4, taskTxt: '신청서 준비' }, select: { id: true } });
    expect(tx.userCase.findFirst.mock.calls[0][0].where).toMatchObject({ userId: 7n, delYn: false });
  });
  it('남의 사건이거나 20개를 넘으면 거절한다', async () => {
    await expect(build({ owned: false }).service.add(caseId, 7n, '할 일')).rejects.toThrow(NotFoundException);
    await expect(build({ seqs: Array.from({ length: MAX_CASE_TASKS }, (_, i) => i + 1) }).service.add(caseId, 7n, '할 일')).rejects.toThrow(ConflictException);
  });
  it('고치기는 소유자 조건으로 바꾸고, 지우기는 삭제 표시만 한다', async () => {
    const { service, tx } = build();
    await service.update(caseId, 7n, '5', { done: true });
    expect(tx.caseTask.updateMany).toHaveBeenLastCalledWith({ where: expect.objectContaining({ id: 5n, userCaseId: caseId, userId: 7n, delYn: false }), data: { doneYn: true } });
    await service.remove(caseId, 7n, '5');
    expect(tx.caseTask.updateMany).toHaveBeenLastCalledWith({ where: expect.anything(), data: expect.objectContaining({ delYn: true }) });
    await expect(service.update(caseId, 7n, '5', {})).rejects.toThrow(BadRequestException);
    await expect(build({ updated: 0 }).service.remove(caseId, 7n, '5')).rejects.toThrow(NotFoundException);
    await expect(service.remove(caseId, 7n, 'abc')).rejects.toThrow(NotFoundException);
  });
});
