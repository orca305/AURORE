import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { identifySample, readOfficialSample, storeSnapshot } from "./capture-law-samples.mjs";
import { loadEvidence } from "./law-evidence.mjs";
import { packProvisions } from "./pack-provisions.mjs";

function indexUnits(chunks) {
  const result = new Map();
  for (const unit of packProvisions(chunks)) {
    const key = `${unit.type}:${unit.normalizedNumber}`;
    if (result.has(key)) throw new Error("The correction has ambiguous provision identifiers.");
    const { displayNumber, title, text, effectiveDate } = unit;
    result.set(key, { displayNumber, title, effectiveDate, text });
  }
  if (!result.size) throw new Error("The correction contains no provision units.");
  return result;
}

export function compareProvisions(before, after) {
  const old = indexUnits(before);
  const next = indexUnits(after);
  const changes = [];
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const previous = old.get(key) ?? null;
    const updated = next.get(key) ?? null;
    if (!isDeepStrictEqual(previous, updated)) {
      changes.push({ key, change: !previous ? "added" : !updated ? "removed" : "modified",
        before: previous, after: updated });
    }
  }
  return changes;
}

async function review(db, candidate, oc, outputParent) {
  const { lawId, mst, effectiveDate, versionKey } = candidate;
  const sample = { target: "eflaw", lawId, MST: mst, efYd: effectiveDate.replaceAll("-", "") };
  const { rows: [stored] } = await db.query(
    `SELECT s.src_cont,s.cont_hash,s.src_url
     FROM legal l JOIN legal_ver v ON v.legal_id=l.id AND NOT v.del_yn
     JOIN legal_ver_rev r ON r.legal_ver_id=v.id AND r.current_yn
     JOIN src_snapshot s ON s.id=r.src_snapshot_id
     WHERE l.src_cd='MOLEG' AND l.src_key=$1 AND NOT l.del_yn AND v.ver_key=$2 AND v.enfc_dt=$3::date`,
    [lawId, versionKey, effectiveDate],
  );
  if (!stored) throw new Error("The correction has no published source to compare.");
  const beforeBytes = Buffer.from(stored.src_cont, "utf8");
  if (createHash("sha256").update(beforeBytes).digest("hex") !== stored.cont_hash) {
    throw new Error("The stored source hash does not match its text.");
  }
  const before = JSON.parse(stored.src_cont);
  identifySample(sample, before);
  const { bytes, payload: after } = await readOfficialSample(sample, oc);
  if (before.법령.법령키 !== versionKey || after.법령.법령키 !== versionKey ||
      before.법령.기본정보.공포일자 !== after.법령.기본정보.공포일자) {
    throw new Error("Source identity changed. Re-run the refresh preview.");
  }
  const identity = { lawId, mst, effectiveDate, versionKey };
  if (isDeepStrictEqual(before, after)) return { ...identity, status: "no-semantic-change" };

  const directory = await mkdtemp(join(resolve(outputParent), "law-correction-"));
  const { hash: beforeHash } = await storeSnapshot(directory, beforeBytes);
  const { hash: afterHash } = await storeSnapshot(directory, bytes);
  const { chunks } = await loadEvidence(directory);
  const changes = compareProvisions(chunks.filter(c => c.hash === beforeHash), chunks.filter(c => c.hash === afterHash));
  const status = changes.length ? "provision-changes" : "other-source-changes";
  const oldSections = before.법령;
  const newSections = after.법령;
  const sourceSectionsChanged = [...new Set([...Object.keys(oldSections), ...Object.keys(newSections)])]
    .filter(section => !isDeepStrictEqual(oldSections[section], newSections[section]));
  const reportPath = join(directory, "review.json");
  await writeFile(reportPath, JSON.stringify({ ...identity, status, beforeHash, afterHash,
    sourceSectionsChanged, changes }, null, 2) + "\n", { flag: "wx" });
  return { ...identity, status, changedUnits: changes.length, reportPath };
}

async function main() {
  const [outputParent, ...extra] = process.argv.slice(2);
  const oc = process.env.MOLEG_OC?.trim();
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!outputParent || extra.length || !oc || url?.protocol !== "postgresql:" ||
      url.host !== "127.0.0.1:5433" || url.pathname !== "/aurore_dev_check") {
    throw new Error("Pipe refresh preview JSON into this tool with the local DB and a staging directory.");
  }
  const input = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/u, ""));
  if (!Array.isArray(input?.results) || input.results.length > 20) {
    throw new Error("Expected a refresh preview with at most 20 results.");
  }
  const candidates = input.results.filter(row => row?.status === "correction-candidate");
  if (candidates.some(row => !/^\d{6}$/.test(row.lawId ?? "") || !/^\d{1,20}$/.test(row.mst ?? "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveDate ?? "") ||
      typeof row.versionKey !== "string" || !row.versionKey.trim())) {
    throw new Error("The correction candidate is missing source identifiers.");
  }
  const corrections = [];
  if (candidates.length) {
    const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    await db.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      for (const candidate of candidates) corrections.push(await review(db, candidate, oc, outputParent));
    } finally {
      await db.end();
    }
  }
  console.log(JSON.stringify({ corrections }, null, 2));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.constructor === Error ? error.message : error.code ?? "Correction review failed.");
    process.exitCode = 1;
  }
}
