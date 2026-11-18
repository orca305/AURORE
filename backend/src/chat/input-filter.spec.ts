import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { validateQuestion } from './input-filter.js';
import { ChatService } from './chat.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthService, ChatOwner } from '../auth/auth.service.js';
import type { ChatAnswerService } from './answer.service.js';

describe('conservative input filtering', () => {
  it('does not start a job or persist malformed questions', async () => {
    const transaction = vi.fn();
    const service = new ChatService(
      { $transaction: transaction } as unknown as PrismaService,
      {} as AuthService,
      {} as ChatAnswerService,
    );
    await expect(
      service.submit('unused', {} as ChatOwner, 'unused', '!!!!!!!!', 0),
    ).rejects.toThrow(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('preserves short legal terms, everyday descriptions and uncertain inputs', () => {
    for (const text of [
      '해고',
      '이혼',
      '사기',
      '상속',
      '임금체불',
      '보증금',
      'asdfghjkl',
      '안녕하세요',
      '회사가 월급을 안 줍니다',
      '옆집이 밤마다 너무 시끄러워요',
      'ㅋㅋ 억울해요, 퇴직금을 못 받았어요',
      '계약서\n제1조\t내용이 궁금해요',
      '１년 계약이 끝났어요',
      'a'.repeat(999) + '?',
    ])
      expect(validateQuestion(' ' + text + ' ')).toBe(text);
  });
  it('rejects malformed input before any model or storage is needed', () => {
    for (const text of [
      '',
      '   ',
      '!',
      '!!!!!!!!!!!!',
      'ㅋㅋㅋㅋㅋㅋㅋㅋ',
      'ㅋ ㅋ ㅋ ㅋ ㅋ ㅋ ㅋ ㅋ',
      '가'.repeat(1001),
      '\ufb03'.repeat(400),
      '질문\u0000',
      '계약\u202e서',
      '\ud800',
      '질문\u200b',
    ])
      expect(() => validateQuestion(text)).toThrow(BadRequestException);
  });
});
