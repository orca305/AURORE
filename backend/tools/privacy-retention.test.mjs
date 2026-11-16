import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { auditPrivacyRetention } from './privacy-retention.mjs';
import { databaseFingerprint } from './verify-db-backup.mjs';
const now = new Date('2026-11-16T12:00:00Z'),
  canary = 'PRIVATE_RETENTION_CANARY';
async function fixture(run) {
  const db = new PGlite();
  try {
    const dir = new URL('../prisma/migrations/', import.meta.url);
    for (const name of (await readdir(dir))
      .filter((n) => /^\d{14}_/.test(n))
      .sort())
      await db.exec(
        await readFile(new URL(name + '/migration.sql', dir), 'utf8'),
      );
    const code = async (group, value) =>
      (
        await db.query(
          'SELECT c.id FROM cmmn_cd c JOIN cmmn_cd p ON p.id=c.prnt_cd_id WHERE p.cd=$1 AND c.cd=$2',
          [group, value],
        )
      ).rows[0].id;
    const active = (
      await db.query(
        'INSERT INTO app_user(login_id,nick_nm,stat_cd_id) VALUES($1,$2,$3) RETURNING id',
        ['audit_active', '검증', await code('USER_STAT', 'ACTIVE')],
      )
    ).rows[0].id;
    const withdrawn = (
      await db.query(
        'INSERT INTO app_user(login_id,nick_nm,stat_cd_id) VALUES($1,$2,$3) RETURNING id',
        ['audit_gone', '검증', await code('USER_STAT', 'WITHDRAWN')],
      )
    ).rows[0].id;
    const memberChat = randomUUID(),
      oldChat = randomUUID(),
      newChat = randomUUID(),
      guest = randomUUID();
    await db.query(
      "INSERT INTO guest_sess(id,token_hash,rgst_dttm,last_act_dttm,expr_dttm) VALUES($1,$2,'2026-10-01','2026-11-10','2026-12-01')",
      [guest, Buffer.alloc(32, 1)],
    );
    await db.query(
      "INSERT INTO guest_sess(id,token_hash,rgst_dttm,last_act_dttm,expr_dttm) VALUES($1,$2,'2026-10-01','2026-10-02','2026-11-01')",
      [randomUUID(), Buffer.alloc(32, 2)],
    );
    await db.query(
      'INSERT INTO chat_sess(id,user_id,sess_nm) VALUES($1,$2,$3)',
      [memberChat, withdrawn, canary],
    );
    await db.query(
      "INSERT INTO chat_sess(id,guest_sess_id,sess_nm,rgst_dttm,expr_dttm) VALUES($1,$2,$3,'2026-10-01','2026-11-01'),($4,$2,$3,'2026-11-10','2026-12-10')",
      [oldChat, guest, canary, newChat],
    );
    const memberParent = randomUUID(),
      memberMessage = randomUUID(),
      oldMessage = randomUUID();
    for (const [id, chat, role] of [
      [memberParent, memberChat, 'USER'],
      [oldMessage, oldChat, 'USER'],
      [randomUUID(), newChat, 'USER'],
    ])
      await db.query(
        'INSERT INTO chat_msg(id,chat_sess_id,msg_seq,role_cd,msg_cont) VALUES($1,$2,1,$3,$4)',
        [id, chat, role, canary],
      );
    await db.query(
      "INSERT INTO chat_msg(id,chat_sess_id,prnt_msg_id,msg_seq,role_cd,msg_cont) VALUES($1,$2,$3,2,'ASSISTANT',$4)",
      [memberMessage, memberChat, memberParent, canary],
    );
    const doc = randomUUID();
    await db.query(
      "INSERT INTO attach_doc(id,user_id,chat_sess_id,doc_nm,format_cd,byte_size,src_sha,request_hash,md_cont,partial_yn) VALUES($1,$2,$3,$4::text,'md',10,$5,$5,$4::text,false)",
      [doc, withdrawn, memberChat, canary, 'a'.repeat(64)],
    );
    await db.query(
      'INSERT INTO doc_quote(chat_sess_id,msg_id,attach_doc_id,quote,md_hash) VALUES($1,$2,$3,$4,$5)',
      [memberChat, memberMessage, doc, canary, 'a'.repeat(64)],
    );
    for (const [user, deleted] of [
      [withdrawn, false],
      [active, true],
    ]) {
      const caseId = randomUUID();
      await db.query(
        'INSERT INTO user_case(id,user_id,case_nm,case_type_cd_id) VALUES($1,$2,$3,$4)',
        [caseId, user, canary, await code('CASE_TYPE', 'LEASE')],
      );
      const fact = (
        await db.query(
          'INSERT INTO case_fact(user_case_id,fact_type_cd_id,fact_val) VALUES($1,$2,$3) RETURNING id',
          [
            caseId,
            await code('CASE_FACT_TYPE', 'STATEMENT'),
            JSON.stringify({
              title: canary,
              content: canary,
              occurredOn: null,
            }),
          ],
        )
      ).rows[0].id;
      if (deleted)
        await db.query(
          'UPDATE case_fact SET del_yn=true,del_dttm=$2,del_id=$3 WHERE id=$1',
          [fact, now, active],
        );
      await db.query(
        "INSERT INTO case_hist(id,user_case_id,user_id,fact_id,rev_no,act_type_cd,request_hash,af_data) VALUES($1,$2,$3,$4,1,'CREATE_FACT',$5,$6)",
        [
          randomUUID(),
          caseId,
          user,
          fact,
          'b'.repeat(64),
          JSON.stringify({ content: canary }),
        ],
      );
    }
    await db.query(
      'INSERT INTO user_auth(user_id,pw_salt,pw_hash) VALUES($1,$2,$3)',
      [withdrawn, Buffer.alloc(16), Buffer.alloc(32)],
    );
    await db.query(
      'INSERT INTO user_sess(token_hash,user_id,rgst_dttm,last_act_dttm,revoke_dttm) VALUES($1,$2,$3,$3,$3)',
      [Buffer.alloc(32, 3), active, now],
    );
    const learning = await code('USER_AGR', 'LEARNING');
    await db.query(
      "INSERT INTO user_agr_yn_hist(user_id,agr_cd_id,agr_yn,pol_ver,rgst_dttm) VALUES($1,$2,true,'3.3',$3),($1,$2,false,'3.3',$3)",
      [active, learning, now],
    );
    await run(db, { active, learning, oldChat });
  } finally {
    await db.close();
  }
}
test('counts related retained data without returning identities, contents or modifying rows', async () =>
  fixture(async (db) => {
    const before = await db.transaction((tx) => databaseFingerprint(tx));
    const report = await db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      return auditPrivacyRetention(tx, now);
    });
    assert.equal(report.readOnly, true);
    assert.equal(report.contentAccess, false);
    assert.equal(report.purgeImplemented, false);
    const c = report.counts;
    assert.equal(c.withdrawnAccounts, 1);
    assert.equal(c.expiredGuestChats, 1);
    assert.equal(c.pendingGuestExpiry, 1);
    assert.equal(c.guestExpiryMismatch, 0);
    assert.equal(c.reviewChats, 2);
    assert.equal(c.retainedMessageBodies, 3);
    assert.equal(c.reviewCases, 1);
    assert.equal(c.reviewFacts, 2);
    assert.equal(c.retainedCaseHistories, 2);
    assert.equal(c.retainedDocumentBodies, 1);
    assert.equal(c.retainedDocumentQuotes, 1);
    assert.equal(c.remainingAccountCredentials, 1);
    assert.equal(c.expiredOrRevokedSessions, 1);
    assert.equal(c.expiredGuestCredentials, 1);
    assert.equal(c.learningOptOutUsers, 1);
    assert.equal(c.learningOptInUsers, 0);
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes(canary));
    assert.ok(!serialized.includes('audit_active'));
    assert.ok(!serialized.includes('pw_hash'));
    assert.ok(!serialized.includes('token_hash'));
    assert.deepEqual(
      await db.transaction((tx) => databaseFingerprint(tx)),
      before,
    );
  }));
test('uses latest consent within the audit time and detects a calendar-month expiry mismatch', async () =>
  fixture(async (db, { active, learning, oldChat }) => {
    await db.query(
      "INSERT INTO user_agr_yn_hist(user_id,agr_cd_id,agr_yn,pol_ver,rgst_dttm) VALUES($1,$2,true,'3.3',$3)",
      [active, learning, new Date(now.valueOf() + 1000)],
    );
    assert.equal(
      (await auditPrivacyRetention(db, now)).counts.learningOptOutUsers,
      1,
    );
    assert.equal(
      (await auditPrivacyRetention(db, new Date(now.valueOf() + 1000))).counts
        .learningOptInUsers,
      1,
    );
    await db.query("UPDATE chat_sess SET expr_dttm='2026-11-02' WHERE id=$1", [
      oldChat,
    ]);
    assert.equal(
      (await auditPrivacyRetention(db, now)).counts.guestExpiryMismatch,
      1,
    );
  }));
test('rejects unexpected audit fields and invalid times without exposing their values', async () => {
  await assert.rejects(
    auditPrivacyRetention(
      { query: async () => ({ rows: [{ code: canary, count: '1' }] }) },
      now,
    ),
    /AUDIT_RESULT_INVALID/,
  );
  await assert.rejects(
    auditPrivacyRetention({}, new Date('invalid')),
    /AUDIT_TIME_INVALID/,
  );
});
