import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { identifySample, storeSnapshot } from "./capture-law-samples.mjs";

test("a repeated response is deduplicated and a changed response preserves both originals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aurore-snapshot-"));
  try {
    const first = Buffer.from('{ "body": "original" }\n');
    const changed = Buffer.from('{ "body": "changed" }\n');
    const repeated = await Promise.all([
      storeSnapshot(directory, first),
      storeSnapshot(directory, first),
    ]);
    assert.deepEqual(repeated.map((result) => result.status).sort(), ["duplicate", "saved"]);
    assert.equal(repeated[0].hash, repeated[1].hash);
    const next = await storeSnapshot(directory, changed);
    assert.equal(next.status, "saved");
    assert.notEqual(next.hash, repeated[0].hash);
    assert.deepEqual(await readFile(join(directory, `${repeated[0].hash}.json`)), first);
    assert.deepEqual(await readFile(join(directory, `${next.hash}.json`)), changed);
    assert.equal((await readdir(directory)).length, 2);
  } finally {
    for (const file of await readdir(directory)) await unlink(join(directory, file));
    await rmdir(directory);
  }
});

test("an API error body or mismatched edition is rejected as a law sample", () => {
  const sample = { target: "eflaw", lawId: "001248", efYd: "20260102" };
  const wrongEdition = {
    법령: {
      기본정보: { 법령ID: "001248", 시행일자: "20230719", 법령명_한글: "테스트 법령" },
      조문: { 조문단위: [{ 조문내용: "테스트 본문" }] },
    },
  };
  for (const payload of [{ Response: { result: "검증 오류" } }, wrongEdition]) {
    assert.throws(() => identifySample(sample, payload), /effective date/);
  }
});
