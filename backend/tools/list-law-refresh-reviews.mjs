import { access, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import pg from "pg";
import { defaultRefreshJournal, refreshJournalStatus } from "./resume-law-refresh.mjs";

function withinJournal(journal, path) {
  const local = relative(journal, resolve(path));
  return Boolean(local) && !isAbsolute(local) && local !== ".." && !local.startsWith(".." + sep);
}

function dateValue(date) {
  return /^\d{8}$/.test(date ?? "") ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date;
}

async function collectWork(journal, state) {
  const items = [];
  if (!state.lastCompletedDate) return items;
  const files = (await readdir(journal)).filter(name =>
    /^\d{8}\.json$/.test(name) && name.slice(0, 8) >= state.fromDate &&
    name.slice(0, 8) <= state.lastCompletedDate).sort();
  for (const file of files) {
    const { report } = JSON.parse(await readFile(join(journal, file), "utf8"));
    for (const edition of report.prepared.editions) {
      const path = report.prepared.directory;
      items.push({
        kind: "new-edition", date: report.date, lawId: edition.lawId, versionKey: edition.versionKey,
        effectiveDate: dateValue(edition.effectiveDate), afterHash: edition.hash, path,
      });
    }
    for (const correction of report.corrections) {
      const path = correction.reportPath;
      if (!path) continue;
      let comparison;
      try {
        if (typeof path === "string" && withinJournal(journal, path)) comparison = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      items.push({
        kind: "correction", date: report.date, lawId: correction.lawId, versionKey: correction.versionKey,
        effectiveDate: correction.effectiveDate, path,
        beforeHash: comparison?.beforeHash, afterHash: comparison?.afterHash,
      });
    }
  }
  return items;
}

async function hasSources(journal, item) {
  if (typeof item.path !== "string" || !withinJournal(journal, item.path)) return false;
  const directory = item.kind === "correction" ? dirname(item.path) : item.path;
  const hashes = item.kind === "correction" ? [item.beforeHash, item.afterHash] : [item.afterHash];
  if (!hashes.every(hash => /^[a-f0-9]{64}$/.test(hash ?? ""))) return false;
  try {
    await access(item.kind === "correction" ? item.path : join(directory, "manifest.json"));
    for (const hash of hashes) await access(join(directory, hash + ".json"));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function listLawRefreshReviews(db, journal) {
  const state = await refreshJournalStatus(journal);
  const pending = new Map();
  for (const item of await collectWork(journal, state)) {
    const { rows: [edition] } = await db.query(
      `SELECT l.del_yn AS law_deleted, v.id AS edition_id, v.del_yn, active_src.cont_hash AS current_hash, EXISTS (
        SELECT 1 FROM legal_ver_rev prior JOIN src_snapshot s ON s.id=prior.src_snapshot_id
        WHERE prior.legal_ver_id=v.id AND s.cont_hash=$4
      ) AS applied
      FROM legal l LEFT JOIN legal_ver v ON v.legal_id=l.id AND v.ver_key=$2 AND v.enfc_dt=$3::date
      LEFT JOIN legal_ver_rev active ON active.legal_ver_id=v.id AND active.current_yn
      LEFT JOIN src_snapshot active_src ON active_src.id=active.src_snapshot_id
      WHERE l.src_cd='MOLEG' AND l.src_key=$1`,
      [item.lawId, item.versionKey, item.effectiveDate, item.afterHash ?? null],
    );
    if (edition?.applied) continue;
    let status;
    if (!(await hasSources(journal, item))) status = "artifacts-missing";
    else if (!edition || edition.law_deleted) status = "watch-inactive";
    else if (item.kind === "new-edition") status = edition.edition_id ? "edition-changed" : "ready-to-apply";
    else status = edition.edition_id && !edition.del_yn && edition.current_hash === item.beforeHash
      ? "ready-to-review" : "stale-review";
    const key = JSON.stringify([item.kind, item.lawId, item.versionKey, item.effectiveDate, item.afterHash ?? item.path]);
    const previous = pending.get(key);
    if (!previous || status !== "artifacts-missing" || previous.status === "artifacts-missing") {
      pending.set(key, { ...item, status });
    }
  }
  return { lastCompletedDate: state.lastCompletedDate, pending: [...pending.values()] };
}

async function main() {
  const [rawDirectory = defaultRefreshJournal, ...extra] = process.argv.slice(2);
  if (rawDirectory === "--help" && !extra.length) {
    console.log("Usage: node --env-file=local-dev/.env backend/tools/list-law-refresh-reviews.mjs [journal-directory]");
    return;
  }
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (extra.length || rawDirectory.startsWith("--") || url?.protocol !== "postgresql:" ||
      url.host !== "127.0.0.1:5433" || url.pathname !== "/aurore_dev_check") {
    throw new Error("Supply a refresh journal directory and the local development DB.");
  }
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    console.log(JSON.stringify(await listLawRefreshReviews(db, resolve(rawDirectory)), null, 2));
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.constructor === Error ? error.message : error.code ?? "Refresh review listing failed.");
    process.exitCode = 1;
  }
}
