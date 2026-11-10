import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importEdition } from "./import-law-samples.mjs";
import { verifiedEvidenceForPrecedent } from "./precedent-citation-evidence.mjs";
import { restoreReviewedLink } from "./restore-reviewed-precedent-link.mjs";

const digest = raw => createHash("sha256").update(raw).digest("hex");
const edition = text => {
  const heading = "제1조";
  const path = ["법령", "조문", "조문단위", 0];
  const raw = JSON.stringify({ 법령: {
    법령키: "version-1", 기본정보: { 법령ID: "000001", 시행일자: "20260102" },
    조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "1", 조문내용: heading,
      항: { 항번호: "①", 항내용: text } }] },
  } });
  return {
    date: "2026-01-02", promulgated: "2025-10-01", sourceKey: "000001",
    versionKey: "version-1", title: "검증용 법령", url: "https://www.law.go.kr/",
    raw, hash: digest(raw), chunks: [
      { article: "1", group: "law:000001:1", section: "article", text: heading, path: [...path, "조문내용"] },
      { article: "1", group: "law:000001:1", section: "paragraph", text, path: [...path, "항", "항내용"] },
    ],
  };
};

test("restores only reviewed links to the current revision and retains the previous link", async () => {
  const db = new PGlite();
  try {
    const migrations = new URL("../prisma/migrations/", import.meta.url);
    for (const name of (await readdir(migrations, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort()) {
      await db.exec(await readFile(new URL(name + "/migration.sql", migrations), "utf8"));
    }
    const before = edition("① 이전 원문");
    const after = edition("① 정정 원문");
    const caseHash = digest("{}");
    await db.transaction(tx => importEdition(tx, before));
    await db.query(
      "INSERT INTO src_snapshot (src_cd,src_key,src_url,cont_type,src_cont,cont_hash) VALUES ('MOLEG','100','https://www.law.go.kr/','application/json','{}',$1)", [caseHash],
    );
    await db.exec(`
      INSERT INTO legal_prec (src_cd,src_key) VALUES ('MOLEG','100');
      INSERT INTO legal_prec_rev (legal_prec_id,src_snapshot_id,rev_no,current_yn,case_no,case_nm,court_nm,decision_dt,decision_cont)
      SELECT 1,id,1,true,'2026다100','검증 판례','법원','2026-11-10','원문' FROM src_snapshot WHERE src_key='100';
      INSERT INTO legal_prec_provi (legal_prec_rev_id,ref_key,legal_provi_id,stat_cd,evidence_desc) VALUES
      (1,'제1조 제1항',1,'VERIFIED','기존 검토'),(1,'제1조 제2항',1,'VERIFIED','검증용 잘못된 참조');
    `);
    await db.transaction(tx => importEdition(tx, after));
    assert.deepEqual(await verifiedEvidenceForPrecedent(db, "100"), []);

    const review = {
      caseSourceKey: "100", caseHash, reference: "제1조 제1항", beforeHash: before.hash,
      afterHash: after.hash, reason: "새 시행본과 판결 이유를 다시 대조함",
    };
    const restore = item => db.transaction(tx => restoreReviewedLink(tx, item));
    await assert.rejects(restore({ ...review, afterHash: "0".repeat(64) }), /stale/);
    await assert.rejects(restore({ ...review, caseHash: "0".repeat(64) }), /stale/);
    await assert.rejects(restore({ ...review, reference: "제1조 제2항" }), /paragraph is missing/);

    assert.equal((await restore(review)).status, "restored");
    assert.equal((await restore(review)).status, "already-restored");
    assert.deepEqual((await verifiedEvidenceForPrecedent(db, "100")).map(item => [item.hash, item.quote]), [
      [after.hash, "① 정정 원문"],
    ]);
    const { rows } = await db.query("SELECT id::int, legal_provi_id::int, del_yn FROM legal_prec_provi ORDER BY id");
    assert.deepEqual(rows.map(({ legal_provi_id, del_yn }) => [legal_provi_id, del_yn]), [
      [1, true], [1, false], [2, false],
    ]);

    const updatedCase = '{"revision":2}';
    const updatedCaseHash = digest(updatedCase);
    await db.query(
      "INSERT INTO src_snapshot (src_cd,src_key,src_url,cont_type,src_cont,cont_hash) VALUES ('MOLEG','100','https://www.law.go.kr/','application/json',$1,$2)",
      [updatedCase, updatedCaseHash],
    );
    await db.exec(`
      UPDATE legal_prec_rev SET current_yn=false WHERE legal_prec_id=1;
      INSERT INTO legal_prec_rev (legal_prec_id,src_snapshot_id,rev_no,current_yn,case_no,case_nm,court_nm,decision_dt,decision_cont)
      SELECT 1,id,2,true,'2026다100','검증 판례','법원','2026-11-10','정정 판결문'
      FROM src_snapshot WHERE src_key='100' AND src_cont='{"revision":2}';
    `);
    assert.deepEqual(await verifiedEvidenceForPrecedent(db, "100"), []);
    const caseReview = {
      ...review, caseHash: updatedCaseHash, beforeCaseHash: caseHash,
      beforeHash: after.hash, reason: "정정 판결문에서 조문을 다시 확인함",
    };
    await assert.rejects(restore({ ...caseReview, beforeCaseHash: "0".repeat(64) }), /stale/);
    assert.equal((await restore(caseReview)).status, "restored");
    assert.equal((await restore(caseReview)).status, "already-restored");
    assert.deepEqual((await verifiedEvidenceForPrecedent(db, "100")).map(item => item.quote), ["① 정정 원문"]);
    const latest = await db.query(
      "SELECT legal_prec_rev_id::int, del_yn FROM legal_prec_provi WHERE ref_key='제1조 제1항' ORDER BY id",
    );
    assert.deepEqual(latest.rows, [
      { legal_prec_rev_id: 1, del_yn: true },
      { legal_prec_rev_id: 1, del_yn: true },
      { legal_prec_rev_id: 2, del_yn: false },
    ]);
  } finally {
    await db.close();
  }
});
