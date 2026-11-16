import { JOB_ERROR_CODES, JOB_RESULT_CODES } from '../chat/job-diagnostics.js';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { validateAdminPeriod } from './date-range.js';
const knownErrors = JOB_ERROR_CODES;
export const safeJobError = (value: string | null) =>
  value === null
    ? null
    : (knownErrors as readonly string[]).includes(value)
      ? value
      : 'OTHER';
export const safeJobProvider = (value: string) =>
  ['DEMO', 'LOCAL_DOC', 'LOCAL_RAG', 'STORED_SEARCH'].includes(value)
    ? value
    : 'OTHER';
export const safeJobResult = (value: string | null) =>
  value === null
    ? null
    : (JOB_RESULT_CODES as readonly string[]).includes(value)
      ? value
      : 'OTHER';
export type JobsQuery = {
  q: string;
  status: string;
  error: string;
  result?: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
};
// Select operational metadata only. These visibility rules match the dashboard counts.
const visibleJobs = Prisma.sql`WITH visible_jobs AS (
 SELECT j.id, j.stat_cd AS status, CASE WHEN j.provider_cd IN ('DEMO','LOCAL_DOC','LOCAL_RAG','STORED_SEARCH') THEN j.provider_cd ELSE 'OTHER' END AS provider,
   CASE WHEN j.error_cd IS NULL THEN NULL WHEN j.error_cd IN (${Prisma.join(knownErrors)}) THEN j.error_cd ELSE 'OTHER' END AS error_code,
   CASE WHEN j.result_cd IS NULL THEN NULL WHEN j.result_cd IN (${Prisma.join(JOB_RESULT_CODES)}) THEN j.result_cd ELSE 'OTHER' END AS result_code,
   j.attempt_no AS attempts, j.rgst_dttm AS created_at, j.upt_dttm AS updated_at,
   j.deadline_dttm AS deadline_at,
   CASE WHEN j.stat_cd IN ('QUEUED','RETRY_WAIT') THEN j.next_run_dttm ELSE NULL END AS next_attempt_at,
   CASE WHEN j.stat_cd='RUNNING' THEN j.lease_dttm ELSE NULL END AS lease_expires_at,
   j.stat_cd IN ('QUEUED','RETRY_WAIT','RUNNING') AND j.deadline_dttm<=CURRENT_TIMESTAMP AS deadline_exceeded,
   j.stat_cd='RUNNING' AND j.lease_dttm<=CURRENT_TIMESTAMP AS lease_expired
 FROM ai_job j JOIN chat_sess c ON c.id=j.chat_sess_id
   JOIN chat_msg m ON m.id=j.input_msg_id AND m.chat_sess_id=j.chat_sess_id
 WHERE NOT c.del_yn AND (c.expr_dttm IS NULL OR c.expr_dttm>CURRENT_TIMESTAMP) AND NOT m.del_yn
)`;
type JobRow = {
  id: string;
  status: string;
  provider: string;
  error_code: string | null;
  result_code: string | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
  deadline_at: Date;
  next_attempt_at: Date | null;
  lease_expires_at: Date | null;
  deadline_exceeded: boolean;
  lease_expired: boolean;
};
type BasicJobRow = Pick<
  JobRow,
  | 'id'
  | 'status'
  | 'provider'
  | 'error_code'
  | 'result_code'
  | 'attempts'
  | 'created_at'
  | 'updated_at'
>;
const basic = (row: BasicJobRow) => ({
  id: row.id,
  status: row.status,
  provider: row.provider,
  errorCode: row.error_code,
  resultCode: row.result_code,
  attempts: row.attempts,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
export async function listAdminJobs(db: PrismaService, query: JobsQuery) {
  validateAdminPeriod(query.from, query.to);
  const filtered = Prisma.sql`${visibleJobs}, filtered AS (SELECT * FROM visible_jobs WHERE
   (${query.status}='all' OR status=${query.status}) AND
   (${query.error}='all' OR (${query.error}='NONE' AND error_code IS NULL) OR error_code=${query.error}) AND
   (${query.result ?? 'all'}='all' OR (${query.result ?? 'all'}='NONE' AND result_code IS NULL) OR result_code=${query.result ?? 'all'})
   AND id::text LIKE ${query.q.trim().toLowerCase() + '%'}
   ${query.from ? Prisma.sql`AND updated_at>=${query.from + 'T00:00:00+09:00'}::timestamptz` : Prisma.empty}
   ${query.to ? Prisma.sql`AND updated_at<${query.to + 'T00:00:00+09:00'}::timestamptz+interval '24 hours'` : Prisma.empty}
 )`;
  return db.$transaction(
    async (tx) => {
      const [counts] = await tx.$queryRaw<
        {
          total: bigint;
          failed: bigint;
          retrying: bigint;
          needs_evidence: bigint;
          ai_not_ready: bigint;
          evidence_invalid: bigint;
        }[]
      >(
        Prisma.sql`${filtered} SELECT count(*) AS total,count(*) FILTER(WHERE status='FAILED') AS failed,count(*) FILTER(WHERE status='RETRY_WAIT') AS retrying,count(*) FILTER(WHERE result_code IN ('SOURCE_GAP','RELEVANCE_GAP','DOCUMENT_GAP')) AS needs_evidence,count(*) FILTER(WHERE result_code='AI_NOT_READY') AS ai_not_ready,count(*) FILTER(WHERE error_code='EVIDENCE_INVALID') AS evidence_invalid FROM filtered`,
      );
      const rows = await tx.$queryRaw<BasicJobRow[]>(
        Prisma.sql`${filtered} SELECT id,status,provider,error_code,result_code,attempts,created_at,updated_at FROM filtered ORDER BY updated_at DESC,id DESC LIMIT ${query.limit} OFFSET ${query.offset}`,
      );
      const total = Number(counts.total);
      return {
        total,
        counts: {
          failed: Number(counts.failed),
          retrying: Number(counts.retrying),
          needsEvidence: Number(counts.needs_evidence),
          aiNotReady: Number(counts.ai_not_ready),
          evidenceInvalid: Number(counts.evidence_invalid),
        },
        offset: query.offset,
        limit: query.limit,
        nextOffset:
          query.offset + query.limit < total && query.offset < 100000
            ? Math.min(100000, query.offset + query.limit)
            : null,
        items: rows.map(basic),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function readAdminJob(db: PrismaService, id: string) {
  const [row] = await db.$queryRaw<JobRow[]>(
    Prisma.sql`${visibleJobs} SELECT * FROM visible_jobs WHERE id=${id}::uuid`,
  );
  if (!row)
    throw new NotFoundException(
      '작업을 찾을 수 없습니다. 삭제되었거나 대화 보관 기간이 지났을 수 있습니다.',
    );
  return {
    ...basic(row),
    deadlineAt: row.deadline_at.toISOString(),
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
    deadlineExceeded: row.deadline_exceeded,
    leaseExpired: row.lease_expired,
  };
}
