import { setTimeout as delay } from 'node:timers/promises';

// nw values differ between national statutes and administrative/local rules.
export const datasets = [
  { id: 'law-current', target: 'eflaw', nw: '3' },
  { id: 'law-history', target: 'eflaw', nw: '1' },
  { id: 'law-upcoming', target: 'eflaw', nw: '2' },
  { id: 'admrul-current', target: 'admrul', nw: '1' },
  { id: 'admrul-history', target: 'admrul', nw: '2' },
  { id: 'ordin-current', target: 'ordin', nw: '1' },
  { id: 'ordin-history', target: 'ordin', nw: '2' },
  { id: 'precedent', target: 'prec' },
];

export async function probeDataset(dataset, oc, fetchImpl = fetch) {
  if (typeof oc !== 'string' || !oc.trim()) return { id: dataset.id, status: 'OC_REQUIRED' };
  const url = new URL('https://www.law.go.kr/DRF/lawSearch.do');
  url.search = new URLSearchParams({ OC: oc, target: dataset.target, type: 'JSON', display: '1', page: '1', ...(dataset.nw ? { nw: dataset.nw } : {}) });
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) { await response.body?.cancel(); return { id: dataset.id, status: 'HTTP_ERROR', httpStatus: response.status }; }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      await response.body?.cancel();
      return { id: dataset.id, status: 'JSON_NOT_RETURNED' };
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('limit');
      chunks.push(chunk);
    }
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    const rootName = { eflaw: 'LawSearch', admrul: 'AdmRulSearch', ordin: 'OrdinSearch', prec: 'PrecSearch' }[dataset.target];
    const root = payload?.[rootName];
    const count = String(root?.totalCnt ?? '');
    if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || String(root.page) !== '1') throw new Error('shape');
    const total = Number(count);
    const field = { eflaw: 'law', admrul: 'admrul', ordin: 'ordin', prec: 'prec' }[dataset.target];
    const rows = Array.isArray(root[field]) ? root[field] : root[field] ? [root[field]] : [];
    const idField = { eflaw: '법령일련번호', admrul: '행정규칙일련번호', ordin: '자치법규일련번호', prec: '판례일련번호' }[dataset.target];
    if (rows.length !== Math.min(total, 1) || (total && !/^\d+$/.test(String(rows[0]?.[idField] ?? '')))) throw new Error('shape');
    // Never output source links, raw responses, OC, or network exception messages.
    return { id: dataset.id, status: total ? 'LIST_OK' : 'EMPTY_REQUIRES_REVIEW', total, bytes: size, pagesAt100: Math.ceil(total / 100) };
  } catch {
    return { id: dataset.id, status: 'READ_OR_RESPONSE_ERROR' };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--probe')) {
    console.error('Usage: node --env-file=local-dev/.env --use-system-ca backend/tools/collection-preflight.mjs [--probe]');
    process.exitCode = 1;
    return;
  }
  const oc = process.env.MOLEG_OC?.trim();
  const report = { checkedAt: new Date().toISOString(), ocConfigured: Boolean(oc), mode: args.length ? 'bounded-list-probe' : 'offline', dbWrites: false, detailDownloads: false, datasets };
  if (args.length) {
    report.results = [];
    for (const dataset of datasets) {
      report.results.push(await probeDataset(dataset, oc));
      if (oc) await delay(1000);
    }
    if (report.results.some(row => row.status !== 'LIST_OK')) process.exitCode = 2;
  }
  console.log(JSON.stringify(report, null, 2));
}
if (import.meta.main) await main();
