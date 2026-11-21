// 판례 "참조조문" 글을 읽어 (판례, 법령, 조문) 역인덱스(legal_prec_ref)를 만든다.
// 기본은 통계만 출력하는 점검 실행이고, --apply를 주면 없는 행만 추가한다(기존 행은 지우지 않는다).
import pg from "pg";
import { compactName, parseReferences } from "./precedent-ref-parser.mjs";

const url = URL.parse(process.env.DATABASE_URL ?? "");
if (url?.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
    url.port !== "5433" || url.pathname !== "/aurore_dev_check") {
  throw new Error("로컬 개발 DB(127.0.0.1:5433/aurore_dev_check)에서만 실행합니다.");
}
const ALIAS = { 헌법: "대한민국헌법" };
const apply = process.argv.includes("--apply");

const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
await db.connect();
try {
  const names = new Map();
  const legals = await db.query("SELECT id, legal_nm FROM legal WHERE NOT del_yn");
  for (const row of legals.rows) {
    const key = compactName(row.legal_nm);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(row.id);
  }

  const precs = await db.query(
    `SELECT r.legal_prec_id AS prec_id, s.src_cont::json->'PrecService'->>'참조조문' AS refs
       FROM legal_prec_rev r JOIN src_snapshot s ON s.id=r.src_snapshot_id
      WHERE r.current_yn AND COALESCE(s.src_cont::json->'PrecService'->>'참조조문','')<>''`,
  );

  const rows = [];
  const unresolved = new Map();
  let withRefs = 0;
  let precWithResolved = 0;
  for (const p of precs.rows) {
    const refs = parseReferences(p.refs);
    if (refs.length) withRefs += 1;
    let any = false;
    for (const ref of refs) {
      const ids = names.get(compactName(ALIAS[ref.lawName] ?? ref.lawName));
      if (!ids || ids.length !== 1) {
        const key = ref.lawName + (ids ? " (동명 " + ids.length + ")" : "");
        unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
        continue;
      }
      any = true;
      rows.push([p.prec_id, ids[0], ref.articleKey, ref.old, ref.lawName]);
    }
    if (any) precWithResolved += 1;
  }

  const totalRefs = rows.length + [...unresolved.values()].reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({
    precedentsWithRefText: precs.rowCount, parsed: withRefs, precedentsResolved: precWithResolved,
    refsTotal: totalRefs, refsResolved: rows.length,
    resolvedPct: Number(((rows.length / totalRefs) * 100).toFixed(1)),
    oldLawRefs: rows.filter((r) => r[3]).length,
  }));
  console.log("해결 못한 법령 이름 상위 25:");
  for (const [name, n] of [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(n).padStart(6), name);

  if (apply) {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('aurore-prec-ref-index'))");
    // 물리 삭제 금지 규칙에 따라 기존 행은 지우지 않고 없는 행만 추가한다(같은 규칙으로 다시 실행해도 결과가 같다).
    const size = 2000;
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      const values = [];
      const params = [];
      chunk.forEach((r, k) => {
        values.push(`($${k * 5 + 1},$${k * 5 + 2},$${k * 5 + 3},$${k * 5 + 4},$${k * 5 + 5})`);
        params.push(...r);
      });
      await db.query(
        `INSERT INTO legal_prec_ref (legal_prec_id, legal_id, art_key, old_yn, raw_law_nm) VALUES ${values.join(",")}
         ON CONFLICT DO NOTHING`, params,
      );
    }
    await db.query("COMMIT");
    const n = await db.query("SELECT count(*) AS n FROM legal_prec_ref");
    console.log("저장 완료:", n.rows[0].n, "건");
  } else {
    console.log("(점검 실행: 저장하지 않았습니다. --apply로 저장)");
  }
} catch (e) {
  try { await db.query("ROLLBACK"); } catch {}
  throw e;
} finally {
  await db.end();
}
