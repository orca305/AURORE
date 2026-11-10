import pg from "pg";

const pageSize = 100;

export async function listPrecedentReviews(db, caseSourceKey = null, offset = 0) {
  const { rows } = await db.query(
    `WITH current_cases AS (
      SELECT c.id, c.src_key, cr.id AS case_rev_id, cr.case_no, cs.id AS snapshot_id,
        cs.cont_hash AS case_hash, cs.src_url AS case_url
      FROM legal_prec c JOIN legal_prec_rev cr ON cr.legal_prec_id=c.id AND cr.current_yn
      JOIN src_snapshot cs ON cs.id=cr.src_snapshot_id
      WHERE c.src_cd='MOLEG' AND NOT c.del_yn AND ($1::text IS NULL OR c.src_key=$1)
    ), visible_links AS (
      SELECT cc.*, old_case.id AS before_case_rev_id, old_case.rev_no AS before_case_rev_no,
        old_cs.id AS before_case_snapshot_id, old_cs.cont_hash AS before_case_hash,
        old_cs.src_url AS before_case_url, link.id AS link_id, link.ref_key,
        p.id AS before_provision_id, p.norm_no, p.provi_cont AS before_text,
        v.id AS edition_id, v.ver_key, v.enfc_dt, r.current_yn AS law_current,
        s.id AS before_law_snapshot_id, s.cont_hash AS before_hash, s.src_url AS before_law_url
      FROM current_cases cc JOIN legal_prec_rev old_case ON old_case.legal_prec_id=cc.id
      JOIN src_snapshot old_cs ON old_cs.id=old_case.src_snapshot_id
      JOIN legal_prec_provi link ON link.legal_prec_rev_id=old_case.id AND NOT link.del_yn AND link.stat_cd='VERIFIED'
      JOIN legal_provi p ON p.id=link.legal_provi_id AND NOT p.del_yn
        AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL
      JOIN legal_ver_rev r ON r.id=p.legal_ver_rev_id
      JOIN legal_ver v ON v.id=r.legal_ver_id AND NOT v.del_yn
      JOIN legal l ON l.id=v.legal_id AND NOT l.del_yn
      JOIN src_snapshot s ON s.id=r.src_snapshot_id
    ), pending AS (
      SELECT DISTINCT ON (link.id, link.ref_key) link.*
      FROM visible_links link
      WHERE (link.before_case_rev_id<>link.case_rev_id OR NOT link.law_current)
        AND (link.before_case_rev_id=link.case_rev_id OR (
          NOT EXISTS (
            SELECT 1 FROM visible_links fresh
            WHERE fresh.id=link.id AND fresh.ref_key=link.ref_key AND fresh.before_case_rev_id=link.case_rev_id
          ) AND NOT EXISTS (
            SELECT 1 FROM legal_prec_provi fresh WHERE fresh.legal_prec_rev_id=link.case_rev_id
              AND fresh.ref_key=link.ref_key AND NOT fresh.del_yn AND fresh.stat_cd='UNVERIFIED'
          )
        ))
      ORDER BY link.id, link.ref_key, link.before_case_rev_no DESC, link.link_id DESC
    )
    SELECT q.src_key AS "caseSourceKey", q.case_no AS "caseNumber", q.ref_key AS reference,
      q.before_case_rev_id<>q.case_rev_id AS "caseChanged", NOT q.law_current AS "lawChanged",
      q.before_case_hash AS "beforeCaseHash", q.case_hash AS "caseHash",
      q.before_hash AS "beforeHash", active_src.cont_hash AS "afterHash",
      q.before_case_snapshot_id::text AS "beforeCaseSnapshotId", q.snapshot_id::text AS "caseSnapshotId",
      q.before_case_url AS "beforeCaseUrl", q.case_url AS "caseUrl",
      q.before_law_snapshot_id::text AS "beforeLawSnapshotId", active_src.id::text AS "lawSnapshotId",
      q.before_law_url AS "beforeLawUrl", active_src.src_url AS "lawUrl",
      q.ver_key AS "versionKey", q.enfc_dt::text AS "effectiveDate",
      q.before_provision_id::text AS "beforeProvisionId", next.id::text AS "provisionId",
      CASE WHEN active_src.id IS NULL OR target.matches=0 THEN 'TARGET_MISSING'
        WHEN target.matches>1 THEN 'TARGET_AMBIGUOUS' ELSE 'READY_TO_REVIEW' END AS status,
      CASE WHEN $1::text IS NOT NULL THEN q.before_text END AS "beforeText",
      CASE WHEN $1::text IS NOT NULL THEN next.provi_cont END AS "currentText"
    FROM pending q
    LEFT JOIN legal_ver_rev active ON active.legal_ver_id=q.edition_id AND active.current_yn
    LEFT JOIN src_snapshot active_src ON active_src.id=active.src_snapshot_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS matches, min(id) AS id FROM legal_provi p
      WHERE p.legal_ver_rev_id=active.id AND p.norm_no=q.norm_no AND NOT p.del_yn
        AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL
    ) target
    LEFT JOIN legal_provi next ON target.matches=1 AND next.id=target.id AND active_src.id IS NOT NULL
    ORDER BY q.case_no, q.ref_key, q.id LIMIT $2 OFFSET $3`,
    [caseSourceKey, pageSize + 1, offset],
  );
  return { pending: rows.slice(0, pageSize), nextOffset: rows.length > pageSize ? offset + pageSize : null };
}

async function main() {
  const [rawCaseKey, rawOffset = "0", ...extra] = process.argv.slice(2);
  const caseSourceKey = rawCaseKey === "--all" || rawCaseKey === undefined ? null : rawCaseKey;
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (extra.length || (caseSourceKey !== null && !/^\d{1,20}$/.test(caseSourceKey)) ||
      !/^\d{1,6}$/.test(rawOffset) || url?.protocol !== "postgresql:" ||
      url.host !== "127.0.0.1:5433" || url.pathname !== "/aurore_dev_check") {
    throw new Error("Use [official case source key | --all] [offset] with the local development DB.");
  }
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    console.log(JSON.stringify(await listPrecedentReviews(db, caseSourceKey, Number(rawOffset)), null, 2));
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.constructor === Error ? error.message : error.code ?? "Precedent review listing failed.");
    process.exitCode = 1;
  }
}
