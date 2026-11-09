import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importEdition } from "./import-law-samples.mjs";

const migrations = [
  "20260921044321_init_law",
  "20261105000000_aurore_foundation",
  "20261109000000_legal_version_revisions",
  "20261109001000_group_legal_provisions",
];

function sample(text, raw = JSON.stringify({ article: text, version: "v1" })) {
  return {
    title: "검증용 법령", sourceKey: "000001", versionKey: "v1",
    date: "2026-01-02", promulgated: "2025-10-01", url: "https://www.law.go.kr/",
    raw, hash: createHash("sha256").update(raw).digest("hex"),
    chunks: [{ id: "a", group: "law:000001:1", article: "1", path: ["article"], section: "article", displayNumber: "제1조", ancestors: ["raw"], text }],
  };
}

test("corrections preserve old citations, skip formatting changes, and roll back a failed new revision", async () => {
  const db = new PGlite();
  try {
    for (const name of migrations) {
      await db.exec(await readFile(new URL("../prisma/migrations/" + name + "/migration.sql", import.meta.url), "utf8"));
    }
    const run = (input) => db.transaction((tx) => importEdition(tx, input));
    const original = sample("원래 문구");
    assert.equal((await run(original)).status, "saved");
    assert.equal((await run(original)).status, "duplicate");
    const formatting = sample("원래 문구", '{ "version": "v1", "article": "원래 문구" }\n');
    assert.equal((await run(formatting)).status, "format-only");
    const corrected = sample("정정 문구");
    assert.equal((await run(corrected)).status, "corrected");
    assert.equal((await run(original)).status, "previously-seen");
    assert.equal((await run(corrected)).status, "duplicate");

    await assert.rejects(db.transaction((tx) => importEdition({
      query(sql, params) {
        if (sql.startsWith("INSERT INTO legal_provi")) throw new Error("simulated provision write failure");
        return tx.query(sql, params);
      },
    }, sample("적재 실패"))), /simulated provision write failure/);

    const { rows } = await db.query(
      "SELECT p.id::int AS id, r.rev_no, r.current_yn, p.provi_cont " +
      "FROM legal_provi p JOIN legal_ver_rev r ON r.id = p.legal_ver_rev_id ORDER BY r.rev_no",
    );
    assert.deepEqual(rows, [
      { id: 1, rev_no: 1, current_yn: false, provi_cont: "원래 문구" },
      { id: 2, rev_no: 2, current_yn: true, provi_cont: "정정 문구" },
    ]);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM src_snapshot")).rows[0].count, 3);
  } finally {
    await db.close();
  }
});

test("regroups existing fragment rows without replacing their IDs or creating a new revision", async () => {
  const db = new PGlite();
  try {
    for (const name of migrations) {
      await db.exec(await readFile(new URL("../prisma/migrations/" + name + "/migration.sql", import.meta.url), "utf8"));
    }
    const original = sample("제1조", JSON.stringify({ article: "제1조", paragraph: "① 원문" }));
    original.chunks.push({
      group: "law:000001:1", id: "p", section: "paragraph", displayNumber: "①",
      ancestors: ["raw", "a"], path: ["paragraph"], text: "① 원문",
    });
    await db.exec("INSERT INTO legal (src_cd,src_key,legal_nm) VALUES ('MOLEG','000001','검증용 법령')");
    await db.query(
      "INSERT INTO src_snapshot (src_cd,src_key,src_url,cont_type,src_cont,cont_hash) VALUES ('MOLEG','000001','https://www.law.go.kr/','application/json',$1,$2)",
      [original.raw, original.hash],
    );
    await db.exec(
      "INSERT INTO legal_ver (legal_id,ver_key,prml_dt,enfc_dt) VALUES (1,'v1','2025-10-01','2026-01-02');" +
      "INSERT INTO legal_ver_rev (legal_ver_id,rev_no,src_snapshot_id,current_yn) VALUES (1,1,1,true);" +
      "INSERT INTO legal_provi (legal_ver_rev_id,provi_type_cd,disp_no,sort_seq,provi_cont) VALUES (1,'ARTICLE','제1조',1,'제1조');" +
      "INSERT INTO legal_provi (legal_ver_rev_id,prnt_provi_id,provi_type_cd,disp_no,sort_seq,provi_cont) VALUES (1,1,'PARAGRAPH','①',2,'① 원문');"
    );
    const run = () => db.transaction((tx) => importEdition(tx, original));
    assert.equal((await run()).status, "grouped");
    assert.equal((await run()).status, "duplicate");
    const { rows } = await db.query("SELECT id::int AS id, provi_cont, src_parts, del_yn FROM legal_provi ORDER BY id");
    assert.deepEqual(rows.map(({id,provi_cont,del_yn}) => [id,provi_cont,del_yn]), [
      [1, "제1조\n① 원문", false], [2, "① 원문", true],
    ]);
    assert.deepEqual(rows[0].src_parts[1].path, ["paragraph"]);
    assert.equal(rows[0].provi_cont.slice(rows[0].src_parts[1].start, rows[0].src_parts[1].end), "① 원문");
    assert.equal((await db.query("SELECT count(*)::int AS count FROM legal_ver_rev")).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
