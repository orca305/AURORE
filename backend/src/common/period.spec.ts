import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { dayRange, isCalendarDay, periodRange } from './period.js';

describe('periodRange', () => {
  it('둘 다 비면 null, 한국 시간 하루 단위로 구간을 만들고 종료일은 포함한다', () => {
    expect(periodRange('', '')).toBeNull();
    expect(periodRange(undefined, undefined)).toBeNull();
    const range = periodRange('2026-11-01', '2026-11-30')!;
    expect(range.gte!.toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(range.lt!.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(periodRange('2026-11-01', undefined)).toEqual({ gte: new Date('2026-10-31T15:00:00.000Z') });
  });
  it('없는 날짜·역순 기간은 거절한다', () => {
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-02-28')).toBe(true);
    expect(() => periodRange('2026-13-01', undefined)).toThrow(BadRequestException);
    expect(() => periodRange('2026-11-30', '2026-11-01')).toThrow(BadRequestException);
  });
});

describe('dayRange', () => {
  it('날짜 칸은 한국 시간 보정 없이 그 날짜 하루를 포함한다', () => {
    const range = dayRange('2026-10-08', '2026-10-08')!;
    expect(range.gte!.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(range.lt!.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(dayRange('', '')).toBeNull();
  });
});
