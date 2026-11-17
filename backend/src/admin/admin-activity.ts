import { validateAdminPeriod } from './date-range.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
export type ActivityQuery = {
  sort?: 'newest' | 'oldest';
  q: string;
  kind: string;
  result: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
};
export async function listAdminActivity(
  db: PrismaService,
  query: ActivityQuery,
) {
  const direction=query.sort==='oldest'?Prisma.sql`ASC`:Prisma.sql`DESC`;
  validateAdminPeriod(query.from, query.to);
  const term = '%' + query.q.trim().replace(/[\\%_]/g, '\\$&') + '%';
  const actor = Prisma.sql`CASE WHEN u.del_yn OR us.cd='WITHDRAWN' THEN '탈퇴한 관리자' ELSE left(u.login_id,2)||repeat('*',greatest(char_length(u.login_id)-2,1)) END`;
  // Existing receipts remain the source of truth; filtering and paging happen before any rows leave PostgreSQL.
  const events = Prisma.sql`WITH events AS (
    SELECT h.id::text AS id, NULL::bigint AS sequence, 'LAW_CORRECTION'::text AS kind,
      h.stat_cd::text AS result, h.result_cd::text AS action, h.end_dttm AS occurred_at,
      CASE WHEN l.del_yn OR v.del_yn THEN '삭제된 법령' ELSE coalesce(l.legal_nm,'대상 법령 확인 필요') END AS subject,
      NULL::text AS reason, ${actor} AS operator,
      CASE WHEN NOT l.del_yn AND NOT v.del_yn THEN '/legals/'||l.id::text||'/versions/'||v.id::text ELSE NULL END AS href
    FROM legal_corr_hist h JOIN app_user u ON u.id=h.user_id JOIN cmmn_cd us ON us.id=u.stat_cd_id
      LEFT JOIN legal_ver v ON v.id=h.legal_ver_id LEFT JOIN legal l ON l.id=v.legal_id
    UNION ALL
    SELECT h.id::text, NULL::bigint, 'PRECEDENT_REVIEW', 'SUCCEEDED', h.decision::text, h.rgst_dttm,
      CASE WHEN p.del_yn THEN '삭제된 판례' ELSE r.case_nm||' · '||ref.ref_key END,
      h.reason, ${actor}, CASE WHEN NOT p.del_yn THEN '/admin/precedent-reviews#review-history' ELSE NULL END
    FROM legal_prec_review_hist h JOIN app_user u ON u.id=h.user_id JOIN cmmn_cd us ON us.id=u.stat_cd_id
      JOIN legal_prec_provi ref ON ref.id=h.prior_ref_id JOIN legal_prec_rev r ON r.id=ref.legal_prec_rev_id JOIN legal_prec p ON p.id=r.legal_prec_id
    UNION ALL
    SELECT h.id::text, h.id, 'MEMBER_STATUS', 'SUCCEEDED', next.cd::text, h.rgst_dttm,
      CASE WHEN target.del_yn OR ts.cd='WITHDRAWN' THEN '탈퇴한 회원'
        ELSE left(target.login_id,2)||repeat('*',greatest(char_length(target.login_id)-2,1))||' · '||left(target.nick_nm,1)||repeat('*',greatest(char_length(target.nick_nm)-1,1)) END,
      h.reason, ${actor}, CASE WHEN NOT target.del_yn AND ts.cd<>'WITHDRAWN' THEN '/admin/members/'||target.id::text ELSE NULL END
    FROM user_stat_hist h JOIN app_user u ON u.id=h.actor_user_id JOIN cmmn_cd us ON us.id=u.stat_cd_id
      JOIN app_user target ON target.id=h.user_id JOIN cmmn_cd ts ON ts.id=target.stat_cd_id JOIN cmmn_cd next ON next.id=h.stat_cd_id
    WHERE h.actor_user_id IS NOT NULL
  ), filtered AS (SELECT * FROM events WHERE
    (${query.kind}='all' OR kind=${query.kind}) AND (${query.result}='all' OR result=${query.result})
    ${query.from ? Prisma.sql`AND occurred_at >= ${query.from + 'T00:00:00+09:00'}::timestamptz` : Prisma.empty}
    ${query.to ? Prisma.sql`AND occurred_at < ${query.to + 'T00:00:00+09:00'}::timestamptz + interval '24 hours'` : Prisma.empty}
    AND (subject ILIKE ${term} OR coalesce(reason,'') ILIKE ${term})
  )`;
  return db.$transaction(
    async (tx) => {
      const [counts] = await tx.$queryRaw<
        { total: bigint; succeeded: bigint; failed: bigint }[]
      >(Prisma.sql`${events}
      SELECT count(*) AS total, count(*) FILTER (WHERE result='SUCCEEDED') AS succeeded, count(*) FILTER (WHERE result='FAILED') AS failed FROM filtered`);
      const rows = await tx.$queryRaw<
        {
          id: string;
          kind: string;
          result: string;
          action: string;
          occurred_at: Date;
          subject: string;
          reason: string | null;
          operator: string;
          href: string | null;
        }[]
      >(Prisma.sql`${events}
      SELECT id,kind,result,action,occurred_at,subject,reason,operator,href FROM filtered ORDER BY occurred_at ${direction},kind ASC,sequence ${direction} NULLS LAST,id ${direction} LIMIT ${query.limit} OFFSET ${query.offset}`);
      const total = Number(counts.total);
      return {
        total,
        counts: {
          succeeded: Number(counts.succeeded),
          failed: Number(counts.failed),
        },
        offset: query.offset,
        limit: query.limit,
        nextOffset:
          query.offset + query.limit < total && query.offset < 100000
            ? Math.min(100000, query.offset + query.limit)
            : null,
        items: rows.map((row) => ({
          id: row.kind + ':' + row.id,
          kind: row.kind,
          result: row.result,
          action: row.action,
          occurredAt: row.occurred_at.toISOString(),
          subject: row.subject,
          reason: row.reason,
          operatorMasked: row.operator,
          href: row.href,
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
