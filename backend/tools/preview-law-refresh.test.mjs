import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRefresh } from "./preview-law-refresh.mjs";

test("keeps differing effective dates separate from revisions and ignores JSON formatting", () => {
  const raw = '{"a":1,"b":2}';
  const current = { enfc_dt: "2023-07-19", prml_dt: "2023-04-18", cont_hash: "old", src_cont: raw };
  const input = { current, date: current.enfc_dt, promulgated: current.prml_dt, hash: "old", raw };
  const scenarios = [
    [{}, "unchanged"],
    [{ hash: "new", raw: '{ "b":2, "a":1 }' }, "format-only"],
    [{ hash: "new", raw: '{"a":2,"b":2}' }, "correction-candidate"],
    [{ hash: "seen", raw: "{}", seen: { src_cont: "{}" } }, "previously-seen"],
    [{ date: "2023-04-18" }, "edition-conflict"],
    [{ current: { ...current, del_yn: true } }, "edition-conflict"],
    [{ raw: "{}" }, "source-conflict"],
    [{ current: undefined }, "new-edition"],
  ];
  for (const [change, expected] of scenarios) {
    assert.equal(classifyRefresh({ ...input, ...change }), expected);
  }
});
