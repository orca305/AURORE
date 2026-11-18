import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePage, validateCatalogue, collectBatch } from './collect-current-laws.mjs';
import { identifySample } from './capture-law-samples.mjs';

const row = index => ({ 법령명한글: `시험법 ${index}`, 법령ID: String(index), 법령일련번호: String(index + 100), 시행일자: '20260101' });
const catalogue = () => {
  const laws = parsePage({ LawSearch: { page: 1, totalCnt: 3, law: [row(1), row(2), row(3)] } }, 1).laws;
  return { scope: 'eflaw-current', total: laws.length, laws, hash: createHash('sha256').update(JSON.stringify(laws)).digest('hex') };
};
const result = { hash: 'a'.repeat(64), status: 'IMPORTED' };

test('catalogue rejects changing counts, truncated pages and duplicate identities', () => {
  const page = { LawSearch: { page: 1, totalCnt: 101, law: Array.from({ length: 100 }, (_, i) => row(i + 1)) } };
  assert.equal(parsePage(page, 1, 101).laws.length, 100);
  assert.throws(() => parsePage(page, 1, 102));
  assert.throws(() => parsePage(page, 2, 101));
  page.LawSearch.law.pop();
  assert.throws(() => parsePage(page, 1));
  const duplicate = catalogue();
  duplicate.laws[1] = duplicate.laws[0];
  duplicate.hash = createHash('sha256').update(JSON.stringify(duplicate.laws)).digest('hex');
  assert.throws(() => validateCatalogue(duplicate));
});

test('failed batch preserves successful receipts and resumes only unfinished work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aurore-collection-'));
  const plan = catalogue(), calls = [];
  await assert.rejects(collectBatch(plan, directory, 3, async law => {
    calls.push(law.lawId);
    if (law.lawId === '000002') throw new Error('API_UNAVAILABLE');
    return result;
  }));
  assert.deepEqual(calls, ['000001', '000002']);
  const resumed = [];
  const limited = await collectBatch(plan, directory, 1, async law => { resumed.push(law.lawId); return result; });
  assert.deepEqual(resumed, ['000002']);
  assert.equal(limited.completed, 2);
  assert.equal(limited.remaining, 1);
  assert.equal((await collectBatch(plan, directory, 1, async () => result)).completed, 3);
  assert.equal((await collectBatch(plan, directory, 1, async () => { throw new Error('MUST_NOT_RUN'); })).processed, 0);
});

test('receipt corruption fails before a new import; batch bound is enforced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aurore-collection-'));
  const plan = catalogue();
  await collectBatch(plan, directory, 1, async () => result);
  const path = join(directory, '000001-101-20260101.json');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  receipt.catalogueHash = 'b'.repeat(64);
  await writeFile(path, JSON.stringify(receipt));
  await assert.rejects(collectBatch(plan, directory, 1, async () => { throw new Error('MUST_NOT_RUN'); }), /RECEIPT_INVALID/);
  await assert.rejects(collectBatch(plan, directory, 101, async () => result), /BATCH_LIMIT_INVALID/);
});

test('official single article response is accepted without loosening identity checks', () => {
  const sample = { target: 'eflaw', lawId: '000001', MST: '123', efYd: '20260101' };
  const payload = { 법령: { 기본정보: { 법령ID: '000001', 시행일자: '20260101', 법령명_한글: '시험법' }, 조문: { 조문단위: { 조문내용: '제1조 본문' } } } };
  assert.equal(identifySample(sample, payload).articleUnits, 1);
  assert.throws(() => identifySample({ ...sample, lawId: '000002' }, payload));
  payload.법령.조문.조문단위.조문내용 = '';
  assert.throws(() => identifySample(sample, payload));
});
