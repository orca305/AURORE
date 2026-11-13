import { BadRequestException } from '@nestjs/common';
function validateDate(value: string) {
  if (!value) return;
  const time = Date.parse(value + 'T00:00:00+09:00');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000') ||
    !Number.isFinite(time) ||
    new Date(time + 9 * 3600000).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('실제 존재하는 조회 날짜를 입력해 주세요.');
}
export function validateAdminPeriod(from: string, to: string) {
  validateDate(from);
  validateDate(to);
  if (from && to && from > to)
    throw new BadRequestException('시작일은 종료일보다 늦을 수 없습니다.');
}
