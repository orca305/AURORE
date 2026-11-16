import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { redactDocument } from '../documents/document-text.js';
import type { Prisma } from '../generated/prisma/client.js';
export type CaseSelection = {
  revision: number;
  factIds: string[];
  asOf: string;
  confirmed: true;
};
export type CaseContextMeta = {
  caseId: string;
  revision: number;
  factIds: string[];
  asOf: string;
  hash: string;
};
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1900-01-01' &&
    value <= '2100-12-31' &&
    Number.isFinite(new Date(value).getTime()) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validateSelection(value: CaseSelection) {
  if (
    !value ||
    value.confirmed !== true ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    !Array.isArray(value.factIds) ||
    !value.factIds.length ||
    value.factIds.length > 10 ||
    value.factIds.some(
      (id) => typeof id !== 'string' || !/^[1-9]\d{0,17}$/.test(id),
    ) ||
    new Set(value.factIds).size !== value.factIds.length ||
    typeof value.asOf !== 'string' ||
    !validDate(value.asOf)
  )
    throw new BadRequestException(
      '사실관계 최대 10개와 조회 기준일을 확인해 주세요.',
    );
}
export function cleanedFact(value: Prisma.JsonValue) {
  const fact = value as {
    title?: unknown;
    content?: unknown;
    occurredOn?: unknown;
  } | null;
  return {
    title: redactDocument(typeof fact?.title === 'string' ? fact.title : ''),
    content: redactDocument(
      typeof fact?.content === 'string' ? fact.content : '',
    ),
    occurredOn:
      typeof fact?.occurredOn === 'string' && validDate(fact.occurredOn)
        ? fact.occurredOn
        : null,
  };
}
export async function loadCaseContext(
  tx: Prisma.TransactionClient,
  caseId: string,
  userId: bigint | null,
  selection: CaseSelection,
) {
  validateSelection(selection);
  if (userId === null) throw new NotFoundException('사건을 찾을 수 없습니다.');
  await tx.$queryRaw`SELECT id FROM user_case WHERE id=${caseId}::uuid AND user_id=${userId} FOR SHARE`;
  const parent = await tx.userCase.findFirst({
    where: { id: caseId, userId, delYn: false },
    select: { revNo: true },
  });
  if (!parent) throw new NotFoundException('사건을 찾을 수 없습니다.');
  if (parent.revNo !== selection.revision)
    throw new ConflictException(
      '사건이 변경되었습니다. 사용할 사실관계를 다시 확인해 주세요.',
    );
  const factIds = [...selection.factIds].sort();
  const facts = await tx.caseFact.findMany({
    where: {
      userCaseId: caseId,
      id: { in: factIds.map(BigInt) },
      delYn: false,
      verifyStatCd: 'USER_CONFIRMED',
    },
    orderBy: { id: 'asc' },
    select: { id: true, factVal: true },
  });
  if (facts.length !== factIds.length)
    throw new ConflictException(
      '선택한 사실관계가 삭제되었거나 변경되었습니다.',
    );
  const text = facts
    .map((row) => {
      const fact = cleanedFact(row.factVal);
      return [
        fact.title,
        fact.occurredOn ? '발생일: ' + fact.occurredOn : '발생일 미상',
        fact.content,
      ].join('\n');
    })
    .join('\n\n');
  if (text.length > 8000)
    throw new BadRequestException(
      '선택한 사실관계는 합계 8,000자까지 사용할 수 있습니다.',
    );
  const meta: CaseContextMeta = {
    caseId,
    revision: selection.revision,
    factIds,
    asOf: selection.asOf,
    hash: createHash('sha256').update(text).digest('hex'),
  };
  return { meta, text };
}
