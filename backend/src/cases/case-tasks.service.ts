import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const MAX_CASE_TASKS = 20;

/** 할 일 글을 다듬는다: NFC, 공백 정리, 1~200자, 제어문자 금지. */
export function cleanTaskText(value: string): string {
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!text || Array.from(text).length > 200 || /[\p{Cc}\p{Surrogate}]/u.test(text))
    throw new BadRequestException('할 일은 1~200자로 적어 주세요.');
  return text;
}

/** 사건의 "다음 할 일" 번호 목록. 사건 소유자만 보고 바꿀 수 있고, 지울 때는 삭제 표시만 한다. */
@Injectable()
export class CaseTasksService {
  constructor(private readonly db: PrismaService) {}

  private async ownedCase(tx: Pick<PrismaService, 'userCase'>, caseId: string, userId: bigint) {
    const found = await tx.userCase.findFirst({ where: { id: caseId, userId, delYn: false }, select: { id: true } });
    if (!found) throw new NotFoundException('사건을 찾을 수 없습니다.');
  }

  async list(caseId: string, userId: bigint) {
    await this.ownedCase(this.db, caseId, userId);
    const rows = await this.db.caseTask.findMany({
      where: { userCaseId: caseId, userId, delYn: false },
      orderBy: [{ seq: 'asc' }, { id: 'asc' }],
      select: { id: true, taskTxt: true, doneYn: true },
    });
    return { max: MAX_CASE_TASKS, items: rows.map((row) => ({ id: row.id.toString(), text: row.taskTxt, done: row.doneYn })) };
  }

  async add(caseId: string, userId: bigint, text: string) {
    const task = cleanTaskText(text);
    return this.db.$transaction(async (tx) => {
      await this.ownedCase(tx as unknown as PrismaService, caseId, userId);
      const active = await tx.caseTask.findMany({ where: { userCaseId: caseId, userId, delYn: false }, select: { seq: true } });
      if (active.length >= MAX_CASE_TASKS) throw new ConflictException(`할 일은 최대 ${MAX_CASE_TASKS}개까지 적을 수 있어요.`);
      const seq = active.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
      const row = await tx.caseTask.create({ data: { userCaseId: caseId, userId, seq, taskTxt: task }, select: { id: true } });
      return { id: row.id.toString() };
    });
  }

  private async mutate(caseId: string, userId: bigint, taskId: string, data: { taskTxt?: string; doneYn?: boolean; delYn?: boolean; delDttm?: Date }) {
    if (!/^[1-9]\d{0,17}$/.test(taskId)) throw new NotFoundException('할 일을 찾을 수 없습니다.');
    const result = await this.db.caseTask.updateMany({ where: { id: BigInt(taskId), userCaseId: caseId, userId, delYn: false, userCase: { delYn: false } }, data });
    if (result.count === 0) throw new NotFoundException('할 일을 찾을 수 없습니다.');
    return { id: taskId };
  }

  async update(caseId: string, userId: bigint, taskId: string, input: { text?: string; done?: boolean }) {
    const data: { taskTxt?: string; doneYn?: boolean } = {};
    if (input.text !== undefined) data.taskTxt = cleanTaskText(input.text);
    if (input.done !== undefined) data.doneYn = input.done;
    if (!Object.keys(data).length) throw new BadRequestException('바꿀 내용이 없어요.');
    return this.mutate(caseId, userId, taskId, data);
  }

  async remove(caseId: string, userId: bigint, taskId: string) {
    return this.mutate(caseId, userId, taskId, { delYn: true, delDttm: new Date() });
  }
}
