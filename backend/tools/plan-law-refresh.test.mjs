import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChangeDates, parseChangePage, planCandidates, planChangeDates } from "./plan-law-refresh.mjs";

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

test("recovers inclusive date ranges and deduplicates editions before preparing", async () => {
  const dates = parseChangeDates("20240228..20240301");
  assert.deepEqual(dates, ["20240228", "20240229", "20240301"]);
  assert.throws(() => parseChangeDates("20230229"), /Invalid/);
  assert.throws(() => parseChangeDates("20240301..20240228"), /1 to 7/);
  assert.throws(() => parseChangeDates("20240301..20240308"), /1 to 7/);
  const first = { lawId: "001248", mst: "100", effectiveDate: "20240501" };
  const second = { ...first, effectiveDate: "20240502" };
  const watched = new Set([first.lawId]);
  const stored = new Set(["001248:100:20240501"]);
  const result = await planChangeDates(dates, watched, stored, async date => ({
    pages: 1, rows: date === "20240228" ? [first] : [first, second],
  }));
  assert.deepEqual(result.days.map(day => day.date), dates);
  assert.equal(result.changes, 5);
  assert.deepEqual(result.candidates.map(row => [row.effectiveDate, row.action]), [
    ["20240501", "recheck"], ["20240502", "fetch"],
  ]);
  const called = [];
  await assert.rejects(planChangeDates(dates, watched, stored, async date => {
    called.push(date);
    if (date === "20240229") throw new Error("test response failure");
    return { pages: 1, rows: [] };
  }), /20240229/);
  assert.deepEqual(called, dates.slice(0, 2));
});
