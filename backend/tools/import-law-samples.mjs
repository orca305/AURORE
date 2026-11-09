import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import pg from "pg";
import { loadEvidence } from "./law-evidence.mjs";
import { packProvisions } from "./pack-provisions.mjs";
import { historicalEditions } from "./capture-law-samples.mjs";

const editions = new Map([["20230719", "249999"], ["20260102", "276291"]]);
const legacyTypes = { article: "ARTICLE", paragraph: "PARAGRAPH", clause: "ITEM", item: "SUBITEM", addendum: "ADDENDUM" };

function dateValue(value) {
  if (!/^\d{8}$/.test(value)) throw new Error("Expected an eight-digit source date.");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
}

async function readSamples(directory, selectedHash, selectedEditions) {
  const corpus = await loadEvidence(directory);
  const paths = await readdir(directory, { recursive: true });
  const samples = [];
  for (const [date, mst] of selectedEditions) {
    const chunks = corpus.chunks.filter((chunk) =>
      chunk.kind === "law" && chunk.sourceKey === "001248" && chunk.date === date &&
      (!selectedHash || chunk.hash === selectedHash),
    );
    const hashes = [...new Set(chunks.map((chunk) => chunk.hash))];
    if (selectedHash && hashes.length === 0) continue;
    if (hashes.length !== 1) throw new Error(`Expected one captured edition for ${date}. Choose a specific hash if multiple snapshots exist.`);
    const hash = hashes[0];
    const relative = paths.find((path) => basename(path) === `${hash}.json`);
    if (!relative) throw new Error(`Source snapshot for ${date} is missing.`);
    const raw = (await readFile(join(directory, relative))).toString("utf8");
    if (createHash("sha256").update(raw, "utf8").digest("hex") !== hash) {
      throw new Error(`Source snapshot for ${date} changed before import.`);
    }
    const law = corpus.snapshots.get(hash).법령;
    samples.push({
      date: dateValue(date), promulgated: dateValue(law.기본정보.공포일자),
      sourceKey: "001248", versionKey: law.법령키, title: law.기본정보.법령명_한글,
      url: `https://www.law.go.kr/LSW/lsInfoP.do?efYd=${date}&lsiSeq=${mst}`,
      hash, raw, chunks,
    });
  }
  if (!samples.length) throw new Error("Requested law snapshot was not found.");
  return samples;
}

function canonicalJson(raw) {
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, sorted(value[name])]));
  }
  return JSON.stringify(sorted(JSON.parse(raw)));
}

function unitValues(unit, index) {
  return [unit.type, unit.displayNumber, unit.normalizedNumber, index + 1, unit.title,
    unit.text, unit.effectiveDate ? dateValue(unit.effectiveDate) : null, JSON.stringify(unit.parts)];
}

async function verifyOrPackStored(db, revisionId, chunks, units) {
  const { rows } = await db.query(
    "SELECT id, sort_seq, provi_type_cd, disp_no, provi_cont, src_parts, del_yn, prnt_provi_id " +
    "FROM legal_provi WHERE legal_ver_rev_id = $1 ORDER BY sort_seq, id", [revisionId],
  );
  const packed = rows.filter((row) => row.src_parts !== null);
  if (packed.length) {
    if (packed.length !== units.length || rows.some((row) => row.src_parts === null && !row.del_yn)) {
      throw new Error("Stored provision units do not match the grouped source.");
    }
    return "duplicate";
  }

  // Only repack the exact, untouched legacy projection of the same source snapshot.
  if (rows.length !== chunks.length || rows.some((row, index) =>
    row.del_yn || row.sort_seq !== index + 1 || row.provi_cont !== chunks[index].text ||
    row.provi_type_cd !== legacyTypes[chunks[index].section] ||
    row.disp_no !== (chunks[index].displayNumber ?? "부칙")
  )) throw new Error("Existing fragments do not match the unchanged source. Repacking was stopped.");

  const retained = new Set();
  for (const [index, unit] of units.entries()) {
    const row = rows[unit.members[0].index];
    if (row.prnt_provi_id !== null) throw new Error("The group representative is not a root provision.");
    retained.add(row.id);
    await db.query(
      "UPDATE legal_provi SET provi_type_cd=$1, disp_no=$2, norm_no=$3, sort_seq=$4, provi_nm=$5, " +
      "provi_cont=$6, enfc_dt=$7, src_parts=$8::jsonb, upt_dttm=now() WHERE id=$9",
      [...unitValues(unit, index), row.id],
    );
  }
  const retired = rows.filter((row) => !retained.has(row.id)).map((row) => row.id);
  if (retired.length) await db.query(
    "UPDATE legal_provi SET del_yn=true, del_dttm=now(), upt_dttm=now() WHERE id=ANY($1::bigint[])",
    [retired],
  );
  return "grouped";
}

export async function importEdition(db, sample) {
  const units = packProvisions(sample.chunks);
  if (!units.length) throw new Error("An empty revision cannot be published.");
  const original = JSON.parse(sample.raw);
  if (sample.chunks.some((chunk) =>
    chunk.path.reduce((value, key) => value?.[key], original) !== chunk.text
  )) throw new Error("Provision text does not match the raw snapshot.");
  const { rows: [existingLaw] } = await db.query(
    "SELECT id, del_yn FROM legal WHERE src_cd = 'MOLEG' AND src_key = $1", [sample.sourceKey],
  );
  if (existingLaw?.del_yn) throw new Error("A deleted law cannot be imported by this tool.");
  const lawId = existingLaw?.id ?? (await db.query(
    "INSERT INTO legal (src_cd, src_key, legal_nm) VALUES ('MOLEG', $1, $2) RETURNING id",
    [sample.sourceKey, sample.title],
  )).rows[0].id;

  const { rows: [existing] } = await db.query(
    "SELECT v.id, v.del_yn, v.enfc_dt::text, v.prml_dt::text, r.id AS revision_id, r.rev_no, " +
    "s.cont_hash, s.src_cont FROM legal_ver v " +
    "LEFT JOIN legal_ver_rev r ON r.legal_ver_id = v.id AND r.current_yn " +
    "LEFT JOIN src_snapshot s ON s.id = r.src_snapshot_id " +
    "WHERE v.legal_id = $1 AND v.ver_key = $2 FOR UPDATE OF v", [lawId, sample.versionKey],
  );
  if (existing && (existing.del_yn || existing.enfc_dt !== sample.date ||
      existing.prml_dt !== sample.promulgated || !existing.revision_id || !existing.src_cont)) {
    throw new Error("Stored edition is deleted or has incompatible metadata.");
  }
  if (existing?.cont_hash === sample.hash) {
    if (existing.src_cont !== sample.raw) throw new Error("Stored source hash does not match its text.");
    const status = await verifyOrPackStored(db, existing.revision_id, sample.chunks, units);
    return { date: sample.date, status, revision: existing.rev_no, provisions: units.length };
  }

  const { rows: [known] } = await db.query(
    "SELECT src_cont FROM src_snapshot WHERE src_cd = 'MOLEG' AND src_key = $1 AND cont_hash = $2",
    [sample.sourceKey, sample.hash],
  );
  if (known) {
    if (!existing || known.src_cont !== sample.raw) throw new Error("Stored source and edition are inconsistent.");
    // An already observed response never replaces the currently published revision on replay.
    return { date: sample.date, status: "previously-seen", revision: existing.rev_no };
  }

  const { rows: [snapshot] } = await db.query(
    "INSERT INTO src_snapshot (src_cd, src_key, src_url, cont_type, src_cont, cont_hash) " +
    "VALUES ('MOLEG', $1, $2, 'application/json', $3, $4) RETURNING id",
    [sample.sourceKey, sample.url, sample.raw, sample.hash],
  );
  if (existing && canonicalJson(existing.src_cont) === canonicalJson(sample.raw)) {
    return { date: sample.date, status: "format-only", revision: existing.rev_no };
  }

  const versionId = existing?.id ?? (await db.query(
    "INSERT INTO legal_ver (legal_id, ver_key, prml_dt, enfc_dt) VALUES ($1, $2, $3, $4) RETURNING id",
    [lawId, sample.versionKey, sample.promulgated, sample.date],
  )).rows[0].id;
  const revNo = (existing?.rev_no ?? 0) + 1;
  const { rows: [revision] } = await db.query(
    "INSERT INTO legal_ver_rev (legal_ver_id, rev_no, src_snapshot_id) VALUES ($1, $2, $3) RETURNING id",
    [versionId, revNo, snapshot.id],
  );

  for (const [index, unit] of units.entries()) {
    await db.query(
      "INSERT INTO legal_provi (provi_type_cd, disp_no, norm_no, sort_seq, provi_nm, provi_cont, enfc_dt, src_parts, legal_ver_rev_id) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)",
      [...unitValues(unit, index), revision.id],
    );
  }
  if (existing) await db.query("UPDATE legal_ver_rev SET current_yn = false WHERE id = $1", [existing.revision_id]);
  await db.query("UPDATE legal_ver_rev SET current_yn = true WHERE id = $1", [revision.id]);
  return { date: sample.date, status: existing ? "corrected" : "saved", revision: revNo, provisions: units.length };
}

async function main() {
  const [directory, flag, selectedHash, ...extra] = process.argv.slice(2);
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  const validFlag = flag === undefined || (flag === "--historical" && selectedHash === undefined) ||
    (flag === "--snapshot" && /^[a-f0-9]{64}$/.test(selectedHash ?? ""));
  if (!directory || !url || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "5433" ||
      url.pathname !== "/aurore_dev_check" || extra.length || !validFlag) {
    throw new Error("Usage: node --env-file=local-dev/.env backend/tools/import-law-samples.mjs <snapshot-directory> [--snapshot sha256 | --historical]");
  }

  const samples = await readSamples(directory, selectedHash, flag === "--historical" ? historicalEditions : editions);
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-dev-check-sample-import'))");
    const results = [];
    for (const sample of samples) results.push(await importEdition(db, sample));
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
    console.error(error.constructor === Error ? error.message : error.code ?? "Law import failed.");
    process.exitCode = 1;
  }
}
