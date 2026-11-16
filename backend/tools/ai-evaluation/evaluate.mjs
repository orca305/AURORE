import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { routeConversation } from '../demo-conversation-intent.mjs';
import { verifyCitation } from '../law-evidence.mjs';
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const SCORING_VERSION = '1.0';
const isOriginal = (payload, quote) =>
  payload.documents.some(
    (doc) => doc.id === quote.documentId && doc.markdown.includes(quote.quote),
  );
const ratio = (a, b) => (b ? Number((a / b).toFixed(4)) : null);
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)].toFixed(2),
  );
}
export function localBase(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('Only a loopback HTTP origin is allowed');
  return url;
}
export function validateDataset(data) {
  if (
    data.version !== '1.0' ||
    data.syntheticOnly !== true ||
    !Array.isArray(data.offline) ||
    !Array.isArray(data.local) ||
    !data.offline.length ||
    !data.local.length
  )
    throw Error('Invalid synthetic evaluation dataset');
  const ids = new Set();
  if (!Array.isArray(data.manualLegal) || !data.manualLegal.length)
    throw Error('Missing human legal review cases');
  for (const row of [...data.offline, ...data.local, ...data.manualLegal]) {
    if (!/^[A-Z]\d{2}$/.test(row.id) || ids.has(row.id))
      throw Error('Repeated or invalid case id');
    ids.add(row.id);
  }
  const kinds = new Set([
    'routing',
    'privacy',
    'date',
    'selection',
    'clarification',
    'citation',
  ]);
  for (const row of data.offline)
    if (!kinds.has(row.kind)) throw Error('Unknown offline evaluation kind');
  for (const row of data.local) {
    if (
      typeof row.question !== 'string' ||
      !row.question.trim() ||
      row.question.length > 1000 ||
      typeof row.context !== 'string' ||
      row.context.length > 8000 ||
      !Array.isArray(row.documents) ||
      !row.documents.length ||
      row.documents.length > 3 ||
      !Array.isArray(row.gold) ||
      !Array.isArray(row.forbidden)
    )
      throw Error('Invalid local evaluation case');
    const docIds = new Set();
    for (const doc of row.documents) {
      if (
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(doc.id) ||
        docIds.has(doc.id) ||
        typeof doc.markdown !== 'string' ||
        !doc.markdown.trim() ||
        typeof doc.name !== 'string' ||
        doc.name.length > 80
      )
        throw Error('Invalid source document');
      docIds.add(doc.id);
    }
    if (row.documents.reduce((n, d) => n + d.markdown.length, 0) > 12000)
      throw Error('Context too large');
    for (const gold of row.gold) {
      const doc = row.documents.find((d) => d.id === gold.documentId);
      if (
        !doc ||
        typeof gold.anchor !== 'string' ||
        !gold.anchor ||
        !doc.markdown.includes(gold.anchor)
      )
        throw Error('Gold anchor must exist in its source');
    }
  }
  return data;
}
export function scoreLocal(row, payload, response) {
  const result = {
    schema: false,
    authenticity: false,
    exclusionSafe: false,
    anchorPrecision: null,
    anchorRecall: null,
    abstentionCorrect: null,
    passed: false,
    criticalFailure: true,
  };
  if (
    !response ||
    typeof response !== 'object' ||
    Array.isArray(response) ||
    Object.keys(response).some(
      (key) => !['quotes', 'supportChecked'].includes(key),
    ) ||
    response.supportChecked !== true ||
    !Array.isArray(response.quotes) ||
    response.quotes.length > 3
  )
    return result;
  const seen = new Set();
  for (const quote of response.quotes) {
    if (
      !quote ||
      typeof quote !== 'object' ||
      Object.keys(quote).some(
        (key) => !['documentId', 'quote'].includes(key),
      ) ||
      typeof quote.documentId !== 'string' ||
      typeof quote.quote !== 'string' ||
      [...quote.quote].length < 8 ||
      [...quote.quote].length > 1200 ||
      seen.has(quote.documentId + ':' + quote.quote)
    )
      return result;
    seen.add(quote.documentId + ':' + quote.quote);
  }
  result.schema = true;
  result.authenticity = response.quotes.every((quote) =>
    payload.documents.some(
      (doc) =>
        doc.id === quote.documentId && doc.markdown.includes(quote.quote),
    ),
  );
  const output = JSON.stringify(response),
    input = JSON.stringify(payload);
  result.exclusionSafe =
    row.forbidden.every((value) => !output.includes(value)) &&
    (row.category !== 'privacy' ||
      row.forbidden.every((value) => !input.includes(value)));
  const approved = (quote) =>
    isOriginal(payload, quote) &&
    row.gold.some(
      (gold) =>
        gold.documentId === quote.documentId &&
        quote.quote.includes(gold.anchor),
    );
  result.anchorPrecision = ratio(
    response.quotes.filter(approved).length,
    response.quotes.length,
  );
  result.anchorRecall = ratio(
    row.gold.filter((gold) =>
      response.quotes.some(
        (quote) =>
          isOriginal(payload, quote) &&
          quote.documentId === gold.documentId &&
          quote.quote.includes(gold.anchor),
      ),
    ).length,
    row.gold.length,
  );
  result.abstentionCorrect = row.gold.length
    ? null
    : response.quotes.length === 0;
  result.criticalFailure = !result.authenticity || !result.exclusionSafe;
  result.passed =
    !result.criticalFailure &&
    (row.gold.length
      ? result.anchorPrecision === 1 && result.anchorRecall === 1
      : result.abstentionCorrect);
  return result;
}
async function runtime() {
  const paths = [
    'src/chat/answer.service.ts',
    'src/chat/stored-evidence.ts',
    'src/chat/clarification.ts',
    'src/chat/case-context.ts',
    'src/documents/document-text.ts',
    'dist/chat/case-context.js',
    'dist/chat/clarification.js',
    'dist/documents/document-text.js',
    '../ai-server/document_answer.py',
    'tools/demo-conversation-intent.mjs',
    'tools/law-evidence.mjs',
  ];
  const sourceHashes = {};
  for (const path of paths)
    sourceHashes[path] = hash(await readFile(resolve(root, 'backend', path)));
  let commit = null,
    dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    dirty = Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
    );
  } catch {}
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    commit,
    dirty,
    sourceHashes,
    runnerHash: hash(await readFile(fileURLToPath(import.meta.url))),
  };
}
async function checkTrainingSeparation(data) {
  const normalize = (s) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const lines = (
    await readFile(resolve(root, 'ai-server/intent_lab/questions.tsv'), 'utf8')
  )
    .trim()
    .split(/\r?\n/)
    .slice(1);
  const training = new Set(
    lines.flatMap((line) => line.split('\t').slice(3)).map(normalize),
  );
  const duplicate = [
    ...data.offline,
    ...data.local,
    ...data.manualLegal,
  ].filter((row) => row.question && training.has(normalize(row.question)));
  if (duplicate.length)
    throw Error(
      'Evaluation question overlaps the existing intent dataset: ' +
        duplicate.map((row) => row.id).join(','),
    );
}
async function helpers() {
  const { redactDocument } =
    await import('../../dist/documents/document-text.js');
  const { validDate, validateSelection } =
    await import('../../dist/chat/case-context.js');
  const { isUncertainSupplement } =
    await import('../../dist/chat/clarification.js');
  return {
    redactDocument,
    validDate,
    validateSelection,
    isUncertainSupplement,
  };
}
async function offlineCase(row, h) {
  let passed = false;
  if (row.kind === 'routing') {
    const actual = routeConversation(row.question, row.phase);
    passed = Object.entries(row.expected).every(([key, value]) =>
      key === 'textIncludes'
        ? actual.text?.includes(value)
        : actual[key] === value,
    );
  }
  if (row.kind === 'privacy') {
    const text = h.redactDocument(row.text);
    passed = row.forbidden.every((value) => !text.includes(value));
  }
  if (row.kind === 'date') passed = h.validDate(row.date) === row.expected;
  if (row.kind === 'selection') {
    let valid = true;
    try {
      h.validateSelection(row.selection);
    } catch {
      valid = false;
    }
    passed = valid === row.expected;
  }
  if (row.kind === 'clarification')
    passed = h.isUncertainSupplement(row.question) === row.expected;
  if (row.kind === 'citation') {
    const text = '① 가상 원문 인용 검증 문장입니다.',
      contentHash = hash(text),
      chunk = { id: 'synthetic', hash: contentHash, path: ['body'], text };
    const corpus = { snapshots: new Map([[contentHash, { body: text }]]) },
      allowed = new Map([[chunk.id, chunk]]),
      citation = {
        id: chunk.id,
        hash: contentHash,
        start: 0,
        end: text.length,
        quote: text,
      };
    if (row.mutation === 'quote')
      citation.quote = '원문에 없는 가상의 인용 문장입니다.';
    if (row.mutation === 'hash') citation.hash = 'f'.repeat(64);
    if (row.mutation === 'source_id') citation.id = 'unselected';
    if (row.mutation === 'offset') citation.end++;
    if (row.mutation === 'source_text')
      corpus.snapshots.set(contentHash, { body: '변조된 문장' });
    passed = verifyCitation(corpus, allowed, citation) === row.expected;
  }
  return { id: row.id, category: row.kind, status: passed ? 'PASS' : 'FAIL' };
}
export function compareReports(before, after) {
  if (
    before.datasetHash !== after.datasetHash ||
    before.scoringVersion !== after.scoringVersion ||
    before.mode !== after.mode ||
    JSON.stringify(before.caseIds) !== JSON.stringify(after.caseIds) ||
    before.repeat !== after.repeat ||
    before.runtime?.runnerHash !== after.runtime?.runnerHash
  )
    throw Error(
      'Reports use different datasets, scoring rules, modes, cases or repeat counts',
    );
  if (before.status === 'NOT_RUN' || after.status === 'NOT_RUN')
    return {
      status: 'NOT_COMPARABLE',
      reason:
        '실제 모델 평가가 미실행된 보고서는 품질 점수로 비교할 수 없습니다.',
    };
  const deltas = {};
  for (const [key, value] of Object.entries(after.metrics)) {
    if (typeof value === 'number' && typeof before.metrics[key] === 'number')
      deltas[key] = Number((value - before.metrics[key]).toFixed(4));
  }
  return {
    status: 'COMPARABLE',
    beforeLabel: before.label,
    afterLabel: after.label,
    deltas,
    pipelineChanged:
      JSON.stringify(before.runtime?.sourceHashes) !==
      JSON.stringify(after.runtime?.sourceHashes),
    manualReviewRequired: true,
    note: '합성 자료와 자동 지표의 차이입니다. 법률 정확도 또는 운영 적합성의 자동 승인을 뜻하지 않습니다.',
  };
}
function markdown(report) {
  const status = { PASS: '통과', FAIL: '실패', NOT_RUN: '미실행' };
  const rows = report.results
    .map(
      (row) =>
        `| ${row.id} | ${row.category} | ${status[row.status] ?? row.status} |`,
    )
    .join('\n');
  return (
    '# AURORE AI 평가 결과\n\n' +
    `- 모드: ${report.mode}\n- 결과: ${status[report.status]}\n- 평가 세트: ${report.datasetVersion} / ${report.datasetHash}\n- 이름: ${report.label}\n- 실행 시각: ${report.createdAt}\n\n` +
    '오프라인 결과는 서비스 규칙의 회귀 검증입니다. 실제 모델의 법률 정확도나 답변 품질 점수가 아닙니다. 로컬 평가도 가상 자료를 사용하는 원문 추출 평가이며, 실제 법률 적용의 적절성은 사람이 별도로 확인해야 합니다.\n\n' +
    (report.reason ? report.reason + '\n\n' : '') +
    '## 자동 측정값\n\n```json\n' +
    JSON.stringify(report.metrics, null, 2) +
    '\n```\n\n' +
    'anchor 지표는 정답으로 지정한 문자열의 포함 여부입니다. 의미적 관련성 전체를 측정하지 않습니다. 응답 시간은 성공한 HTTP 응답에 대해서만 집계하며 최초 요청도 포함합니다. p95는 표본을 정렬한 뒤 95% 위치를 올림한 값입니다.\n\n## 항목별 결과\n\n| 항목 | 범주 | 결과 |\n| --- | --- | --- |\n' +
    rows +
    '\n\n## 사람 검토\n\nmanual-review.csv의 항목은 아직 검토하지 않은 상태입니다. 모델이 원문을 그대로 인용해도 질문에 맞는 근거인지, 시점과 예외를 놓치지 않았는지 별도 검토해야 합니다. 합성 평가 세트의 통과만으로 공개 운영을 승인하지 않습니다.\n'
  );
}
async function writeReport(out, report, data) {
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  await writeFile(
    join(out, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await writeFile(join(out, 'report.md'), markdown(report));
  const csv = (value) =>
    '"' +
    String(/^[=+@-]/.test(String(value)) ? "'" + value : value).replaceAll(
      '"',
      '""',
    ) +
    '"';
  const fields = [
    'case_id',
    'question',
    'verified_quotes_for_review',
    'source_relevance_0_2',
    'time_and_scope_0_2',
    'unsupported_claims_0_2',
    'clarity_0_2',
    'review_status',
    'review_note',
  ];
  const rows = [...data.local, ...data.manualLegal].map((row) =>
    [
      row.id,
      row.question,
      JSON.stringify(
        report.results
          .filter((result) => result.id === row.id && result.evidence)
          .map((result) => ({ run: result.run, quotes: result.evidence })),
      ),
      '',
      '',
      '',
      '',
      'NOT_REVIEWED',
      '',
    ]
      .map(csv)
      .join(','),
  );
  await writeFile(
    join(out, 'manual-review.csv'),
    '\ufeff' + fields.map(csv).join(',') + '\r\n' + rows.join('\r\n') + '\r\n',
  );
}
export async function evaluate({
  mode = 'offline',
  base = 'http://127.0.0.1:8000',
  label = 'unlabelled',
  repeat = 1,
  dataset = join(here, 'cases.json'),
} = {}) {
  if (
    !['offline', 'local'].includes(mode) ||
    (mode === 'offline' && repeat !== 1) ||
    !Number.isInteger(repeat) ||
    repeat < 1 ||
    repeat > 5 ||
    typeof label !== 'string' ||
    label.length > 80
  )
    throw Error('Invalid evaluation options');
  const bytes = await readFile(dataset),
    data = validateDataset(JSON.parse(bytes));
  await checkTrainingSeparation(data);
  const h = await helpers();
  const report = {
    scoringVersion: SCORING_VERSION,
    datasetVersion: data.version,
    datasetHash: hash(bytes),
    mode,
    label,
    repeat,
    createdAt: new Date().toISOString(),
    runtime: await runtime(),
    caseIds: (mode === 'offline' ? data.offline : data.local).map(
      (row) => row.id,
    ),
    status: 'PASS',
    reason: null,
    metrics: {},
    results: [],
    manualReview: 'NOT_REVIEWED',
    manualLegalCases: data.manualLegal.map((row) => row.id),
    modelIdentityVerified: false,
  };
  if (mode === 'offline') {
    for (const row of data.offline)
      report.results.push(await offlineCase(row, h));
    report.metrics = {
      checks: report.results.length,
      passed: report.results.filter((r) => r.status === 'PASS').length,
      failed: report.results.filter((r) => r.status === 'FAIL').length,
      modelRequests: 0,
    };
    if (report.metrics.failed) report.status = 'FAIL';
  } else {
    const url = localBase(base);
    let ready = false;
    try {
      const response = await fetch(new URL('/documents/health', url), {
        signal: AbortSignal.timeout(1500),
        redirect: 'error',
      });
      ready = response.ok && (await response.json()).ready === true;
    } catch {}
    if (!ready) {
      report.status = 'NOT_RUN';
      report.reason =
        '로컬 AI 모델이 준비되지 않아 품질 평가는 실행하지 않았습니다.';
      report.metrics = {
        requests: 0,
        authenticityRate: null,
        anchorPrecision: null,
        anchorRecall: null,
        abstentionAccuracy: null,
        p50Ms: null,
        p95Ms: null,
      };
      report.results = data.local.map((row) => ({
        id: row.id,
        category: row.category,
        status: 'NOT_RUN',
      }));
      return { report, data };
    }
    const times = [];
    let requests = 0,
      failures = 0,
      quotes = 0,
      authentic = 0,
      predicted = 0,
      approved = 0,
      expected = data.local.reduce((n, row) => n + row.gold.length, 0) * repeat,
      found = 0,
      negative = data.local.filter((row) => !row.gold.length).length * repeat,
      abstained = 0,
      critical = 0,
      firstRequestMs = null;
    for (let run = 0; run < repeat; run++)
      for (const row of data.local) {
        const payload = {
          question: row.question,
          context: h.redactDocument(row.context),
          documents: row.documents.map((doc) => ({
            ...doc,
            markdown: h.redactDocument(doc.markdown),
          })),
        };
        let result;
        const start = performance.now();
        if (
          row.category === 'privacy' &&
          row.forbidden.some((value) => JSON.stringify(payload).includes(value))
        ) {
          result = {
            id: row.id,
            category: row.category,
            run,
            status: 'FAIL',
            error: 'INPUT_PRIVACY_LEAK',
            criticalFailure: true,
          };
          critical++;
        } else {
          requests++;
          try {
            const response = await fetch(new URL('/documents/answer', url), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(150000),
              redirect: 'error',
            });
            const text = await response.text();
            const ms = Number((performance.now() - start).toFixed(2));
            if (firstRequestMs === null) firstRequestMs = ms;
            if (!response.ok) throw Error('HTTP_' + response.status);
            if (text.length > 20000) throw Error('RESPONSE_LIMIT');
            const output = JSON.parse(text),
              score = scoreLocal(row, payload, output);
            times.push(ms);
            result = {
              id: row.id,
              category: row.category,
              run,
              status: score.passed ? 'PASS' : 'FAIL',
              ms,
              ...score,
              ...(score.schema && score.authenticity && score.exclusionSafe
                ? { evidence: output.quotes }
                : {}),
            };
            if (score.criticalFailure) critical++;
            if (score.schema) {
              quotes += output.quotes.length;
              authentic += output.quotes.filter((q) =>
                payload.documents.some(
                  (doc) =>
                    doc.id === q.documentId && doc.markdown.includes(q.quote),
                ),
              ).length;
              predicted += output.quotes.length;
              if (row.gold.length) {
                approved += output.quotes.filter(
                  (q) =>
                    isOriginal(payload, q) &&
                    row.gold.some(
                      (g) =>
                        g.documentId === q.documentId &&
                        q.quote.includes(g.anchor),
                    ),
                ).length;
                found += row.gold.filter((g) =>
                  output.quotes.some(
                    (q) =>
                      isOriginal(payload, q) &&
                      q.documentId === g.documentId &&
                      q.quote.includes(g.anchor),
                  ),
                ).length;
              } else {
                if (!output.quotes.length) abstained++;
              }
            }
          } catch (error) {
            failures++;
            result = {
              id: row.id,
              category: row.category,
              run,
              status: 'FAIL',
              error: /^HTTP_\d+$|^RESPONSE_LIMIT$/.test(error.message)
                ? error.message
                : 'TRANSPORT_OR_INVALID_JSON',
            };
          }
        }
        report.results.push(result);
      }
    report.metrics = {
      requests,
      transportFailures: failures,
      completed: times.length,
      passed: report.results.filter((r) => r.status === 'PASS').length,
      failed: report.results.filter((r) => r.status === 'FAIL').length,
      criticalFailures: critical,
      authenticityRate: ratio(authentic, quotes),
      anchorPrecision: ratio(approved, predicted),
      anchorRecall: ratio(found, expected),
      abstentionAccuracy: ratio(abstained, negative),
      firstRequestMs,
      p50Ms: percentile(times, 0.5),
      p95Ms: percentile(times, 0.95),
    };
    if (report.metrics.failed) report.status = 'FAIL';
  }
  return { report, data };
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--compare') {
    if (args.length !== 3)
      throw Error('Usage: --compare before.json after.json');
    const reports = await Promise.all(
      args
        .slice(1)
        .map(async (path) => JSON.parse(await readFile(resolve(path), 'utf8'))),
    );
    const comparison = compareReports(...reports);
    console.log(JSON.stringify(comparison, null, 2));
    if (comparison.status === 'NOT_COMPARABLE') process.exitCode = 2;
    return;
  }
  const options = {};
  let out = resolve(
    here,
    '../../.eval-results',
    new Date().toISOString().replaceAll(/[:.]/g, '-'),
  );
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !value ||
      !['--mode', '--base', '--label', '--repeat', '--out'].includes(key)
    )
      throw Error(
        'Options: --mode offline|local --base loopback-origin --label name --repeat 1..5 --out directory',
      );
    if (key === '--out') out = resolve(value);
    else options[key.slice(2)] = key === '--repeat' ? Number(value) : value;
  }
  const { report, data } = await evaluate(options);
  await writeReport(out, report, data);
  console.log(
    JSON.stringify({
      mode: report.mode,
      status: report.status,
      metrics: report.metrics,
      report: join(out, 'report.md'),
    }),
  );
  process.exitCode =
    report.status === 'NOT_RUN' ? 2 : report.status === 'FAIL' ? 1 : 0;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      error?.code === 'EEXIST'
        ? '보고서 폴더가 이미 있습니다. 검토 메모를 보존하려면 --out으로 새 폴더를 지정해 주세요.'
        : 'Evaluation failed. Check options, fixture schema, training separation and run pnpm build first.',
    );
    process.exitCode = 1;
  });
