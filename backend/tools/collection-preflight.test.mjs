import test from 'node:test';
import assert from 'node:assert/strict';
import { datasets, probeDataset } from './collection-preflight.mjs';

test('bounded list probes use correct scope and never expose reflected credentials', async () => {
  const oc = 'SYNTHETIC_SECRET';
  const roots = { eflaw: ['LawSearch','law','법령일련번호'], admrul: ['AdmRulSearch','admrul','행정규칙일련번호'], ordin: ['OrdinSearch','law','자치법규일련번호'], prec: ['PrecSearch','prec','판례일련번호'] };
  for (const dataset of datasets) {
    const result = await probeDataset(dataset, oc, async (url, options) => {
      assert.equal(url.origin, 'https://www.law.go.kr');
      assert.equal(url.searchParams.get('display'), '1');
      assert.equal(url.searchParams.get('nw'), dataset.nw ?? null);
      assert.equal(options.redirect, 'error');
      const [root, field, id] = roots[dataset.target];
      return Response.json({ [root]: { page: '1', totalCnt: '123', [field]: { [id]: '100', 상세링크: '?OC=' + oc } } });
    });
    assert.equal(result.status, 'LIST_OK');
    assert.equal(result.pagesAt100, 2);
    assert.ok(!JSON.stringify(result).includes(oc));
  }
  assert.equal((await probeDataset(datasets[0], '', () => { throw new Error('must not call'); })).status, 'OC_REQUIRED');
  for (const response of [Response.json({ error: oc }), new Response(oc), Response.json({ LawSearch: { page: 1, totalCnt: 1, law: {} } })]) {
    const result = await probeDataset(datasets[0], oc, async () => response);
    assert.notEqual(result.status, 'LIST_OK');
    assert.ok(!JSON.stringify(result).includes(oc));
  }
  assert.equal((await probeDataset(datasets[0], oc, async () => { throw new Error(oc); })).status, 'READ_OR_RESPONSE_ERROR');
  assert.equal((await probeDataset(datasets[0], oc, async () => Response.json({ LawSearch: { page: 1, totalCnt: 0 } }))).status, 'EMPTY_REQUIRES_REVIEW');
});
