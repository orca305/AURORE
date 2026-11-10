import { readFile } from "node:fs/promises";
import pg from "pg";
import { verifiedEvidenceForPrecedent } from "./precedent-citation-evidence.mjs";

export async function restoreReviewedLink(db, review) {
  const { caseSourceKey, caseHash, beforeCaseHash = caseHash, reference, beforeHash, afterHash,
    reason, decision = "verified" } = review ?? {};
  const unverified = decision === "unverified";
  const isHash = value => /^[a-f0-9]{64}$/.test(value ?? "");
  if (!/^\d{1,20}$/.test(caseSourceKey ?? "") || (decision !== "verified" && !unverified) ||
      ![caseHash, beforeCaseHash, beforeHash].every(isHash) ||
      !(isHash(afterHash) || (unverified && afterHash === null)) ||
      (beforeHash === afterHash && beforeCaseHash === caseHash) || typeof reference !== "string" || !reference.trim() ||
      typeof reason !== "string" || !reason.trim() || reason.length > 2000) {
    throw new Error("Expected a reviewed reference with source hashes, a valid decision, and a review reason.");
  }
  const status = unverified ? "UNVERIFIED" : "VERIFIED";
  await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))");

  const { rows } = await db.query(
    `SELECT link.id, link.del_yn, cr.id AS case_rev_id, next.id AS target_id
     FROM legal_prec c JOIN legal_prec_rev cr ON cr.legal_prec_id=c.id AND cr.current_yn
     JOIN src_snapshot cs ON cs.id=cr.src_snapshot_id AND cs.cont_hash=$2
     JOIN legal_prec_rev prior_case ON prior_case.legal_prec_id=c.id
     JOIN src_snapshot pcs ON pcs.id=prior_case.src_snapshot_id AND pcs.cont_hash=$6
     JOIN legal_prec_provi link ON link.legal_prec_rev_id=prior_case.id AND link.ref_key=$3 AND link.stat_cd='VERIFIED'
     JOIN legal_provi old ON old.id=link.legal_provi_id AND NOT old.del_yn
       AND old.provi_type_cd='ARTICLE' AND old.prnt_provi_id IS NULL
     JOIN legal_ver_rev previous ON previous.id=old.legal_ver_rev_id
     JOIN src_snapshot before ON before.id=previous.src_snapshot_id AND before.cont_hash=$4
     JOIN legal_ver v ON v.id=previous.legal_ver_id AND NOT v.del_yn
     JOIN legal l ON l.id=v.legal_id AND NOT l.del_yn
     LEFT JOIN legal_ver_rev current ON current.legal_ver_id=v.id AND current.current_yn
     LEFT JOIN src_snapshot after ON after.id=current.src_snapshot_id
     LEFT JOIN legal_provi next ON NOT $7::boolean AND next.legal_ver_rev_id=current.id AND next.norm_no=old.norm_no
       AND next.provi_type_cd='ARTICLE' AND next.prnt_provi_id IS NULL AND NOT next.del_yn
     WHERE c.src_cd='MOLEG' AND c.src_key=$1 AND NOT c.del_yn
       AND after.cont_hash IS NOT DISTINCT FROM $5::text
       AND ($7::boolean OR next.id IS NOT NULL)
       AND (link.del_yn OR NOT EXISTS (
         SELECT 1 FROM legal_prec_rev newer
         JOIN legal_prec_provi newer_link ON newer_link.legal_prec_rev_id=newer.id
           AND newer_link.ref_key=link.ref_key AND NOT newer_link.del_yn
         WHERE newer.legal_prec_id=c.id AND newer.rev_no>prior_case.rev_no
       ))
     FOR UPDATE OF c,cr,link,v`,
    [caseSourceKey, caseHash, reference, beforeHash, afterHash, beforeCaseHash, unverified],
  );
  if (rows.length !== 1) throw new Error("The reviewed case or law revision is stale, missing, or ambiguous.");
  const [link] = rows;
  if (link.del_yn) {
    const replacement = await db.query(
      `SELECT 1 FROM legal_prec_provi WHERE legal_prec_rev_id=$1 AND ref_key=$2
       AND legal_provi_id IS NOT DISTINCT FROM $3::bigint AND stat_cd=$4 AND evidence_desc=$5 AND NOT del_yn`,
      [link.case_rev_id, reference, link.target_id, status, reason],
    );
    if (replacement.rowCount === 1) {
      return { status: unverified ? "already-closed" : "already-restored", caseSourceKey, reference };
    }
    throw new Error("The previous link has already been replaced or withdrawn.");
  }

  await db.query("UPDATE legal_prec_provi SET del_yn=true, del_dttm=now() WHERE id=$1", [link.id]);
  await db.query(
    `INSERT INTO legal_prec_provi (legal_prec_rev_id,ref_key,legal_provi_id,stat_cd,evidence_desc)
     VALUES ($1,$2,$3,$4,$5)`, [link.case_rev_id, reference, link.target_id, status, reason],
  );
  if (unverified) return { status: "closed-unverified", caseSourceKey, reference };
  const evidence = await verifiedEvidenceForPrecedent(db, caseSourceKey);
  const passages = evidence.filter(item =>
    item.reference === reference && item.provisionId === String(link.target_id) && item.hash === afterHash,
  ).length;
  if (!passages) throw new Error("The new link does not produce source-verified passages.");
  return { status: "restored", caseSourceKey, reference, passages };
}

async function main() {
  const [path, flag, ...extra] = process.argv.slice(2);
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!path || flag !== "--apply" || extra.length || url?.protocol !== "postgresql:" ||
      url.host !== "127.0.0.1:5433" || url.pathname !== "/aurore_dev_check") {
    throw new Error("Supply a reviewed link JSON path and --apply with the local development DB.");
  }
  const review = JSON.parse(await readFile(path, "utf8"));
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN");
    const result = await restoreReviewedLink(db, review);
    await db.query("COMMIT");
    console.log(JSON.stringify(result));
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.constructor === Error ? error.message : error.code ?? "Precedent link review failed.");
    process.exitCode = 1;
  }
}
