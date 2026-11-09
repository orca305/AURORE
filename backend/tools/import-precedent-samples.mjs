import { createHash } from "node:crypto";
import pg from "pg";
import { identifySample, readOfficialSample } from "./capture-law-samples.mjs";

const samples = [
  { target: "prec", ID: "239217", caseNumber: "2023다258672" },
  { target: "prec", ID: "193797", caseNumber: "2005다4529" },
  { target: "prec", ID: "233877", caseNumber: "2022다255126" },
];

function optionalText(value) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("Unexpected precedent section format.");
  return value.trim() ? value : null;
}

export function parsePrecedent(sample, bytes) {
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const payload = JSON.parse(raw.replace(/^\uFEFF/u, ""));
  const identity = identifySample(sample, payload);
  const entry = payload.PrecService;
  const decisionDate = /^(\d{4})(\d{2})(\d{2})$/u.exec(entry.선고일자);
  const date = decisionDate?.slice(1).join("-");
  const parsed = new Date(date ?? "");
  if (!date || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
      typeof entry.사건명 !== "string" || !entry.사건명.trim()) {
    throw new Error("Precedent is missing a valid case title or decision date.");
  }

  return {
    sourceKey: identity.sourceKey, caseNumber: identity.caseNumber, court: identity.court,
    title: entry.사건명, date, issue: optionalText(entry.판시사항), summary: optionalText(entry.판결요지),
    decision: entry.판례내용, raw, json: JSON.stringify(payload),
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function importPrecedent(db, record) {
  const { rows: [existing] } = await db.query(
    "SELECT id, del_yn FROM legal_prec WHERE src_cd='MOLEG' AND src_key=$1 FOR UPDATE",
    [record.sourceKey],
  );
  if (existing?.del_yn) throw new Error("A deleted precedent cannot be republished by this tool.");
  const id = existing?.id ?? (await db.query(
    "INSERT INTO legal_prec (src_cd,src_key) VALUES ('MOLEG',$1) RETURNING id", [record.sourceKey],
  )).rows[0].id;
  const { rows: [current] } = await db.query(
    "SELECT r.id, r.rev_no, r.src_snapshot_id, ltrim(s.src_cont,chr(65279))::jsonb = $2::jsonb AS same_content " +
    "FROM legal_prec_rev r JOIN src_snapshot s ON s.id=r.src_snapshot_id " +
    "WHERE r.legal_prec_id=$1 AND r.current_yn", [id, record.json],
  );
  if (existing && !current) throw new Error("A stored precedent is missing its published revision.");

  const rawKey = "prec:" + record.sourceKey;
  const { rows: [known] } = await db.query(
    "SELECT id,src_cont FROM src_snapshot WHERE src_cd='MOLEG' AND src_key=$1 AND cont_hash=$2",
    [rawKey, record.hash],
  );
  if (known) {
    if (!current || known.src_cont !== record.raw) throw new Error("Stored precedent original is inconsistent.");
    return { caseNumber: record.caseNumber, status: known.id === current.src_snapshot_id ? "duplicate" : "previously-seen", revision: current.rev_no };
  }
  const { rows: [original] } = await db.query(
    "INSERT INTO src_snapshot (src_cd,src_key,src_url,cont_type,src_cont,cont_hash) " +
    "VALUES ('MOLEG',$1,$2,'application/json',$3,$4) RETURNING id",
    [rawKey, "https://www.law.go.kr/LSW/precInfoP.do?precSeq=" + encodeURIComponent(record.sourceKey), record.raw, record.hash],
  );
  if (current?.same_content) {
    return { caseNumber: record.caseNumber, status: "format-only", revision: current.rev_no };
  }

  const revision = (current?.rev_no ?? 0) + 1;
  const { rows: [saved] } = await db.query(
    "INSERT INTO legal_prec_rev " +
    "(legal_prec_id,src_snapshot_id,rev_no,case_no,case_nm,court_nm,decision_dt,issue_cont,summary_cont,decision_cont) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
    [id, original.id, revision, record.caseNumber, record.title, record.court, record.date, record.issue, record.summary, record.decision],
  );
  if (current) await db.query("UPDATE legal_prec_rev SET current_yn=false WHERE id=$1", [current.id]);
  await db.query("UPDATE legal_prec_rev SET current_yn=true WHERE id=$1", [saved.id]);
  return { caseNumber: record.caseNumber, status: current ? "corrected" : "saved", revision };
}

async function main() {
  const oc = process.env.MOLEG_OC?.trim();
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!oc || !url || url.protocol !== "postgresql:" || url.host !== "127.0.0.1:5433" ||
      url.pathname !== "/aurore_dev_check" || process.argv.length !== 2) {
    throw new Error("Set MOLEG_OC, then run: node --env-file=local-dev/.env backend/tools/import-precedent-samples.mjs");
  }

  // Collect and validate every response before opening the database transaction.
  const records = [];
  for (const sample of samples) {
    const { bytes } = await readOfficialSample(sample, oc);
    records.push(parsePrecedent(sample, bytes));
  }
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-precedent-import'))");
    const results = [];
    for (const record of records) results.push(await importPrecedent(db, record));
    await db.query("COMMIT");
    for (const result of results) console.log(JSON.stringify(result));
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
    console.error(error.constructor === Error ? error.message : error.code ?? "Precedent import failed.");
    process.exitCode = 1;
  }
}
