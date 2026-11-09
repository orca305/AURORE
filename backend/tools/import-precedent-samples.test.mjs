import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importPrecedent, parsePrecedent } from "./import-precedent-samples.mjs";

const sample = { target: "prec", ID: "239217", caseNumber: "2023다258672" };
function parse(decision, spaces) {
  return parsePrecedent(sample, Buffer.from(JSON.stringify({ PrecService: {
    판례정보일련번호: sample.ID, 사건번호: sample.caseNumber, 사건명: "검증용 판례", 법원명: "대법원",
    선고일자: "20240111", 판시사항: "", 판결요지: "검증용 요지", 판례내용: decision,
  } }, null, spaces)));
}

test("keeps the original ruling after correction and does not publish formatting changes or failed writes", async () => {
  const db = new PGlite();
  try {
    const dir = new URL("../prisma/migrations/", import.meta.url);
    const names = (await readdir(dir)).filter((name) => /^\d{14}_/.test(name)).sort();
    for (const name of names) await db.exec(await readFile(new URL(name + "/migration.sql", dir), "utf8"));
    const run = (record) => db.transaction((tx) => importPrecedent(tx, record));
    const first = parse("최초 판결 본문<br/>둘째 줄");
    assert.equal(first.issue, null);
    assert.equal((await run(first)).status, "saved");
    assert.equal((await run(first)).status, "duplicate");
    assert.equal((await run(parse(first.decision, 2))).status, "format-only");
    const second = parse("정정된 판결 본문<br/>둘째 줄");
    assert.equal((await run(second)).status, "corrected");
    assert.equal((await run(first)).status, "previously-seen");
    await assert.rejects(db.transaction((tx) => importPrecedent({
      query(sql, args) {
        if (sql.startsWith("INSERT INTO legal_prec_rev")) throw new Error("simulated write failure");
        return tx.query(sql, args);
      },
    }, parse("실패한 판결 본문"))), /simulated write failure/);

    const { rows } = await db.query(
      "SELECT r.rev_no,r.current_yn,r.decision_cont,s.src_cont FROM legal_prec_rev r " +
      "JOIN src_snapshot s ON s.id=r.src_snapshot_id ORDER BY r.rev_no"
    );
    assert.deepEqual(rows, [
      { rev_no: 1, current_yn: false, decision_cont: first.decision, src_cont: first.raw },
      { rev_no: 2, current_yn: true, decision_cont: second.decision, src_cont: second.raw },
    ]);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM src_snapshot")).rows[0].count, 3);
    await db.query("UPDATE legal_prec SET del_yn=true,del_dttm=now()");
    await assert.rejects(run(second), /deleted precedent/);
  } finally { await db.close(); }
});
