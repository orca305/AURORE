import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { identifySample, readOfficialSample } from "./capture-law-samples.mjs";
import { importEdition } from "./import-law-samples.mjs";
import { loadEvidence } from "./law-evidence.mjs";
import { compareProvisions } from "./review-law-corrections.mjs";

export async function readCorrection(reportPath) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const { lawId, mst, effectiveDate, versionKey, beforeHash, afterHash } = report;
  if (!/^\d{6}$/.test(lawId ?? "") || !/^\d{1,20}$/.test(mst ?? "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate ?? "") ||
      typeof versionKey !== "string" || !versionKey.trim() ||
      ![beforeHash, afterHash].every(hash => /^[a-f0-9]{64}$/.test(hash ?? "")) || beforeHash === afterHash) {
    throw new Error("Invalid correction report identifiers.");
  }

  const { snapshots, chunks } = await loadEvidence(dirname(reportPath));
  const before = snapshots.get(beforeHash);
  const after = snapshots.get(afterHash);
  const request = { target: "eflaw", lawId, MST: mst, efYd: effectiveDate.replaceAll("-", "") };
  if (before?.법령?.법령키 !== versionKey || after?.법령?.법령키 !== versionKey ||
      before.법령.기본정보?.공포일자 !== after.법령.기본정보?.공포일자 ||
      isDeepStrictEqual(before, after)) {
    throw new Error("Correction sources do not represent two distinct versions of the same edition.");
  }
  identifySample(request, before);
  identifySample(request, after);
  const changes = compareProvisions(chunks.filter(c => c.hash === beforeHash), chunks.filter(c => c.hash === afterHash));
  const status = changes.length ? "provision-changes" : "other-source-changes";
  const sourceSectionsChanged = [...new Set([...Object.keys(before.법령), ...Object.keys(after.법령)])]
    .filter(section => !isDeepStrictEqual(before.법령[section], after.법령[section]));
  if (status !== report.status || !isDeepStrictEqual(changes, report.changes) ||
      !isDeepStrictEqual(sourceSectionsChanged, report.sourceSectionsChanged)) {
    throw new Error("The report does not match the verified source comparison.");
  }
  return {
    lawId, mst, effectiveDate, versionKey, beforeHash, afterHash, changes,
    chunks: chunks.filter(chunk => chunk.hash === afterHash),
  };
}

export async function checkCorrection(db, correction, lock = false) {
  const { lawId, effectiveDate, versionKey, beforeHash, afterHash, changes } = correction;
  const { rows: [current] } = await db.query(
    `SELECT r.id, s.cont_hash, EXISTS (
       SELECT 1 FROM src_snapshot prior
       WHERE prior.src_cd='MOLEG' AND prior.src_key=l.src_key AND prior.cont_hash=$4
     ) AS already_seen
     FROM legal l JOIN legal_ver v ON v.legal_id=l.id AND NOT v.del_yn
     JOIN legal_ver_rev r ON r.legal_ver_id=v.id AND r.current_yn
     JOIN src_snapshot s ON s.id=r.src_snapshot_id
     WHERE l.src_cd='MOLEG' AND l.src_key=$1 AND NOT l.del_yn AND v.ver_key=$2 AND v.enfc_dt=$3::date
     ${lock ? "FOR UPDATE OF l,v,r" : ""}`,
    [lawId, versionKey, effectiveDate, afterHash],
  );
  if (current?.cont_hash === afterHash) return { status: "already-current", affected: [] };
  if (current?.cont_hash !== beforeHash) throw new Error("The current source changed after review. Review it again.");
  if (current.already_seen) throw new Error("The proposed source was already seen and will not replace the current revision.");

  const { rows } = await db.query(
    `SELECT c.src_key AS "caseSourceKey", cr.case_no AS "caseNumber", cs.cont_hash AS "caseHash",
       rel.ref_key AS reference,
       p.provi_type_cd || ':' || p.norm_no AS "unitKey"
     FROM legal_provi p
     JOIN legal_prec_provi rel ON rel.legal_provi_id=p.id AND NOT rel.del_yn AND rel.stat_cd='VERIFIED'
     JOIN legal_prec_rev cr ON cr.id=rel.legal_prec_rev_id AND cr.current_yn
     JOIN legal_prec c ON c.id=cr.legal_prec_id AND NOT c.del_yn
     JOIN src_snapshot cs ON cs.id=cr.src_snapshot_id
     WHERE p.legal_ver_rev_id=$1 AND NOT p.del_yn AND p.prnt_provi_id IS NULL
       AND p.provi_type_cd='ARTICLE'
     ORDER BY cr.case_no, rel.ref_key, rel.id`, [current.id],
  );
  const changedKeys = new Set(changes.map(change => change.key));
  // Every verified link is pinned to the old revision, even if its provision is unchanged.
  return { status: "ready-for-review", affected: rows.map(row => ({
    ...row, provisionChanged: changedKeys.has(row.unitKey),
  })) };
}

export async function getReviewedSample(correction, oc) {
  const { lawId, mst, effectiveDate, versionKey, afterHash, chunks } = correction;
  const efYd = effectiveDate.replaceAll("-", "");
  const { identity, bytes, payload } = await readOfficialSample({ target: "eflaw", lawId, MST: mst, efYd }, oc);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== afterHash || payload.법령.법령키 !== versionKey) {
    throw new Error("The official source changed after review. Review it again.");
  }
  const sourceDate = payload.법령.기본정보.공포일자;
  if (!/^\d{8}$/.test(sourceDate ?? "")) throw new Error("The official source is missing its promulgation date.");
  const promulgated = [sourceDate.slice(0, 4), sourceDate.slice(4, 6), sourceDate.slice(6)].join("-");
  return {
    date: effectiveDate, promulgated, sourceKey: lawId, versionKey, title: identity.title,
    url: `https://www.law.go.kr/LSW/lsInfoP.do?efYd=${efYd}&lsiSeq=${mst}`,
    raw: bytes.toString("utf8"), hash, chunks,
  };
}

export async function publishCorrection(db, correction, sample) {
  if (sample.hash !== correction.afterHash || sample.sourceKey !== correction.lawId ||
      sample.versionKey !== correction.versionKey || sample.date !== correction.effectiveDate) {
    throw new Error("The proposed source does not match the reviewed edition.");
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))");
  const result = await checkCorrection(db, correction, true);
  if (result.status === "already-current") return result;
  const published = await importEdition(db, sample);
  if (published.status !== "corrected") throw new Error("The reviewed correction could not be published.");
  return { ...result, ...published };
}

async function main() {
  const [reportPath, flag, ...extra] = process.argv.slice(2);
  const apply = flag === "--apply";
  const oc = process.env.MOLEG_OC?.trim();
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!reportPath || extra.length || (flag !== undefined && !apply) || (apply && !oc) ||
      url?.protocol !== "postgresql:" || url.host !== "127.0.0.1:5433" || url.pathname !== "/aurore_dev_check") {
    throw new Error("Supply a correction review path and the local DB. Applying also requires --apply and MOLEG_OC.");
  }
  const correction = await readCorrection(reportPath);
  const sample = apply ? await getReviewedSample(correction, oc) : null;
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = apply ? await publishCorrection(db, correction, sample) : await checkCorrection(db, correction);
    await db.query("COMMIT");
    const { versionKey, effectiveDate, beforeHash, afterHash } = correction;
    console.log(JSON.stringify({ versionKey, effectiveDate, beforeHash, afterHash, ...result }, null, 2));
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
    console.error(error.constructor === Error ? error.message : error.code ?? "Correction preflight failed.");
    process.exitCode = 1;
  }
}
