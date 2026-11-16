import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const provisionLevels = [
  ["항", "항번호", "항내용", "paragraph"],
  ["호", "호번호", "호내용", "clause"],
  ["목", "목번호", "목내용", "item"],
];

function entries(parent, key, path) {
  const value = parent?.[key];
  if (value == null) return [];
  const fieldPath = [...path, key];
  return Array.isArray(value)
    ? value.map((item, index) => [item, [...fieldPath, index]])
    : [[value, fieldPath]];
}

function textAt(payload, path) {
  return path.reduce((value, key) => value?.[key], payload);
}

function* textPaths(value, path) {
  if (typeof value === "string") yield path;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* textPaths(item, [...path, index]);
  }
}

export function collectEvidence(payload, hash) {
  const evidence = [];
  function add(path, fields) {
    const text = textAt(payload, path);
    if (typeof text !== "string" || !text.trim()) return undefined;
    const id = [hash, ...path].join("/");
    const chunk = { ...fields, id, hash, path, text };
    evidence.push(chunk);
    return chunk;
  }

  if (payload.법령) {
    const law = payload.법령;
    const info = law.기본정보;
    const base = {
      kind: "law", sourceKey: info.법령ID, sourceVersionKey: law.법령키,
      title: info.법령명_한글, date: info.시행일자,
    };
    if (!base.sourceKey || !base.sourceVersionKey || !/^\d{8}$/.test(base.date)) {
      throw new Error("Law snapshot is missing version metadata.");
    }
    function visitChildren(parent, path, level, fields, ancestors) {
      const definition = provisionLevels[level];
      if (!definition) return;
      const [key, numberKey, textKey, section] = definition;
      for (const [child, childPath] of entries(parent, key, path)) {
        const displayNumber = child[numberKey] ?? null;
        // The source sometimes nests clauses in an unnumbered paragraph container.
        const chunk = add([...childPath, textKey], { ...fields, section, displayNumber, ancestors });
        visitChildren(child, childPath, level + 1, fields, chunk ? [...ancestors, chunk.id] : ancestors);
      }
    }
    for (const [item, path] of entries(law.조문, "조문단위", ["법령", "조문"])) {
      if (item.조문여부 !== "조문") continue;
      const article = item.조문가지번호 ? `${item.조문번호}의${item.조문가지번호}` : item.조문번호;
      const fields = {
        ...base, group: `law:${base.sourceKey}:${article}`, article,
        context: item.조문제목 ?? "", effectiveDate: item.조문시행일자 || base.date,
      };
      const chunk = add([...path, "조문내용"], {
        ...fields, section: "article",
        displayNumber: `제${item.조문번호}조${item.조문가지번호 ? `의${item.조문가지번호}` : ""}`,
        ancestors: [hash],
      });
      if (!chunk) throw new Error(`Article ${article} is missing its source text.`);
      visitChildren(item, path, 0, fields, [hash, chunk.id]);
    }
    for (const [item, path] of entries(law.부칙, "부칙단위", ["법령", "부칙"])) {
      for (const textPath of textPaths(item.부칙내용, [...path, "부칙내용"])) {
        add(textPath, {
          ...base, section: "addendum", group: `law:${base.sourceKey}:addendum:${item.부칙키}`,
          context: "부칙 적용례 경과조치", publishedAt: item.부칙공포일자, ancestors: [hash],
        });
      }
    }
    return evidence;
  }

  const ruling = payload.PrecService;
  if (!ruling?.판례정보일련번호 || !ruling.사건번호 || !/^\d{8}$/.test(ruling.선고일자)) {
    throw new Error("Case snapshot is missing identity metadata.");
  }
  for (const section of ["판시사항", "판결요지", "판례내용"]) {
    add(["PrecService", section], {
      kind: "case", sourceKey: ruling.판례정보일련번호, date: ruling.선고일자,
      title: ruling.사건명, caseNumber: ruling.사건번호, court: ruling.법원명,
      group: `case:${ruling.판례정보일련번호}`, section, ancestors: [hash],
    });
  }
  if (!evidence.some((chunk) => chunk.section === "판례내용")) {
    throw new Error("Case snapshot is missing the decision text.");
  }
  return evidence;
}

export async function loadEvidence(directory) {
  const snapshots = new Map();
  const chunks = [];
  for (const relative of await readdir(directory, { recursive: true })) {
    if (!/^[a-f0-9]{64}\.json$/.test(basename(relative))) continue;
    const bytes = await readFile(join(directory, relative));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (basename(relative) !== `${hash}.json`) throw new Error("Source snapshot hash does not match.");
    if (snapshots.has(hash)) continue;
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    snapshots.set(hash, payload);
    chunks.push(...collectEvidence(payload, hash));
  }
  if (!chunks.length) throw new Error("No evidence was loaded.");
  return { snapshots, chunks };
}

function normalize(text) {
  return text.replace(/<[^>]+>/g, " ").normalize("NFKC").toLowerCase();
}

function queryTerms(query) {
  const words = normalize(query).match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const terms = new Map();
  for (const word of words) {
    for (let i = 0; i < word.length - 1; i++) terms.set(word.slice(i, i + 2), 1);
  }
  for (const word of words) if (word.length > 2) terms.set(word, 3);
  return terms;
}

function isOmission(text) {
  return /^(?:[①-⑳]|\d+\.|[가-힣]\.)?\s*(?:생략|삭제)(?:\s*[<〈(].*[>〉)])?[.。]?$/u.test(text.trim());
}

function searchSegments(chunks, byId) {
  if (chunks[0].kind === "case") return chunks.map((chunk) => [chunk]);
  // ponytail: short units rank as a whole; long articles rank by paragraph branches.
  const length = chunks.reduce((total, chunk) => total + chunk.text.length + 1, 0);
  if (!chunks[0].article || length <= 1000) return [chunks];
  const branches = new Map();
  for (const chunk of chunks) {
    const paragraph = chunk.section === "paragraph" ? chunk.id :
      chunk.ancestors.find((id) => byId.get(id)?.section === "paragraph");
    const key = paragraph ?? "article";
    if (!branches.has(key)) branches.set(key, []);
    branches.get(key).push(chunk);
  }
  return [...branches.values()];
}

function matchesPart(chunk, requested, byId) {
  if (!requested.length) return true;
  if (chunk.section !== requested.at(-1)[0]) return false;
  const lineage = [...chunk.ancestors.map((id) => byId.get(id)).filter(Boolean), chunk];
  return requested.every(([section, number]) => lineage.some((ancestor) =>
    ancestor.section === section && ancestor.displayNumber?.normalize("NFKC").replace(/[.。]$/u, "").trim() === number,
  ));
}

export function searchEvidence(corpus, { query, date, limit = 5, hidden = new Set() }) {
  // ponytail: only exact captured law edition dates are covered by this small corpus.
  // A complete version catalogue is needed before offering arbitrary as-of dates.
  const activeEditions = new Map();
  for (const chunk of corpus.chunks) {
    if (chunk.section !== "article" || chunk.date !== date) continue;
    const existing = activeEditions.get(chunk.sourceKey);
    if (existing && existing !== chunk.hash) throw new Error("Law edition has multiple captured revisions.");
    activeEditions.set(chunk.sourceKey, chunk.hash);
  }
  if (!activeEditions.size) throw new Error("This date is outside the verified law editions.");

  const articleHint = query.match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
  const article = articleHint && (articleHint[2] ? `${articleHint[1]}의${articleHint[2]}` : articleHint[1]);
  const caseNumber = query.match(/\b\d{4}[가-힣]{1,4}\d+\b/u)?.[0];
  const requested = [
    ["paragraph", query.match(/(?:제\s*)?(\d+)\s*항/u)?.[1]],
    ["clause", query.match(/(?:제\s*)?(\d+)\s*호/u)?.[1]],
    ["item", query.match(/([가-힣])\s*목/u)?.[1]],
  ].filter(([, number]) => number);
  const terms = queryTerms(query);
  const grouped = new Map();
  const byId = new Map();
  for (const chunk of corpus.chunks) {
    if (hidden.has(chunk.id) || chunk.ancestors.some((id) => hidden.has(id))) continue;
    if (chunk.kind === "law" && (activeEditions.get(chunk.sourceKey) !== chunk.hash ||
        chunk.effectiveDate > date || chunk.publishedAt > date)) continue;
    if (chunk.kind === "case" && (chunk.date > date || (article && requested.length))) continue;
    if (caseNumber && chunk.caseNumber !== caseNumber) continue;
    if (article && chunk.kind === "law" && chunk.article !== article) continue;
    if (isOmission(chunk.text)) continue;
    if (!grouped.has(chunk.group)) grouped.set(chunk.group, []);
    grouped.get(chunk.group).push(chunk);
    byId.set(chunk.id, chunk);
  }

  const hits = [];
  const weight = (text) => {
    const normalized = normalize(text);
    let score = 0;
    for (const [term, amount] of terms) if (normalized.includes(term)) score += amount;
    return score;
  };
  for (const chunks of grouped.values()) {
    const first = chunks[0];
    const heading = [first.title, first.context, first.caseNumber].filter(Boolean).join(" ");
    const exact = (article && first.article === article) || (caseNumber && first.caseNumber === caseNumber);
    let best;
    for (const segment of searchSegments(chunks, byId)) {
      let excerpt;
      let bestPart = -1;
      for (const chunk of segment) {
        if (article && requested.length && !matchesPart(chunk, requested, byId)) continue;
        const partScore = weight(chunk.text);
        if (partScore > bestPart) {
          bestPart = partScore;
          excerpt = chunk;
        }
      }
      if (!excerpt) continue;
      const contextText = segment.map((chunk) => chunk.text).join("\n");
      const score = (exact ? 20 : 0) + 2 * weight(heading) + bestPart + weight(contextText);
      if (score > (best?.score ?? 0)) best = { chunk: { ...excerpt, contextText }, score };
    }
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ chunk }) => chunk);
}

export function verifyCitation(corpus, allowedEvidence, citation) {
  const chunk = allowedEvidence.get(citation?.id);
  if (!chunk || chunk.hash !== citation.hash) return false;
  const original = textAt(corpus.snapshots.get(chunk.hash), chunk.path);
  const { start, end, quote } = citation;
  return typeof original === "string" && Number.isInteger(start) && Number.isInteger(end) &&
    start >= 0 && end > start && end <= original.length && typeof quote === "string" &&
    Boolean(quote.trim()) && original.slice(start, end) === quote;
}
