import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { readOfficialSample } from "./capture-law-samples.mjs";

export function classifyRefresh({ current, seen, date, promulgated, hash, raw }) {
  if (current && (current.del_yn || current.enfc_dt !== date ||
      current.prml_dt !== promulgated || !current.src_cont)) return "edition-conflict";
  if (current?.cont_hash === hash) return current.src_cont === raw ? "unchanged" : "source-conflict";
  if (seen) return current && seen.src_cont === raw ? "previously-seen" : "source-conflict";
  if (!current) return "new-edition";
  return isDeepStrictEqual(JSON.parse(current.src_cont), JSON.parse(raw))
    ? "format-only" : "correction-candidate";
}

function iso(date) {
  if (!/^\d{8}$/.test(date ?? "")) throw new Error("Invalid official date.");
  const value = [date.slice(0, 4), date.slice(4, 6), date.slice(6)].join("-");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid official date.");
  }
  return value;
}

export async function previewLawRefresh(db, candidate, oc) {
  const { lawId, mst, effectiveDate } = candidate;
  const date = iso(effectiveDate);
  const { rows: [law] } = await db.query(
    "SELECT id FROM legal WHERE src_cd='MOLEG' AND src_key=$1 AND NOT del_yn", [lawId],
  );
  if (!law) throw new Error("A candidate is outside the local watchlist.");

  const { bytes, payload } = await readOfficialSample({
    target: "eflaw", lawId, MST: mst, efYd: effectiveDate,
  }, oc);
  const versionKey = payload.법령.법령키;
  if (typeof versionKey !== "string" || !versionKey.trim()) throw new Error("Missing official version key.");
  const promulgated = iso(payload.법령.기본정보.공포일자);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { rows: [current] } = await db.query(
    `SELECT v.del_yn, v.enfc_dt::text, v.prml_dt::text, s.cont_hash, s.src_cont
     FROM legal_ver v LEFT JOIN legal_ver_rev r ON r.legal_ver_id=v.id AND r.current_yn
     LEFT JOIN src_snapshot s ON s.id=r.src_snapshot_id WHERE v.legal_id=$1 AND v.ver_key=$2 AND v.enfc_dt=$3::date`,
    [law.id, versionKey, date],
  );
  const { rows: [seen] } = await db.query(
    "SELECT src_cont FROM src_snapshot WHERE src_cd='MOLEG' AND src_key=$1 AND cont_hash=$2", [lawId, hash],
  );
  const status = classifyRefresh({ current, seen, date, promulgated, hash, raw: bytes.toString("utf8") });
  return { lawId, mst, effectiveDate: date, versionKey, storedEffectiveDate: current?.enfc_dt ?? null, status, hash };
}

async function main() {
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  const oc = process.env.MOLEG_OC?.trim();
  if (!oc || url?.protocol !== "postgresql:" || url.host !== "127.0.0.1:5433" ||
      url.pathname !== "/aurore_dev_check") throw new Error("Use MOLEG_OC and the local dev DB on port 5433.");

  const { candidates } = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/u, ""));
  if (!Array.isArray(candidates) || candidates.length > 20 || candidates.some(candidate =>
    !/^\d{6}$/.test(candidate?.lawId ?? "") || !/^\d{1,20}$/.test(candidate?.mst ?? "") ||
    !/^\d{8}$/.test(candidate?.effectiveDate ?? ""))) {
    throw new Error("Expected up to 20 candidates from the law refresh planner.");
  }
  const unique = new Map(candidates.map(c => [[c.lawId, c.mst, c.effectiveDate].join(":"), c]));
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const results = [];
    for (const candidate of unique.values()) results.push(await previewLawRefresh(db, candidate, oc));
    for (const result of results) {
      if (results.some(other => other.lawId === result.lawId && other.versionKey === result.versionKey &&
          other.effectiveDate === result.effectiveDate && other.hash !== result.hash)) result.status = "source-conflict";
    }
    console.log(JSON.stringify({ results: results.map(({ hash, ...result }) => result) }, null, 2));
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.constructor === Error ? error.message : error.code ?? "Refresh preview failed.");
    process.exitCode = 1;
  }
}
