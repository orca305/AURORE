import pg from 'pg';
import { tmpdir } from 'node:os';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sourceDatabase } from './verify-db-backup.mjs';
const metrics = {
  retainedTermActions:'SELECT count(*) FROM legal_term_hist WHERE actor_user_id IN(SELECT id FROM removed_users)',
  withdrawnAccounts: 'SELECT count(*) FROM removed_users',
  withdrawalArchivePending:
    "SELECT count(*) FROM app_user u WHERE u.id IN(SELECT id FROM removed_users) AND u.del_yn AND u.withdraw_arch_dttm IS NULL AND EXISTS(SELECT 1 FROM cmmn_cd s JOIN cmmn_cd g ON g.id=s.prnt_cd_id JOIN cmmn_cd r ON r.id=g.prnt_cd_id WHERE s.id=u.stat_cd_id AND s.cd='WITHDRAWN' AND g.cd='USER_STAT' AND r.cd='AURORE' AND r.prnt_cd_id IS NULL)",
  withdrawalArchiveCompleted:
    'SELECT count(*) FROM app_user u WHERE u.id IN(SELECT id FROM removed_users) AND u.withdraw_arch_dttm IS NOT NULL',
  retainedBookmarks:
    'SELECT count(*) FROM user_bmark WHERE user_id IN(SELECT id FROM removed_users)',
  retainedNotifications:
    'SELECT count(*) FROM user_ntf WHERE user_id IN(SELECT id FROM removed_users)',
  retainedAgreementHistories:
    'SELECT count(*) FROM user_agr_yn_hist WHERE user_id IN(SELECT id FROM removed_users)',
  retainedRoleHistories:
    'SELECT count(*) FROM user_role WHERE user_id IN(SELECT id FROM removed_users)',
  retainedJobContexts:
    'SELECT count(*) FROM ai_job WHERE chat_sess_id IN(SELECT id FROM removed_chats) AND case_context IS NOT NULL',
  expiredGuestChats:
    'SELECT count(*) FROM chat_sess c,at WHERE c.guest_sess_id IS NOT NULL AND c.expr_dttm<=at.value',
  pendingGuestExpiry:
    'SELECT count(*) FROM chat_sess c,at WHERE c.guest_sess_id IS NOT NULL AND NOT c.del_yn AND c.expr_dttm<=at.value',
  guestExpiryMismatch:
    "SELECT count(*) FROM chat_sess c WHERE c.guest_sess_id IS NOT NULL AND c.expr_dttm IS DISTINCT FROM (((c.rgst_dttm AT TIME ZONE 'Asia/Seoul')+interval '1 month') AT TIME ZONE 'Asia/Seoul')",
  reviewChats: 'SELECT count(*) FROM removed_chats',
  retainedMessageBodies:
    'SELECT count(*) FROM chat_msg m WHERE m.id IN(SELECT id FROM removed_messages) AND octet_length(m.msg_cont)>0',
  reviewCases: 'SELECT count(*) FROM removed_cases',
  reviewFacts: 'SELECT count(*) FROM removed_facts',
  retainedCaseHistories:
    'SELECT count(*) FROM case_hist h WHERE h.user_case_id IN(SELECT id FROM removed_cases) OR h.fact_id IN(SELECT id FROM removed_facts) OR h.user_id IN(SELECT id FROM removed_users)',
  retainedDocumentBodies:
    'SELECT count(*) FROM attach_doc d WHERE d.id IN(SELECT id FROM removed_documents) AND octet_length(d.md_cont)>0',
  retainedDocumentQuotes:
    'SELECT count(*) FROM doc_quote q WHERE (q.attach_doc_id IN(SELECT id FROM removed_documents) OR q.msg_id IN(SELECT id FROM removed_messages)) AND octet_length(q.quote)>0',
  retainedLegalCitations:
    'SELECT count(*) FROM ans_cite a WHERE a.msg_id IN(SELECT id FROM removed_messages)',
  pendingAiJobs:
    "SELECT count(*) FROM ai_job j WHERE j.chat_sess_id IN(SELECT id FROM removed_chats) AND j.stat_cd IN('QUEUED','RUNNING','RETRY_WAIT')",
  expiredOrRevokedSessions:
    "SELECT count(*) FROM user_sess s,at WHERE s.revoke_dttm IS NOT NULL OR s.rgst_dttm<=at.value-interval '7 days' OR s.last_act_dttm<=at.value-interval '24 hours' OR s.user_id IN(SELECT id FROM removed_users)",
  expiredGuestCredentials:
    'SELECT count(*) FROM guest_sess g,at WHERE g.expr_dttm<=at.value',
  remainingAccountCredentials:
    'SELECT count(*) FROM user_auth a WHERE a.user_id IN(SELECT id FROM removed_users)',
  learningOptInUsers:
    'SELECT count(*) FROM learning l WHERE l.agr_yn AND l.user_id NOT IN(SELECT id FROM removed_users)',
  learningOptOutUsers:
    'SELECT count(*) FROM learning l WHERE NOT l.agr_yn AND l.user_id NOT IN(SELECT id FROM removed_users)',
  learningConsentMissing:
    'SELECT count(*) FROM app_user u WHERE u.id NOT IN(SELECT id FROM removed_users) AND u.id NOT IN(SELECT user_id FROM learning)',
};
export async function auditPrivacyRetention(db, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf()))
    throw new Error('AUDIT_TIME_INVALID');
  const sql =
    `WITH at AS(SELECT $1::timestamptz AS value),
 removed_users AS(SELECT u.id FROM app_user u JOIN cmmn_cd s ON s.id=u.stat_cd_id WHERE u.del_yn OR (s.cd='WITHDRAWN' AND EXISTS(SELECT 1 FROM cmmn_cd g JOIN cmmn_cd r ON r.id=g.prnt_cd_id WHERE g.id=s.prnt_cd_id AND g.cd='USER_STAT' AND r.cd='AURORE' AND r.prnt_cd_id IS NULL))),
 removed_chats AS(SELECT c.id FROM chat_sess c,at WHERE c.del_yn OR (c.guest_sess_id IS NOT NULL AND c.expr_dttm<=at.value) OR c.user_id IN(SELECT id FROM removed_users)),
 removed_messages AS(SELECT m.id FROM chat_msg m WHERE m.del_yn OR m.chat_sess_id IN(SELECT id FROM removed_chats)),
 removed_cases AS(SELECT c.id FROM user_case c WHERE c.del_yn OR c.user_id IN(SELECT id FROM removed_users)),
 removed_facts AS(SELECT f.id FROM case_fact f WHERE f.del_yn OR f.user_case_id IN(SELECT id FROM removed_cases)),
 removed_documents AS(SELECT d.id FROM attach_doc d WHERE d.del_yn OR d.chat_sess_id IN(SELECT id FROM removed_chats) OR d.user_id IN(SELECT id FROM removed_users)),
 learning AS(SELECT DISTINCT ON(h.user_id) h.user_id,h.agr_yn FROM user_agr_yn_hist h JOIN cmmn_cd a ON a.id=h.agr_cd_id JOIN cmmn_cd g ON g.id=a.prnt_cd_id JOIN cmmn_cd r ON r.id=g.prnt_cd_id WHERE a.cd='LEARNING' AND g.cd='USER_AGR' AND r.cd='AURORE' AND r.prnt_cd_id IS NULL AND NOT a.del_yn AND a.use_yn AND NOT g.del_yn AND g.use_yn AND NOT r.del_yn AND r.use_yn AND h.rgst_dttm<=(SELECT value FROM at) ORDER BY h.user_id,h.rgst_dttm DESC,h.id DESC)
 ` +
    Object.entries(metrics)
      .map(
        ([code, select]) =>
          `SELECT '${code}' AS code,(${select})::text AS count`,
      )
      .join(' UNION ALL ');
  const { rows } = await db.query(sql, [now.toISOString()]);
  const counts = {};
  for (const row of rows) {
    const count = Number(row.count);
    if (
      !Object.hasOwn(metrics, row.code) ||
      Object.hasOwn(counts, row.code) ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      throw new Error('AUDIT_RESULT_INVALID');
    counts[row.code] = count;
  }
  if (Object.keys(counts).length !== Object.keys(metrics).length)
    throw new Error('AUDIT_RESULT_INVALID');
  return {
    asOf: now.toISOString(),
    readOnly: true,
    contentAccess: false,
    purgeImplemented: false,
    counts,
    purgeReview: {
      executionEnabled: false,
      scopes: [
        {
          code: 'ACCOUNT',
          count: counts.withdrawnAccounts,
          dependency:
            '계정 식별자·인증 자료·세션 및 FK 주체를 함께 검토. 아이디 재사용은 파기 완료 후 허용.',
        },
        {
          code: 'CONVERSATION',
          count: counts.retainedMessageBodies,
          dependency:
            '대화 제목·메시지·법령 인용·첨부 인용과 AI 작업 입력의 연계를 확인.',
        },
        {
          code: 'CASE_HISTORY',
          count: counts.retainedCaseHistories,
          dependency:
            '사건·사실관계와 수정 전후 사본·AI 사건 맥락을 함께 검토.',
        },
        {
          code: 'DOCUMENT',
          count: counts.retainedDocumentBodies,
          dependency: '정제본·첨부 인용·AI 입력 링크·해시 사본을 함께 검토.',
        },
        {
          code: 'MEMBER_LINKS',
          count:
            counts.retainedBookmarks +
            counts.retainedNotifications +
            counts.retainedAgreementHistories +
            counts.retainedRoleHistories + counts.retainedTermActions,
          dependency:
            '관심 항목·개인 알림·동의·역할·용어 관리 이력의 처리자 참조를 검토. 공용 법령·용어 본문을 구분.',
        },
      ],
      blockers: [
        '파기 방식과 실제 실행 승인',
        '동시 변경 재검사·실행 증적',
        '7일 회전 백업과 복원 후 철회·삭제 재적용',
        '학습 사본·캐시·임베딩·외부 복사본 추적',
      ],
    },
  };
}
export async function auditTemporaryBackups(now = new Date()) {
  try {
    const entries = (await readdir(tmpdir(), { withFileTypes: true })).filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        /^aurore-[A-Za-z0-9_.-]+[.]dump$/.test(entry.name),
    );
    if (entries.length > 1000) throw new Error('LIMIT');
    let olderThan7Days = 0;
    for (const entry of entries) {
      const item = await stat(join(tmpdir(), entry.name));
      if (item.mtimeMs <= now.valueOf() - 7 * 86400000) olderThan7Days++;
    }
    return {
      status: 'CHECKED',
      files: entries.length,
      olderThan7Days,
      scope: 'KNOWN_TEMP_DUMPS_ONLY',
    };
  } catch {
    return {
      status: 'UNAVAILABLE',
      files: null,
      olderThan7Days: null,
      scope: 'KNOWN_TEMP_DUMPS_ONLY',
    };
  }
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Usage: node --env-file=local-dev/.env backend/tools/privacy-retention.mjs',
    );
    return;
  }
  if (process.argv.length !== 2) throw new Error('OPTIONS_INVALID');
  const url = sourceDatabase(process.env.DATABASE_URL),
    db = new pg.Client({
      connectionString: url.href,
      connectionTimeoutMillis: 5000,
    });
  await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const report = await auditPrivacyRetention(db);
    await db.query('COMMIT');
    console.log(
      JSON.stringify(
        { ...report, temporaryBackups: await auditTemporaryBackups() },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}
if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error('PRIVACY_AUDIT_UNAVAILABLE');
    process.exitCode = 1;
  }
}
