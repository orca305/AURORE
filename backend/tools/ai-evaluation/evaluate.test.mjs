import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  evaluate,
  validateDataset,
  scoreLocal,
  localBase,
  compareReports,
  percentile,
} from './evaluate.mjs';
const data = JSON.parse(
  await readFile(new URL('./cases.json', import.meta.url), 'utf8'),
);
test('frozen synthetic dataset, source anchors and local-only destinations are validated', () => {
  assert.equal(validateDataset(data).local.length, 20);
  const duplicate = structuredClone(data);
  duplicate.local[1].id = duplicate.local[0].id;
  assert.throws(() => validateDataset(duplicate));
  const invented = structuredClone(data);
  invented.local[0].gold[0].anchor = '없는 문장';
  assert.throws(() => validateDataset(invented));
  for (const url of [
    'https://example.com',
    'http://192.168.0.1:8000',
    'http://user:pass@localhost:8000',
    'http://localhost:8000/private',
  ])
    assert.throws(() => localBase(url));
  assert.equal(localBase('http://127.0.0.1:8000').hostname, '127.0.0.1');
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
});
test('scoring rejects invented, wrong-source, duplicate and forbidden quotes, and does not reward empty answers', () => {
  const row = data.local[0],
    payload = { documents: row.documents };
  const quote = {
    documentId: row.documents[0].id,
    quote: row.documents[0].markdown,
  };
  assert.equal(
    scoreLocal(row, payload, { quotes: [quote], supportChecked: true }).passed,
    true,
  );
  for (const quotes of [
    [{ ...quote, quote: '없는 원문을 지어낸 문장입니다.' }],
    [
      {
        ...quote,
        documentId: data.local[0].documents[0].id.replace(/1$/, '9'),
      },
    ],
    [quote, quote],
  ])
    assert.equal(
      scoreLocal(row, payload, { quotes, supportChecked: true })
        .criticalFailure,
      true,
    );
  assert.equal(
    scoreLocal(row, payload, { quotes: [], supportChecked: true }).passed,
    false,
  );
  assert.equal(
    scoreLocal(row, payload, {
      quotes: [quote],
      supportChecked: true,
      answer: '임의 설명',
    }).schema,
    false,
  );
  const injected = data.local.find((row) => row.id === 'L09');
  assert.equal(
    scoreLocal(
      injected,
      { documents: injected.documents },
      {
        quotes: [
          {
            documentId: quote.documentId,
            quote: injected.documents[0].markdown,
          },
        ],
        supportChecked: true,
      },
    ).exclusionSafe,
    false,
  );
  const forged = scoreLocal(row, payload, {
    quotes: [
      { ...quote, quote: quote.quote + ' 가상의 허위 추가 문장입니다.' },
    ],
    supportChecked: true,
  });
  assert.equal(forged.anchorRecall, 0);
  assert.equal(forged.criticalFailure, true);
  const negative = data.local.find((row) => !row.gold.length);
  assert.equal(
    scoreLocal(
      negative,
      { documents: negative.documents },
      { quotes: [], supportChecked: true },
    ).passed,
    true,
  );
});
test('runner metrics include failed requests and negative-case false positives; fake endpoints only test the harness', async () => {
  let fault = 'perfect',
    requests = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/documents/health') {
      res.end(JSON.stringify({ ready: fault !== 'not-ready' }));
      return;
    }
    requests++;
    let text = '';
    for await (const part of req) text += part;
    const payload = JSON.parse(text),
      row = data.local.find((row) => row.question === payload.question);
    if (row.category === 'privacy')
      assert.ok(row.forbidden.every((value) => !text.includes(value)));
    if (fault === 'all-error') {
      res.statusCode = 503;
      res.end('{}');
      return;
    }
    let quotes = row.gold.map((gold) => {
      const doc = payload.documents.find((doc) => doc.id === gold.documentId);
      return {
        documentId: doc.id,
        quote: doc.markdown
          .split('\n')
          .find((line) => line.includes(gold.anchor)),
      };
    });
    if (fault === 'forged-positive' && row.gold.length)
      quotes = quotes.map((q) => ({
        ...q,
        quote: q.quote + ' 가상의 허위 추가 문장입니다.',
      }));
    if (fault === 'negative-quotes' && !row.gold.length)
      quotes = [
        {
          documentId: payload.documents[0].id,
          quote: payload.documents[0].markdown,
        },
      ];
    res.end(JSON.stringify({ quotes, supportChecked: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const { report: perfect } = await evaluate({
      mode: 'local',
      base,
      label: 'HARNESS_TEST_ONLY',
    });
    assert.equal(perfect.status, 'PASS');
    assert.equal(perfect.metrics.anchorRecall, 1);
    assert.equal(perfect.metrics.abstentionAccuracy, 1);
    assert.equal(perfect.metrics.requests, 20);
    fault = 'negative-quotes';
    const { report: negative } = await evaluate({
      mode: 'local',
      base,
      label: 'HARNESS_TEST_ONLY',
    });
    assert.equal(negative.status, 'FAIL');
    assert.equal(negative.metrics.anchorPrecision, 0.7);
    assert.equal(negative.metrics.abstentionAccuracy, 0);
    fault = 'forged-positive';
    const { report: forged } = await evaluate({
      mode: 'local',
      base,
      label: 'HARNESS_TEST_ONLY',
    });
    assert.equal(forged.metrics.anchorRecall, 0);
    assert.equal(forged.metrics.anchorPrecision, 0);
    assert.equal(forged.metrics.criticalFailures, 14);
    fault = 'all-error';
    const { report: errors } = await evaluate({
      mode: 'local',
      base,
      label: 'HARNESS_TEST_ONLY',
    });
    assert.equal(errors.metrics.transportFailures, 20);
    assert.equal(errors.metrics.anchorRecall, 0);
    assert.equal(errors.metrics.abstentionAccuracy, 0);
    assert.equal(errors.metrics.p95Ms, null);
    requests = 0;
    fault = 'not-ready';
    const { report: missing } = await evaluate({ mode: 'local', base });
    assert.equal(missing.status, 'NOT_RUN');
    assert.equal(missing.metrics.anchorRecall, null);
    assert.equal(requests, 0);
    assert.equal(compareReports(missing, missing).status, 'NOT_COMPARABLE');
    assert.equal(compareReports(perfect, perfect).deltas.anchorRecall, 0);
    assert.throws(() =>
      compareReports(perfect, { ...perfect, datasetHash: 'changed' }),
    );
    assert.throws(() =>
      compareReports(perfect, {
        ...perfect,
        runtime: { ...perfect.runtime, runnerHash: 'changed' },
      }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test('offline evaluation calls actual compiled guards without an AI request', async () => {
  const { report } = await evaluate();
  assert.equal(report.status, 'PASS');
  assert.equal(report.metrics.checks, 34);
  assert.equal(report.metrics.modelRequests, 0);
});
