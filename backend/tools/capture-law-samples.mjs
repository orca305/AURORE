import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const apiUrl = "https://www.law.go.kr/DRF/lawService.do";
const samples = [
  { target: "eflaw", MST: "276291", efYd: "20260102", lawId: "001248" },
  { target: "eflaw", MST: "249999", efYd: "20230719", lawId: "001248" },
  { target: "prec", ID: "239217", caseNumber: "2023다258672" },
];

export const historicalEditions = new Map([["19990301", "60305"], ["20201210", "218963"]]);

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function identifySample(sample, payload) {
  if (sample.target === "eflaw") {
    const law = payload?.법령;
    const info = law?.기본정보;
    const rawUnits = law?.조문?.조문단위;
    const units = Array.isArray(rawUnits) ? rawUnits : rawUnits ? [rawUnits] : [];
    if (String(info?.법령ID) !== sample.lawId || String(info?.시행일자) !== sample.efYd ||
        !hasText(info?.법령명_한글) || !Array.isArray(units) ||
        !units.some((unit) => hasText(unit?.조문내용))) {
      throw new Error("Expected law, effective date and article text were not present.");
    }
    return {
      kind: "law",
      sourceKey: sample.lawId,
      edition: `${sample.MST}-${sample.efYd}`,
      title: info.법령명_한글,
      articleUnits: units.length,
    };
  }

  const ruling = payload?.PrecService;
  if (String(ruling?.판례정보일련번호) !== sample.ID || ruling?.사건번호 !== sample.caseNumber ||
      !hasText(ruling?.법원명) || !hasText(ruling?.판례내용)) {
    throw new Error("Expected case identifier and decision text were not present.");
  }
  return { kind: "case", sourceKey: sample.ID, caseNumber: ruling.사건번호, court: ruling.법원명 };
}

export async function storeSnapshot(directory, bytes) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${hash}.json`);
  const temporary = join(directory, `.${randomUUID()}.part`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(bytes);
    } finally {
      await file.close();
    }
    try {
      // Link the finished file atomically without replacing any stored snapshot.
      await link(temporary, destination);
      return { hash, status: "saved" };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await readFile(destination)).equals(bytes)) {
        throw new Error("Stored snapshot does not match its content hash.");
      }
      return { hash, status: "duplicate" };
    }
  } finally {
    await unlink(temporary);
  }
}

export async function readOfficialSample(sample, oc) {
  const url = new URL(apiUrl);
  url.search = new URLSearchParams({
    OC: oc,
    type: "JSON",
    ...(sample.target === "eflaw"
      ? { target: "eflaw", MST: sample.MST, efYd: sample.efYd }
      : { target: "prec", ID: sample.ID }),
  });
  let response;
  let bytes;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error("Could not read the official API response.");
  }
  if (!response.ok) throw new Error(`Official API returned HTTP ${response.status}.`);

  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/사용자 정보 검증|서버장비의 IP주소/.test(text) && text.length < 2_000) {
    throw new Error("Official API rejected the OC or caller registration.");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Official API did not return JSON.");
  }
  const payload = JSON.parse(text);
  const identity = identifySample(sample, payload);
  // Also detect escaped JSON or URL-encoded credentials before storing bytes.
  const ocParam = /(?:[?&]|&amp;)OC=([^&"'\s]+)/gi;
  const plainJson = JSON.stringify(payload);
  const reflectedOc = [...plainJson.matchAll(ocParam)].some((match) => {
    try {
      return decodeURIComponent(match[1].replaceAll("+", " ")) === oc;
    } catch {
      return false;
    }
  });
  if (text.includes(oc) || plainJson.includes(oc) || reflectedOc) {
    throw new Error("Official API echoed the OC. Snapshot was rejected.");
  }
  return { identity, bytes, payload };
}

async function captureSample(sample, oc, outDir) {
  const { identity, bytes } = await readOfficialSample(sample, oc);
  const segments = [identity.kind, identity.sourceKey];
  if (identity.edition) segments.push(identity.edition);
  const result = await storeSnapshot(join(outDir, ...segments), bytes);
  return { ...identity, ...result, bytes: bytes.length };
}

async function main() {
  const [outDir, mode, ...extra] = process.argv.slice(2);
  const oc = process.env.MOLEG_OC?.trim();
  if (!outDir || extra.length || (mode !== undefined && mode !== "--historical") || !oc) {
    console.error("Set MOLEG_OC, then run: node backend/tools/capture-law-samples.mjs <snapshot-directory> [--historical]");
    process.exitCode = 1;
    return;
  }
  const selected = mode === "--historical"
    ? Array.from(historicalEditions, ([efYd, MST]) => ({ target: "eflaw", MST, efYd, lawId: "001248" }))
    : samples;
  for (const sample of selected) {
    const reference = sample.MST ?? sample.ID;
    try {
      console.log(JSON.stringify(await captureSample(sample, oc, outDir)));
    } catch (error) {
      // Emit diagnostic categories only. Parser and fetch errors may include source data.
      const message = error.constructor === Error ? error.message : (error.code ?? "Invalid response data.");
      console.error(JSON.stringify({ reference, error: message }));
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) await main();
