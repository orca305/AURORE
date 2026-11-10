import { createHash } from "node:crypto";
import pg from "pg";
import { verifyCitation } from "./law-evidence.mjs";

const circled = [..."①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"];

function unpackReference(row) {
  // ponytail: current reviewed keys contain a single article and optional paragraph list.
  // Store structured selectors before supporting more reference shapes.
  const ref = /^제(\d+)조(?:의(\d+))?(?: (제\d+항(?:·제\d+항)*))?$/u.exec(row.ref_key);
  const normalized = ref && (ref[2] ? ref[1] + "의" + ref[2] : ref[1]);
  const hash = createHash("sha256").update(row.src_cont, "utf8").digest("hex");
  if (!ref || normalized !== row.norm_no || hash !== row.cont_hash || !Array.isArray(row.src_parts)) {
    throw new Error("Stored precedent reference does not match its source.");
  }

  const payload = JSON.parse(row.src_cont);
  const law = payload.법령;
  if (law?.법령키 !== row.ver_key || law?.기본정보?.법령ID !== row.law_key ||
      law?.기본정보?.시행일자 !== row.effective_date.replaceAll("-", "")) {
    throw new Error("Stored law version does not match its source.");
  }

  const articleUnits = law.조문?.조문단위;
  const units = Array.isArray(articleUnits) ? articleUnits : [articleUnits];
  const articleIndex = units.findIndex(unit => unit?.조문여부 === "조문" &&
    unit.조문번호 === ref[1] && (unit.조문가지번호 || undefined) === ref[2]);
  if (articleIndex < 0) throw new Error("Reviewed article is missing from the source.");
  const article = units[articleIndex];
  const articlePath = ["법령", "조문", "조문단위", ...(Array.isArray(articleUnits) ? [articleIndex] : [])];
  const paragraphUnits = article.항;
  const paragraphs = Array.isArray(paragraphUnits) ? paragraphUnits : [paragraphUnits];
  const reviewedNumbers = ref[3]
    ? [...ref[3].matchAll(/제(\d+)항/gu)].map(match => Number(match[1]))
    : [];
  const paths = reviewedNumbers.length ? reviewedNumbers.map(number => {
    const marker = circled[number - 1];
    const index = marker ? paragraphs.findIndex(unit => unit?.항번호 === marker) : -1;
    if (index < 0) throw new Error("Reviewed paragraph is missing from the source.");
    return [...articlePath, "항", ...(Array.isArray(paragraphUnits) ? [index] : []), "항내용"];
  }) : [[...articlePath, "조문내용"]];

  return paths.map(path => {
    const part = row.src_parts.find(part => JSON.stringify(part.path) === JSON.stringify(path));
    if (!part || !Number.isInteger(part.start) || !Number.isInteger(part.end) ||
        part.start < 0 || part.end <= part.start || part.end > row.provi_cont.length) {
      throw new Error("Reviewed provision has invalid stored text offsets.");
    }
    const quote = row.provi_cont.slice(part.start, part.end);
    const id = [hash, ...path].join("/");
    const citation = { id, hash, start: 0, end: quote.length, quote };
    const allowed = new Map([[id, { hash, path }]]);
    if (!verifyCitation({ snapshots: new Map([[hash, payload]]) }, allowed, citation)) {
      throw new Error("Reviewed provision text differs from its source.");
    }
    return {
      ...citation, path, caseNumber: row.case_no, reference: row.ref_key,
      versionKey: row.ver_key, effectiveDate: row.effective_date,
      provisionId: row.provision_id, sourceUrl: row.src_url,
    };
  });
}

export async function verifiedEvidenceForPrecedent(db, caseSourceKey) {
  const { rows } = await db.query(
    `SELECT cr.case_no, rel.ref_key, l.src_key AS law_key, v.ver_key,
      v.enfc_dt::text AS effective_date, p.id::text AS provision_id, p.norm_no,
      p.provi_cont, p.src_parts, s.cont_hash, s.src_cont, s.src_url
    FROM legal_prec c
    JOIN legal_prec_rev cr ON cr.legal_prec_id=c.id AND cr.current_yn
    JOIN legal_prec_provi rel ON rel.legal_prec_rev_id=cr.id AND NOT rel.del_yn AND rel.stat_cd='VERIFIED'
    JOIN legal_provi p ON p.id=rel.legal_provi_id AND NOT p.del_yn
      AND p.provi_type_cd='ARTICLE' AND p.prnt_provi_id IS NULL
    JOIN legal_ver_rev vr ON vr.id=p.legal_ver_rev_id AND vr.current_yn
    JOIN legal_ver v ON v.id=vr.legal_ver_id AND NOT v.del_yn
    JOIN legal l ON l.id=v.legal_id AND NOT l.del_yn
    JOIN src_snapshot s ON s.id=vr.src_snapshot_id
    WHERE c.src_cd='MOLEG' AND c.src_key=$1 AND NOT c.del_yn
    ORDER BY rel.ref_key`, [caseSourceKey],
  );
  return rows.flatMap(unpackReference);
}

async function main() {
  const [caseSourceKey, ...extra] = process.argv.slice(2);
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!/^\d{1,20}$/.test(caseSourceKey ?? "") || extra.length ||
      url?.protocol !== "postgresql:" || url.host !== "127.0.0.1:5433" ||
      url.pathname !== "/aurore_dev_check") {
    throw new Error("Use the local dev DB and supply a numeric official precedent source key.");
  }
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    const evidence = await verifiedEvidenceForPrecedent(db, caseSourceKey);
    console.log(JSON.stringify(evidence.map(({ quote, ...item }) => item), null, 2));
  } finally {
    await db.end();
  }
}

if (import.meta.main) await main();
