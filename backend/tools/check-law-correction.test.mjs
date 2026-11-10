import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCorrection } from "./check-law-correction.mjs";

test("blocks stale and replayed corrections and reports every affected link", async () => {
  const correction = { beforeHash: "before", afterHash: "after", changes: [{ key: "ARTICLE:6의2" }] };
  const links = [{ unitKey: "ARTICLE:6의2" }, { unitKey: "ARTICLE:6의3" }];
  const db = current => ({
    query: async (sql) => ({ rows: sql.includes("FROM legal l") ? [current] : links }),
  });
  await assert.rejects(checkCorrection(db({ cont_hash: "newer" }), correction), /changed after review/);
  await assert.rejects(checkCorrection(db({ cont_hash: "before", already_seen: true }), correction), /already seen/);
  assert.deepEqual(await checkCorrection(db({ cont_hash: "after" }), correction), { status: "already-current", affected: [] });
  const result = await checkCorrection(db({ cont_hash: "before" }), correction);
  assert.deepEqual(result.affected.map(link => link.provisionChanged), [true, false]);
});
