import { BadRequestException } from '@nestjs/common';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD 가 실제 달력에 있는 날짜인지 확인한다. */
export function isCalendarDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * 시작일·종료일(한국 시간 기준 날짜, 종료일 포함)을 DB 비교용 구간으로 바꾼다.
 * 둘 다 없으면 null. 시작일이 종료일보다 늦으면 400.
 */
export function periodRange(from?: string, to?: string): { gte?: Date; lt?: Date } | null {
  const start = from?.trim() || undefined;
  const end = to?.trim() || undefined;
  if (!start && !end) return null;
  if ((start && !isCalendarDay(start)) || (end && !isCalendarDay(end)))
    throw new BadRequestException('기간은 YYYY-MM-DD 형식의 날짜로 입력해 주세요.');
  if (start && end && start > end) throw new BadRequestException('시작일이 종료일보다 늦을 수 없어요.');
  const range: { gte?: Date; lt?: Date } = {};
  if (start) range.gte = new Date(`${start}T00:00:00+09:00`);
  if (end) range.lt = new Date(new Date(`${end}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000);
  return range;
}

/** 시각이 없는 날짜 칸(DATE)용 구간. 날짜를 그대로(UTC 자정) 비교한다. */
export function dayRange(from?: string, to?: string): { gte?: Date; lt?: Date } | null {
  const base = periodRange(from, to);
  if (!base) return null;
  const range: { gte?: Date; lt?: Date } = {};
  if (from?.trim()) range.gte = new Date(`${from.trim()}T00:00:00Z`);
  if (to?.trim()) range.lt = new Date(new Date(`${to.trim()}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
  return range;
}
