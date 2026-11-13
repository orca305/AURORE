import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CompareVersionsDto } from './dto/compare-versions.dto.js';
import { highlightText } from './text-diff.js';
const parse = (s: string) => {
  if (!/^[1-9]\d{0,18}$/.test(s) || BigInt(s) > 9223372036854775807n)
    throw new BadRequestException('시행본을 확인해 주세요.');
  return BigInt(s);
};
export async function compareStoredVersions(
  db: PrismaService,
  id: bigint,
  input: CompareVersionsDto,
) {
  return db.$transaction(
    async (tx) => {
      async function revision(versionId: string, revisionId?: string) {
        const row = await tx.legalVerRev.findFirst({
          where: {
            ...(revisionId ? { id: parse(revisionId) } : { currentYn: true }),
            legalVerId: parse(versionId),
            srcSnapshotId: { not: null },
            version: { legalId: id, delYn: false, legal: { delYn: false } },
          },
          select: {
            id: true,
            revNo: true,
            currentYn: true,
            rgstDttm: true,
            snapshot: { select: { srcUrl: true, contHash: true } },
            version: {
              select: {
                id: true,
                enfcDt: true,
                legal: { select: { legalNm: true } },
              },
            },
          },
        });
        if (!row)
          throw new NotFoundException('비교할 저장 원문을 찾을 수 없습니다.');
        return row;
      }
      const before = await revision(
          input.beforeVersionId,
          input.beforeRevisionId,
        ),
        after = await revision(input.afterVersionId, input.afterRevisionId);
      const merged = Prisma.sql`WITH normalized AS (
   SELECT p.*,
    regexp_replace(p.provi_cont, '[[:space:]   -     　﻿]+', '', 'g') AS compare_text,
    regexp_replace(coalesce(p.provi_nm,''), '[[:space:]   -     　﻿]+', '', 'g') AS compare_title,
    regexp_replace(p.disp_no, '[[:space:]   -     　﻿]+', '', 'g') AS compare_number,
    concat(p.provi_type_cd,':',regexp_replace(coalesce(p.norm_no,p.disp_no), '[[:space:]   -     　﻿]+', '', 'g')) AS unit_key
   FROM legal_provi p WHERE p.legal_ver_rev_id IN (${before.id},${after.id}) AND NOT p.del_yn AND p.prnt_provi_id IS NULL
  ), units AS (
   SELECT *, count(*) OVER (PARTITION BY legal_ver_rev_id,unit_key) AS matches FROM normalized
  ), keyed AS (SELECT *,unit_key||CASE WHEN matches>1 THEN ':'||id::text ELSE '' END AS match_key FROM units),
  old AS (SELECT * FROM keyed WHERE legal_ver_rev_id=${before.id}),new AS (SELECT * FROM keyed WHERE legal_ver_rev_id=${after.id}),
  merged AS (SELECT coalesce(new.match_key,old.match_key) AS key,old.id::text AS before_id,new.id::text AS after_id,
   old.disp_no AS before_number,new.disp_no AS after_number,old.provi_nm AS before_title,new.provi_nm AS after_title,
   old.provi_cont AS before_text,new.provi_cont AS after_text,coalesce(new.sort_seq,old.sort_seq) AS sequence,
   CASE WHEN old.id IS NULL THEN 'added' WHEN new.id IS NULL THEN 'removed'
    WHEN (old.compare_text,old.compare_title,old.compare_number) IS DISTINCT FROM (new.compare_text,new.compare_title,new.compare_number) THEN 'modified' ELSE 'unchanged' END AS status
   FROM old FULL JOIN new ON old.match_key=new.match_key)`;
      const [counts] = await tx.$queryRaw<
        {
          total: bigint;
          added: bigint;
          removed: bigint;
          modified: bigint;
          unchanged: bigint;
        }[]
      >(
        Prisma.sql`${merged} SELECT count(*) AS total,count(*) FILTER(WHERE status='added') AS added,count(*) FILTER(WHERE status='removed') AS removed,count(*) FILTER(WHERE status='modified') AS modified,count(*) FILTER(WHERE status='unchanged') AS unchanged FROM merged`,
      );
      const rows = await tx.$queryRaw<
        {
          key: string;
          before_id: string | null;
          after_id: string | null;
          before_number: string | null;
          after_number: string | null;
          before_title: string | null;
          after_title: string | null;
          before_text: string | null;
          after_text: string | null;
          status: string;
        }[]
      >(
        Prisma.sql`${merged} SELECT * FROM merged WHERE ${input.view}='all' OR status<>'unchanged' ORDER BY sequence,key LIMIT ${input.limit + 1} OFFSET ${input.offset}`,
      );
      const meta = (r: typeof before) => ({
        versionId: r.version.id.toString(),
        revisionId: r.id.toString(),
        revision: r.revNo,
        current: r.currentYn,
        effectiveDate: r.version.enfcDt?.toISOString().slice(0, 10) ?? null,
        recordedAt: r.rgstDttm.toISOString(),
        sourceUrl: r.snapshot?.srcUrl ?? null,
      });
      return {
        legalId: id.toString(),
        legalName: before.version.legal.legalNm,
        before: meta(before),
        after: meta(after),
        summary: Object.fromEntries(
          Object.entries(counts).map(([key, value]) => [key, Number(value)]),
        ),
        offset: input.offset,
        nextOffset:
          rows.length > input.limit && input.offset < 100000 ? Math.min(100000, input.offset + input.limit) : null,
        view: input.view,
        items: rows.slice(0, input.limit).map((row) => ({
          key: row.key,
          status: row.status,
          before: row.before_id
            ? {
                number: row.before_number,
                title: row.before_title,
                text: row.before_text,
              }
            : null,
          after: row.after_id
            ? {
                number: row.after_number,
                title: row.after_title,
                text: row.after_text,
              }
            : null,
          highlights: highlightText(
            row.before_text ?? '',
            row.after_text ?? '',
          ),
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
