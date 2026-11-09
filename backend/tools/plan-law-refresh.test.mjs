import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChangePage, planCandidates } from "./plan-law-refresh.mjs";

test("lists new editions and rechecks known editions, skipping other laws and duplicates", () => {
  const known = { 법령ID: "001248", 법령일련번호: "276291", 시행일자: "20260102", 법령명한글: "주택임대차보호법" };
  const newer = { ...known, 법령일련번호: "300000", 시행일자: "20270201" };
  const other = { ...known, 법령ID: "000001" };
  const { rows } = parseChangePage({ LawSearch: { totalCnt: "4", law: [known, newer, other, known] } });
  const result = planCandidates(rows, new Set(["001248"]), new Set(["001248:276291:20260102"]));
  assert.deepEqual(result.map(({ mst, action }) => [mst, action]), [
    ["276291", "recheck"], ["300000", "fetch"],
  ]);
  assert.equal(parseChangePage({ LawSearch: { totalCnt: "1", law: known } }).rows.length, 1);
  assert.deepEqual(parseChangePage({ LawSearch: { totalCnt: "0" } }).rows, []);
  assert.throws(() => parseChangePage({ Response: { result: "사용자 정보 검증 실패" } }));
  assert.throws(() => parseChangePage({ LawSearch: { totalCnt: "1" } }));
});
