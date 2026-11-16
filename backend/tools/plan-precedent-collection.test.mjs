import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import {
  precedentSearchOptions,
  parsePrecedentSearchPage,
  fetchPrecedentSearchPage,
  planPrecedentCollection,
  writePrecedentQueue,
} from './plan-precedent-collection.mjs';
import {
  resumePrecedentCollection,
  validatePrecedentQueue,
} from './resume-precedent-collection.mjs';
const options = { query: '보증금', search: 'title' };
const row = (id) => ({
  판례일련번호: String(id),
  사건번호: '2026다' + id,
  선고일자: '2026.01.01',
});
const page = (total, number, rows) => ({
  PrecSearch: { totalCnt: String(total), page: String(number), prec: rows },
});
const hundred = () => Array.from({ length: 100 }, (_, i) => row(i + 1));
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'aurore-prec-search-'));
  try {
    await run(directory);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}
test('collects every page, normalizes singleton rows and deduplicates source IDs', async () => {
  const calls = [];
  const result = await planPrecedentCollection(
    options,
    async (parameters, number) => {
      calls.push(number);
      assert.deepEqual(parameters, options);
      return number === 1
        ? page(102, 1, hundred())
        : page(102, 2, [row(100), row(101)]);
    },
  );
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.total, 102);
  assert.equal(result.duplicates, 1);
  assert.equal(validatePrecedentQueue(result.items).length, 101);
  assert.deepEqual(parsePrecedentSearchPage(page(101, 2, row(101)), 2).rows, [
    { ID: '101', caseNumber: '2026다101', date: '20260101' },
  ]);
});
test('rejects broad, changing, repeated, short, mismatched or conflicting pages', async () => {
  await assert.rejects(
    planPrecedentCollection(options, async () => page(1001, 1, [])),
    /SEARCH_TOO_BROAD/,
  );
  await assert.rejects(
    planPrecedentCollection(options, async (_, n) =>
      page(n === 1 ? 101 : 102, n, n === 1 ? hundred() : [row(101), row(102)]),
    ),
    /SEARCH_TOTAL_CHANGED/,
  );
  await assert.rejects(
    planPrecedentCollection(options, async (_, n) => page(200, n, hundred())),
    /SEARCH_PAGE_REPEATED/,
  );
  await assert.rejects(
    planPrecedentCollection(options, async () => page(2, 1, [row(1)])),
    /SEARCH_RESPONSE_INVALID/,
  );
  await assert.rejects(
    planPrecedentCollection(options, async () => page(1, 2, row(1))),
    /SEARCH_PAGE_CHANGED/,
  );
  await assert.rejects(
    planPrecedentCollection(options, async (_, n) =>
      page(101, n, n === 1 ? hundred() : { ...row(1), 사건번호: 'DIFFERENT' }),
    ),
    /SEARCH_ID_CONFLICT/,
  );
  await assert.rejects(
    planPrecedentCollection(
      { ...options, from: '20250101', to: '20251231' },
      async () => page(1, 1, row(1)),
    ),
    /SEARCH_RANGE_CHANGED/,
  );
  assert.throws(
    () =>
      parsePrecedentSearchPage(
        page(1, 1, { ...row(1), 선고일자: '2026.02.30' }),
        1,
      ),
    /SEARCH_RESPONSE_INVALID/,
  );
  assert.throws(
    () =>
      parsePrecedentSearchPage(
        page(1, 1, { ...row(1), 판례일련번호: '../escape' }),
        1,
      ),
    /SEARCH_RESPONSE_INVALID/,
  );
});
test('requires a bounded search intent and validates dates and search scope', () => {
  for (const value of [
    {},
    { query: ' ' },
    { query: 'x', search: 'anything' },
    { query: 'x', from: '20260101' },
    { from: '20260230', to: '20260301' },
    { from: '20260102', to: '20260101' },
    { query: 'a\nb' },
  ])
    assert.throws(
      () => precedentSearchOptions(value),
      /SEARCH_OPTIONS_INVALID/,
    );
  assert.deepEqual(
    precedentSearchOptions({ query: ' 보증금 ', search: 'body' }),
    { query: '보증금', search: 'body' },
  );
  assert.deepEqual(
    precedentSearchOptions({ from: '20260101', to: '20260101' }),
    { query: '', search: 'title', from: '20260101', to: '20260101' },
  );
});
test('uses official parameters and suppresses network, parsing and credential reflection diagnostics', async () => {
  const oc = 'synthetic-secret-key';
  const params = {
    query: '보증금 반환',
    search: 'body',
    from: '20260101',
    to: '20260131',
  };
  const expected = page(1, 1, row(1));
  const result = await fetchPrecedentSearchPage(
    params,
    1,
    oc,
    async (url, init) => {
      assert.equal(url.origin, 'https://www.law.go.kr');
      assert.equal(url.pathname, '/DRF/lawSearch.do');
      assert.equal(url.searchParams.get('query'), params.query);
      assert.equal(url.searchParams.get('search'), '2');
      assert.equal(url.searchParams.get('prncYd'), '20260101~20260131');
      assert.equal(url.searchParams.get('display'), '100');
      assert.equal(init.redirect, 'error');
      return new Response(JSON.stringify(expected), {
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      });
    },
  );
  assert.deepEqual(result, expected);
  const linked = await fetchPrecedentSearchPage(
    params,
    1,
    oc,
    async () =>
      new Response(
        JSON.stringify(
          page(1, 1, {
            ...row(1),
            판례상세링크: 'https://www.law.go.kr/DRF/lawService.do?OC=' + oc,
          }),
        ),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  assert.deepEqual(linked, expected);
  assert.ok(!JSON.stringify(linked).includes(oc));
  for (const fake of [
    async () => {
      throw new Error('SECRET_URL_WITH_OC');
    },
    async () => new Response('<html>PRIVATE</html>'),
    async () =>
      new Response('PRIVATE_INVALID_JSON', {
        headers: { 'Content-Type': 'application/json' },
      }),
    async () =>
      new Response(JSON.stringify(page(1, 1, { ...row(1), 사건번호: oc })), {
        headers: { 'Content-Type': 'application/json' },
      }),
    async () =>
      new Response(
        JSON.stringify(
          page(1, 1, { ...row(1), 사건번호: '?OC=%73ynthetic-secret-key' }),
        ),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  ])
    await assert.rejects(
      fetchPrecedentSearchPage(params, 1, oc, fake),
      (error) =>
        error.message === 'SEARCH_READ_FAILED' &&
        !error.message.includes('PRIVATE') &&
        !error.message.includes(oc),
    );
});
test('writes a complete queue atomically, preserves existing output and writes nothing for empty or failed searches', async () =>
  fixture(async (directory) => {
    const destination = join(directory, 'input.json');
    const empty = await writePrecedentQueue(destination, options, async () =>
      page(0, 1, []),
    );
    assert.equal(empty.saved, false);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    await assert.rejects(
      writePrecedentQueue(destination, options, async (_, n) => {
        if (n === 2) throw new Error('SECRET');
        return page(101, n, hundred());
      }),
      /SEARCH_READ_FAILED/,
    );
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    const ready = await writePrecedentQueue(destination, options, async () =>
      page(1, 1, row(1)),
    );
    assert.equal(ready.saved, true);
    const original = await readFile(destination, 'utf8');
    assert.deepEqual(JSON.parse(original), [
      { ID: '1', caseNumber: '2026다1' },
    ]);
    await assert.rejects(
      writePrecedentQueue(destination, options, async () => {
        assert.fail('must not query again');
      }),
      /QUEUE_OUTPUT_EXISTS/,
    );
    assert.equal(await readFile(destination, 'utf8'), original);
  }));
test('competing plans cannot overwrite each other', async () =>
  fixture(async (directory) => {
    const destination = join(directory, 'input.json');
    let entered = 0,
      release;
    const gate = new Promise((done) => {
      release = done;
    });
    const fetchPage = async () => {
      entered++;
      if (entered === 2) release();
      await gate;
      return page(1, 1, row(1));
    };
    const results = await Promise.allSettled([
      writePrecedentQueue(destination, options, fetchPage),
      writePrecedentQueue(destination, options, fetchPage),
    ]);
    assert.equal(
      results.filter((item) => item.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      results.filter(
        (item) =>
          item.status === 'rejected' &&
          item.reason.code === 'QUEUE_OUTPUT_EXISTS',
      ).length,
      1,
    );
    validatePrecedentQueue(JSON.parse(await readFile(destination, 'utf8')));
  }));
test('generated queues feed the existing resumable source collector without DB publication', async () =>
  fixture(async (directory) => {
    const input = join(directory, 'input.json');
    await writePrecedentQueue(input, options, async () =>
      page(2, 1, [row(1), row(2)]),
    );
    const queue = JSON.parse(await readFile(input, 'utf8'));
    const calls = [];
    const readSource = async (item) => {
      calls.push(item.ID);
      return {
        bytes: Buffer.from(
          JSON.stringify({
            PrecService: {
              判: 'synthetic',
              판례정보일련번호: item.ID,
              사건번호: item.caseNumber,
              사건명: '가상 판례',
              법원명: '대법원',
              선고일자: '20260101',
              판례내용: '가상 원문',
            },
          }),
        ),
      };
    };
    const journal = join(directory, 'collection');
    assert.equal(
      (
        await resumePrecedentCollection(journal, {
          queue,
          limit: 1,
          readSource,
        })
      ).completed,
      1,
    );
    await assert.rejects(
      resumePrecedentCollection(journal, {
        readSource: async () => {
          throw new Error('SECRET');
        },
      }),
      /SOURCE_READ_FAILED/,
    );
    assert.equal(
      (await resumePrecedentCollection(journal, { readSource })).completed,
      2,
    );
    assert.deepEqual(calls, ['1', '2']);
  }));
