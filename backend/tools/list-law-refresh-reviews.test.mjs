import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { listLawRefreshReviews } from "./list-law-refresh-reviews.mjs";
import { resumeLawRefresh } from "./resume-law-refresh.mjs";

test("lists unpublished work, ignores applied sources, and flags missing or stale artifacts", async (t) => {
  const parent = resolve(tmpdir());
  const journal = await mkdtemp(join(parent, "aurore-law-inbox-test-"));
  t.after(async () => {
    assert.equal(dirname(journal), parent);
    assert.match(basename(journal), /^aurore-law-inbox-test-/);
    await rm(journal, { recursive: true });
  });
  const directory = join(journal, "prepared");
  await mkdir(directory);
  await writeFile(join(directory, "manifest.json"), "{}");
  const base = { lawId: "001248", effectiveDate: "20230711" };
  const editions = ["new", "applied", "missing", "changed"].map((versionKey, index) =>
    ({ ...base, versionKey, hash: String(index + 1).repeat(64) }));
  for (const edition of editions.filter(item => item.versionKey !== "missing")) {
    await writeFile(join(directory, edition.hash + ".json"), "{}");
  }
  const beforeHash = "a".repeat(64);
  const afterHash = "b".repeat(64);
  const correctionDir = join(journal, "correction");
  await mkdir(correctionDir);
  const reportPath = join(correctionDir, "review.json");
  await writeFile(reportPath, JSON.stringify({ beforeHash, afterHash }));
  await writeFile(join(correctionDir, beforeHash + ".json"), "{}");
  await writeFile(join(correctionDir, afterHash + ".json"), "{}");

  await resumeLawRefresh(journal, { from: "20261108", through: "20261109", runDay: async date => ({
    date, candidates: [], prepared: { directory, editions },
    corrections: [{ ...base, effectiveDate: "2023-07-11", versionKey: "correction", reportPath }],
  }) });
  const db = { query: async (_sql, params) => {
    const key = params[1];
    const row = {
      edition_id: key === "new" || key === "missing" ? null : "1",
      applied: key === "applied",
      current_hash: key === "correction" ? "c".repeat(64) : null,
    };
    return { rows: [row] };
  } };
  const { lastCompletedDate, pending } = await listLawRefreshReviews(db, journal);
  assert.equal(lastCompletedDate, "20261109");
  assert.deepEqual(pending.map(item => [item.versionKey, item.status]), [
    ["new", "ready-to-apply"], ["missing", "artifacts-missing"],
    ["changed", "edition-changed"], ["correction", "stale-review"],
  ]);
  assert(pending.every(item => item.date === "20261109"));
});
