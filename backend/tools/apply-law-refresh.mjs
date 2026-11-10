import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { identifySample } from "./capture-law-samples.mjs";
import { importEdition } from "./import-law-samples.mjs";
import { loadEvidence } from "./law-evidence.mjs";
import { packProvisions } from "./pack-provisions.mjs";

function iso(date) {
  if (!/^\d{8}$/.test(date ?? "")) throw new Error("Invalid source date.");
  const value = [date.slice(0, 4), date.slice(4, 6), date.slice(6)].join("-");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid source date.");
  }
  return value;
}

export async function readPreparedEditions(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest?.status !== "ready-for-review" || !Array.isArray(manifest.editions) ||
      !manifest.editions.length || manifest.editions.length > 20) {
    throw new Error("Expected a reviewed staging directory with 1 to 20 editions.");
  }
  const { chunks } = await loadEvidence(directory);
  const identities = new Set();
  const samples = [];
  for (const entry of manifest.editions) {
    const { lawId, mst, effectiveDate, versionKey, hash, articles, addenda } = entry ?? {};
    if (!/^\d{6}$/.test(lawId ?? "") || !/^\d{1,20}$/.test(mst ?? "") ||
        !/^[a-f0-9]{64}$/.test(hash ?? "") || typeof versionKey !== "string" || !versionKey.trim() ||
        !Number.isInteger(articles) || articles < 1 || !Number.isInteger(addenda) || addenda < 0) {
      throw new Error("Invalid identifiers or counts in the staging manifest.");
    }
    const date = iso(effectiveDate);
    const identity = JSON.stringify([lawId, versionKey, date]);
    if (identities.has(identity)) throw new Error("The staging manifest repeats an edition.");
    identities.add(identity);

    const bytes = await readFile(join(directory, hash + ".json"));
    if (createHash("sha256").update(bytes).digest("hex") !== hash) {
      throw new Error("Staged source hash does not match the manifest.");
    }
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const payload = JSON.parse(raw);
    const source = identifySample({ target: "eflaw", lawId, MST: mst, efYd: effectiveDate }, payload);
    if (payload.법령.법령키 !== versionKey) throw new Error("Staged version key does not match the manifest.");
    const editionChunks = chunks.filter(chunk => chunk.hash === hash);
    const units = packProvisions(editionChunks);
    if (units.filter(unit => unit.type === "ARTICLE").length !== articles || units.length !== articles + addenda) {
      throw new Error("Staged provision counts do not match the manifest.");
    }
    samples.push({
      date, promulgated: iso(payload.법령.기본정보.공포일자), sourceKey: lawId,
      versionKey, title: source.title, hash, raw, chunks: editionChunks,
      url: `https://www.law.go.kr/LSW/lsInfoP.do?efYd=${effectiveDate}&lsiSeq=${mst}`,
    });
  }
  return samples;
}

async function applyPreparedEdition(db, sample) {
  const { rows: [law] } = await db.query(
    "SELECT id FROM legal WHERE src_cd='MOLEG' AND src_key=$1 AND NOT del_yn FOR UPDATE",
    [sample.sourceKey],
  );
  if (!law) throw new Error("The prepared edition is outside the active watchlist.");

  const { rows: [current] } = await db.query(
    `SELECT v.del_yn, v.prml_dt::text, s.cont_hash, s.src_cont
     FROM legal_ver v LEFT JOIN legal_ver_rev r ON r.legal_ver_id=v.id AND r.current_yn
     LEFT JOIN src_snapshot s ON s.id=r.src_snapshot_id
     WHERE v.legal_id=$1 AND v.ver_key=$2 AND v.enfc_dt=$3::date FOR UPDATE OF v`,
    [law.id, sample.versionKey, sample.date],
  );
  if (current) {
    if (!current.del_yn && current.prml_dt === sample.promulgated &&
        current.cont_hash === sample.hash && current.src_cont === sample.raw) {
      return { date: sample.date, status: "unchanged" };
    }
    throw new Error("The edition changed since preparation. Review it before publishing.");
  }
  const result = await importEdition(db, sample);
  if (result.status !== "saved") throw new Error("Only a new edition may be published from staging.");
  return result;
}

async function main() {
  const [directory, flag, ...extra] = process.argv.slice(2);
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!directory || flag !== "--apply" || extra.length ||
      url?.protocol !== "postgresql:" || url.host !== "127.0.0.1:5433" ||
      url.pathname !== "/aurore_dev_check") {
    throw new Error("Supply a staged directory and --apply with the local development DB on port 5433.");
  }
  const samples = await readPreparedEditions(directory);
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))");
    const results = [];
    for (const sample of samples) results.push(await applyPreparedEdition(db, sample));
    await db.query("COMMIT");
    console.log(JSON.stringify({ results }));
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
    console.error(error.constructor === Error ? error.message : error.code ?? "Staged import failed.");
    process.exitCode = 1;
  }
}
