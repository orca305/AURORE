import assert from "node:assert/strict";
import { test } from "node:test";
import { compareProvisions } from "./review-law-corrections.mjs";

const article = (number, text, effectiveDate = "20260102") =>
  ({ article: number, section: "article", path: ["article", number], group: "law:" + number,
     displayNumber: "제" + number + "조", text, effectiveDate });
const addendum = (text) =>
  ({ section: "addendum", path: ["addendum"], group: "law:addendum:2025", text });

test("reports changed provisions by stable identifiers and preserves their exact text", () => {
  const before = [article("1", "같은 원문"), article("2", "이전 원문"), addendum("이전 부칙")];
  const after = [addendum("새 부칙"), article("1", "같은 원문"), article("3", "새 원문")];
  const changes = compareProvisions(before, after);
  assert.deepEqual(changes.map(x => [x.key, x.change, x.before?.text, x.after?.text]), [
    ["ARTICLE:2", "removed", "이전 원문", undefined],
    ["ADDENDUM:2025", "modified", "이전 부칙", "새 부칙"],
    ["ARTICLE:3", "added", undefined, "새 원문"],
  ]);
  assert.deepEqual(compareProvisions(before, [...before].reverse()), []);
  assert.equal(compareProvisions([before[0]], [article("1", "같은 원문", "20260103")])[0].change, "modified");
  assert.throws(() => compareProvisions([], after), /no provision units/);
});
