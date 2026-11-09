import { readFile } from "node:fs/promises";
import pg from "pg";

const url = URL.parse(process.env.DATABASE_URL ?? "");
if (url?.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
    url.port !== "5433" || url.pathname !== "/aurore_dev_check") {
  throw new Error("Run this reviewed sample import against the local development DB on port 5433.");
}

const reviews = JSON.parse(await readFile(new URL("./precedent-provision-reviews.json", import.meta.url), "utf8"));
const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))");
  let inserted = 0;
  for (const review of reviews) {
    const cases = await db.query(
      `SELECT r.id FROM legal_prec c JOIN legal_prec_rev r ON r.legal_prec_id=c.id AND r.current_yn
       JOIN src_snapshot s ON s.id=r.src_snapshot_id AND s.cont_hash=$2
       WHERE c.src_cd='MOLEG' AND c.src_key=$1 AND NOT c.del_yn`, [review.caseKey, review.caseHash],
    );
    if (cases.rowCount !== 1) throw new Error("Reviewed case revision not found: " + review.caseKey);

    let targetId = null;
    if (review.target) {
      const { versionKey, sourceKey, hash, article } = review.target;
      const targets = await db.query(
        `SELECT p.id FROM legal l JOIN legal_ver v ON v.legal_id=l.id AND NOT v.del_yn AND v.ver_key=$2
         JOIN legal_ver_rev r ON r.legal_ver_id=v.id AND r.current_yn
         JOIN src_snapshot s ON s.id=r.src_snapshot_id AND s.cont_hash=$3
         JOIN legal_provi p ON p.legal_ver_rev_id=r.id AND p.provi_type_cd='ARTICLE'
           AND p.norm_no=$4 AND p.prnt_provi_id IS NULL AND NOT p.del_yn
         WHERE l.src_cd='MOLEG' AND l.src_key=$1 AND NOT l.del_yn`, [sourceKey, versionKey, hash, article],
      );
      if (targets.rowCount !== 1) throw new Error("Reviewed law article not found: " + review.refKey);
      targetId = targets.rows[0].id;
    }

    const revisionId = cases.rows[0].id;
    const status = targetId ? "VERIFIED" : "UNVERIFIED";
    const result = await db.query(
      `INSERT INTO legal_prec_provi (legal_prec_rev_id,ref_key,legal_provi_id,stat_cd,evidence_desc)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (legal_prec_rev_id,ref_key) WHERE NOT del_yn DO NOTHING`,
      [revisionId, review.refKey, targetId, status, review.reason],
    );
    if (result.rowCount === 0) {
      const existing = await db.query(
        `SELECT 1 FROM legal_prec_provi WHERE legal_prec_rev_id=$1 AND ref_key=$2 AND NOT del_yn
         AND legal_provi_id IS NOT DISTINCT FROM $3 AND stat_cd=$4 AND evidence_desc=$5`,
        [revisionId, review.refKey, targetId, status, review.reason],
      );
      if (existing.rowCount !== 1) throw new Error("Existing review differs: " + review.refKey);
    }
    inserted += result.rowCount;
  }
  await db.query("COMMIT");
  console.log(JSON.stringify({ reviewed: reviews.length, inserted }));
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
