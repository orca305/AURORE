import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { SlidingLimiter, limitGuestCreate, limitQuestion } from './rate-limit.js';

describe('SlidingLimiter', () => {
  it('규칙을 넘으면 막고, 시간이 지나면 다시 허용한다', () => {
    const limiter = new SlidingLimiter([{ max: 2, windowMs: 1000 }]);
    expect(limiter.check('a', 0).ok).toBe(true);
    expect(limiter.check('a', 100).ok).toBe(true);
    const blocked = limiter.check('a', 200);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.retryAfterSec).toBe(1);
    expect(limiter.check('b', 200).ok).toBe(true);
    expect(limiter.check('a', 1001).ok).toBe(true);
  });

  it('막힌 시도는 횟수로 세지 않는다', () => {
    const limiter = new SlidingLimiter([{ max: 1, windowMs: 1000 }]);
    expect(limiter.check('a', 0).ok).toBe(true);
    for (let i = 1; i < 20; i += 1) expect(limiter.check('a', i).ok).toBe(false);
    expect(limiter.check('a', 1001).ok).toBe(true);
  });

  it('여러 규칙 중 가장 긴 대기 시간을 알려 준다', () => {
    const limiter = new SlidingLimiter([{ max: 1, windowMs: 1000 }, { max: 2, windowMs: 10_000 }]);
    limiter.check('a', 0);
    limiter.check('a', 1500);
    const blocked = limiter.check('a', 2000);
    expect(blocked.ok === false && blocked.retryAfterSec).toBe(8);
  });
});

describe('접속 제한 적용', () => {
  const client = 'a'.repeat(32);

  it('식별값이 없으면 제한하지 않는다', () => {
    for (let i = 0; i < 50; i += 1) limitGuestCreate(undefined);
    for (let i = 0; i < 50; i += 1) limitQuestion({ userId: null }, undefined);
  });

  it('비회원 대화 시작은 방문자당 1시간 5번까지다', () => {
    const own = 'b'.repeat(32);
    for (let i = 0; i < 5; i += 1) limitGuestCreate(own);
    expect(() => limitGuestCreate(own)).toThrow(HttpException);
    try { limitGuestCreate(own); } catch (error) { expect((error as HttpException).getStatus()).toBe(429); }
    expect(() => limitGuestCreate('c'.repeat(32))).not.toThrow();
  });

  it('비회원 질문은 1시간 20번까지, 회원은 별도로 센다', () => {
    for (let i = 0; i < 20; i += 1) limitQuestion({ userId: null }, client);
    expect(() => limitQuestion({ userId: null }, client)).toThrow(HttpException);
    expect(() => limitQuestion({ userId: 7n }, client)).not.toThrow();
  });

  it('형식이 맞지 않는 식별값은 무시한다', () => {
    for (let i = 0; i < 30; i += 1) limitGuestCreate('not-a-hash');
  });
});
