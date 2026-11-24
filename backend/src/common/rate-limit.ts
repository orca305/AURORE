import { HttpException, HttpStatus } from '@nestjs/common';

type Rule = { max: number; windowMs: number };

/**
 * 메모리 안에서 세는 "최근 N분에 몇 번" 제한. 규칙 중 하나라도 넘으면 막고, 모두 통과해야 1번으로 센다.
 * 프로세스를 다시 켜면 초기화된다(공개 초기의 남용 방지용 1차 장치).
 */
export class SlidingLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly rules: Rule[]) {}

  check(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
    const longest = Math.max(...this.rules.map((rule) => rule.windowMs));
    const list = (this.hits.get(key) ?? []).filter((at) => now - at < longest);
    let retry = 0;
    for (const rule of this.rules) {
      const recent = list.filter((at) => now - at < rule.windowMs);
      if (recent.length >= rule.max) retry = Math.max(retry, Math.ceil((recent[0] + rule.windowMs - now) / 1000));
    }
    if (retry > 0) {
      this.hits.set(key, list);
      return { ok: false, retryAfterSec: retry };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) {
      for (const [name, times] of this.hits) if (!times.some((at) => now - at < longest)) this.hits.delete(name);
    }
    return { ok: true };
  }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// 방문자(접속 주소를 해시한 값)당: 비회원 대화 시작은 1시간 5번·하루 15번, 비회원 질문은 1시간 3번·하루 15번.
const guestCreate = new SlidingLimiter([{ max: 5, windowMs: HOUR }, { max: 15, windowMs: DAY }]);
const guestQuestion = new SlidingLimiter([{ max: 3, windowMs: HOUR }, { max: 15, windowMs: DAY }]);
// 회원은 계정당 1시간 10번·하루 50번.
const memberQuestion = new SlidingLimiter([{ max: 10, windowMs: HOUR }, { max: 50, windowMs: DAY }]);

const clientPattern = /^[a-f0-9]{16,64}$/;

function wait(seconds: number) {
  if (seconds >= 3600) return Math.ceil(seconds / 3600) + '시간';
  if (seconds >= 60) return Math.ceil(seconds / 60) + '분';
  return seconds + '초';
}

function refuse(message: string, retryAfterSec: number): never {
  throw new HttpException(message + ' ' + wait(retryAfterSec) + ' 뒤에 다시 시도해 주세요.', HttpStatus.TOO_MANY_REQUESTS, {
    cause: { retryAfterSec },
  });
}

/** 화면 서버가 알려 준 방문자 식별값이 있을 때만 제한한다(이 PC에서 직접 연 경우는 식별값이 없어 제한하지 않는다). */
export function limitGuestCreate(client: string | undefined, limiter = guestCreate) {
  if (!client || !clientPattern.test(client)) return;
  const result = limiter.check('c:' + client);
  if (!result.ok) refuse('비회원 대화를 너무 자주 시작했어요.', result.retryAfterSec);
}

export function limitQuestion(owner: { userId: bigint | null }, client: string | undefined) {
  if (owner.userId !== null) {
    const result = memberQuestion.check('u:' + owner.userId);
    if (!result.ok) refuse('질문을 너무 많이 보냈어요.', result.retryAfterSec);
    return;
  }
  if (!client || !clientPattern.test(client)) return;
  const result = guestQuestion.check('c:' + client);
  if (!result.ok) refuse('비회원은 질문을 한 시간에 3번까지 보낼 수 있어요. 로그인하면 더 많이 쓸 수 있어요.', result.retryAfterSec);
}
