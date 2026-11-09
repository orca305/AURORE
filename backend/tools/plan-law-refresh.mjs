import pg from "pg";

const pageSize = 100;
const maxPages = 20;
const api = "https://www.law.go.kr/DRF/lawSearch.do";

function isDate(value) {
  if (!/^[0-9]{8}$/.test(value)) return false;
  const iso = [value.slice(0, 4), value.slice(4, 6), value.slice(6)].join("-");
  const date = new Date(iso);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(iso);
}

function digits(value) {
  const text = String(value ?? "");
  if (!/^[0-9]+$/.test(text)) throw new Error("Invalid identifier in the change list.");
  return text;
}

export function parseChangePage(payload) {
  const list = payload?.LawSearch;
  const count = String(list?.totalCnt ?? "");
  if (!/^[0-9]+$/.test(count) || Number(count) > pageSize * maxPages) {
    throw new Error("Change list is missing a valid total or exceeds the page limit.");
  }
  const total = Number(count);
  const entries = Array.isArray(list.law) ? list.law : list.law ? [list.law] : [];
  if ((!total && entries.length) || (total && !entries.length) || entries.length > pageSize) {
    throw new Error("Change list body does not agree with its total.");
  }
  const rows = entries.map((row) => {
    const effectiveDate = digits(row?.시행일자);
    if (!isDate(effectiveDate) || typeof row?.법령명한글 !== "string" || !row.법령명한글.trim()) {
      throw new Error("Change list row is missing a valid date or title.");
    }
    return {
      lawId: digits(row.법령ID).padStart(6, "0"),
      mst: digits(row.법령일련번호),
      effectiveDate,
      title: row.법령명한글,
    };
  });
  return { total, rows };
}

function key({ lawId, mst, effectiveDate }) {
  return [lawId, mst, effectiveDate].join(":");
}

export function planCandidates(rows, watched, stored) {
  const seen = new Set();
  const candidates = [];
  for (const row of rows) {
    const id = key(row);
    if (!watched.has(row.lawId) || seen.has(id)) continue;
    seen.add(id);
    candidates.push({ ...row, action: stored.has(id) ? "recheck" : "fetch" });
  }
  return candidates;
}

async function fetchChangeList(date, oc) {
  const rows = [];
  const pageKeys = new Set();
  let total;
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(api);
    url.search = new URLSearchParams({
      OC: oc, target: "lsHstInf", type: "JSON", regDt: date,
      display: String(pageSize), page: String(page),
    });
    let response;
    let payload;
    try {
      response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (response.ok) payload = await response.json();
    } catch {
      throw new Error("Could not read the official change-list response.");
    }
    if (!response.ok) throw new Error("Official change list returned HTTP " + response.status + ".");
    const data = parseChangePage(payload);
    total ??= data.total;
    const fingerprint = JSON.stringify(data.rows.map(key).sort());
    if (total !== data.total || pageKeys.has(fingerprint)) throw new Error("The paginated change list was inconsistent.");
    pageKeys.add(fingerprint);
    rows.push(...data.rows);
    if (rows.length === total) return { rows, pages: page };
    if (rows.length > total) throw new Error("The change list exceeded the reported total.");
  }
  throw new Error("The complete change list could not be read.");
}

async function getLocalWatchlist(url) {
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    const { rows } = await db.query(
      "SELECT l.src_key AS law_id, v.id AS version_id, s.src_url FROM legal l " +
      "LEFT JOIN legal_ver v ON v.legal_id = l.id AND NOT v.del_yn " +
      "LEFT JOIN legal_ver_rev r ON r.legal_ver_id = v.id AND r.current_yn " +
      "LEFT JOIN src_snapshot s ON s.id = r.src_snapshot_id " +
      "WHERE l.src_cd = 'MOLEG' AND NOT l.del_yn",
    );
    const watched = new Set();
    const stored = new Set();
    for (const row of rows) {
      const lawId = digits(row.law_id).padStart(6, "0");
      watched.add(lawId);
      if (!row.version_id) continue;
      const source = URL.parse(row.src_url ?? "");
      const mst = source?.searchParams.get("lsiSeq");
      const effectiveDate = source?.searchParams.get("efYd");
      if (!/^[0-9]+$/.test(mst ?? "") || !isDate(effectiveDate ?? "")) {
        throw new Error("A stored edition is missing its official lookup identifiers.");
      }
      stored.add(key({ lawId, mst, effectiveDate }));
    }
    return { watched, stored };
  } finally {
    await db.end();
  }
}

async function main() {
  const [date, ...extra] = process.argv.slice(2);
  const oc = process.env.MOLEG_OC?.trim();
  const db = URL.parse(process.env.DATABASE_URL ?? "");
  if (extra.length || !isDate(date ?? "") || !oc || !db || db.protocol !== "postgresql:" ||
      db.hostname !== "127.0.0.1" || db.port !== "5433" || db.pathname !== "/aurore_dev_check") {
    throw new Error("Set MOLEG_OC, then run: node --env-file=local-dev/.env backend/tools/plan-law-refresh.mjs YYYYMMDD");
  }
  const { watched, stored } = await getLocalWatchlist(db);
  if (!watched.size) throw new Error("No active MOLEG laws are tracked in the development DB.");
  const { rows, pages } = await fetchChangeList(date, oc);
  console.log(JSON.stringify({
    date, changes: rows.length, pages, watchedLaws: watched.size,
    candidates: planCandidates(rows, watched, stored),
  }, null, 2));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // Avoid echoing raw HTTP or PostgreSQL diagnostics and connection parameters.
    console.error(error.constructor === Error ? error.message : error.code ?? "Refresh plan failed.");
    process.exitCode = 1;
  }
}
