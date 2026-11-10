import assert from "node:assert/strict";
import { test } from "node:test";
import { compareDecisionText } from "./compare-precedent-decisions.mjs";

test("compares changed paragraphs only and bounds large comparisons", () => {
  const result = compareDecisionText(
    "공통<br>삭제<br>중간<br/>이전 판단\n결론",
    "공통\n중간\n정정 판단<br />결론<br>추가",
  );
  assert.equal(result.status, "complete");
  assert.deepEqual(result.hunks.map(({ before, after }) => [before, after]), [
    [["삭제"], []],
    [["이전 판단"], ["정정 판단"]],
    [[], ["추가"]],
  ]);
  assert.deepEqual(compareDecisionText("같음<br>내용", "같음\n내용"), { status: "complete", hunks: [] });
  assert.deepEqual(compareDecisionText("이전\n".repeat(600), "정정\n".repeat(600)), {
    status: "comparison-limit", hunks: [],
  });
  const long = compareDecisionText("전".repeat(1_300), "후");
  assert.equal(long.status, "truncated");
  assert.equal(long.hunks[0].before[0].length, 1_200);
});
