import { BadRequestException } from '@nestjs/common';

/** Reject only malformed input; short legal terms and uncertain meaning pass. */
export function validateQuestion(question: string): string {
  if (typeof question !== 'string')
    throw new BadRequestException('질문을 1~1,000자로 입력해 주세요.');
  const text = question.trim();
  const normalized = text.normalize('NFKC');
  if (
    !text ||
    Array.from(text).length > 1000 ||
    Array.from(normalized).length > 1000
  )
    throw new BadRequestException('질문을 1~1,000자로 입력해 주세요.');
  if (
    // oxlint-disable-next-line no-control-regex -- Explicitly reject malformed control characters.
    /[\p{Surrogate}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(
      text,
    )
  )
    throw new BadRequestException('제어문자 없이 질문을 입력해 주세요.');
  if (!/[\p{L}\p{N}]/u.test(normalized))
    throw new BadRequestException('궁금한 내용을 글자로 입력해 주세요.');
  if (/^(.)\1{7,}$/u.test(normalized.replace(/\s/gu, '')))
    throw new BadRequestException(
      '같은 글자 반복 대신 궁금한 내용을 입력해 주세요.',
    );
  // Preserve the user's text and existing request hashes; normalization is only for validation.
  return text;
}
