import { BadRequestException } from '@nestjs/common';
export function pageSize(raw?: string, fallback = 20) {
  if (raw === undefined) return fallback;
  if (!/^(10|20|50)$/.test(raw)) throw new BadRequestException('조회 개수는 10·20·50개 중 선택해 주세요.');
  return Number(raw);
}
