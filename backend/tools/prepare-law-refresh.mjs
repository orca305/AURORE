import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readOfficialSample, storeSnapshot } from "./capture-law-samples.mjs";
import { loadEvidence } from "./law-evidence.mjs";
import { packProvisions } from "./pack-provisions.mjs";

function selectNewEditions(report) {
  if (!Array.isArray(report?.results) || report.results.length > 20) {
    throw new Error("Expected a refresh preview with at most 20 results.");
  }
  const selected = new Map();
  for (const row of report.results) {
    if (row?.status !== "new-edition") continue;
    const date = typeof row.effectiveDate === "string" ? row.effectiveDate.replaceAll("-", "") : "";
    if (!/^\d{6}$/.test(row.lawId ?? "") || !/^\d{1,20}$/.test(row.mst ?? "") ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveDate ?? "") ||
        typeof row.versionKey !== "string" || !row.versionKey.trim()) {
      throw new Error("A new edition has incomplete official identifiers.");
    }
    const key = JSON.stringify([row.lawId, row.versionKey, date]);
    const known = selected.get(key);
    if (known && known.MST !== row.mst) throw new Error("A new edition has competing source identifiers.");
    selected.set(key, { target: "eflaw", lawId: row.lawId, MST: row.mst, efYd: date, versionKey: row.versionKey });
  }
  return [...selected.values()];
}

async function prepare(report, outputParent, oc) {
  const selected = selectNewEditions(report);
  if (!selected.length) return { directory: null, editions: [] };

  const directory = await mkdtemp(join(resolve(outputParent), "law-refresh-"));
  const captures = [];
  for (const sample of selected) {
    const { bytes, payload } = await readOfficialSample(sample, oc);
    if (payload.법령.법령키 !== sample.versionKey) {
      throw new Error("The official version key changed after preview. Run preview again.");
    }
    const { hash } = await storeSnapshot(directory, bytes);
    captures.push({
      lawId: sample.lawId, mst: sample.MST, effectiveDate: sample.efYd,
      versionKey: sample.versionKey, hash,
    });
  }

  const { chunks } = await loadEvidence(directory);
  const editions = captures.map(capture => {
    const units = packProvisions(chunks.filter(chunk => chunk.hash === capture.hash));
    const articles = units.filter(unit => unit.type === "ARTICLE").length;
    if (articles === 0) throw new Error("An edition has no validated article units.");
    return { ...capture, articles, addenda: units.length - articles };
  });
  const manifest = { status: "ready-for-review", editions };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return { directory, ...manifest };
}

async function main() {
  const [outputParent, ...extra] = process.argv.slice(2);
  const oc = process.env.MOLEG_OC?.trim();
  if (!outputParent || extra.length || !oc) {
    throw new Error("Pipe the refresh preview JSON into this tool and supply an existing staging directory.");
  }
  const report = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/u, ""));
  console.log(JSON.stringify(await prepare(report, outputParent, oc), null, 2));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error.constructor === Error ? error.message : error.code ?? "Refresh preparation failed.");
    process.exitCode = 1;
  }
}
