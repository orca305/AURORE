import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createRecord } from './refresh-run-lock.mjs';
import { validatePrecedentQueue } from './resume-precedent-collection.mjs';

const pageSize = 100,
  maxTotal = 1000;
const fail = (code) => Object.assign(new Error(code), { code });
function calendar(value) {
  if (typeof value !== 'string' || !/^[0-9]{8}$/.test(value)) return false;
  const iso =
    value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6);
  const date = new Date(iso);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso
  );
}
export function precedentSearchOptions({
  query = '',
  search = 'title',
  from,
  to,
  court = 'all',
} = {}) {
  if (
    !['all', 'supreme', 'lower'].includes(court) ||
    typeof query !== 'string' ||
    query.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(query) ||
    !['title', 'body'].includes(search) ||
    ((from !== undefined || to !== undefined) &&
      (!calendar(from) || !calendar(to) || from > to)) ||
    (!query.trim() && !from)
  )
    throw fail('SEARCH_OPTIONS_INVALID');
  return { query: query.trim(), search, ...(from ? { from, to } : {}), ...(court === 'supreme' || court === 'lower' ? { court } : {}) };
}
export function parsePrecedentSearchPage(payload, requestedPage) {
  const list = payload?.PrecSearch;
  const count = String(list?.totalCnt ?? '');
  if (!/^[0-9]+$/.test(count) || !Number.isSafeInteger(Number(count)))
    throw fail('SEARCH_RESPONSE_INVALID');
  const total = Number(count);
  if (total > maxTotal) throw fail('SEARCH_TOO_BROAD');
  if (String(list.page) !== String(requestedPage))
    throw fail('SEARCH_PAGE_CHANGED');
  const entries = Array.isArray(list.prec)
    ? list.prec
    : list.prec
      ? [list.prec]
      : [];
  const expected = Math.min(
    pageSize,
    Math.max(0, total - (requestedPage - 1) * pageSize),
  );
  if (entries.length !== expected) throw fail('SEARCH_RESPONSE_INVALID');
  const rows = entries.map((entry) => {
    const value = String(entry?.판례일련번호 ?? '');
    // The API uses dotted decision dates; normalize only for validation and range checks.
    const date =
      typeof entry?.선고일자 === 'string'
        ? entry.선고일자.replaceAll('.', '')
        : '';
    if (!calendar(date)) throw fail('SEARCH_RESPONSE_INVALID');
    let item;
    try {
      [item] = validatePrecedentQueue([
        { ID: value, caseNumber: entry.사건번호 },
      ]);
    } catch {
      throw fail('SEARCH_RESPONSE_INVALID');
    }
    return { ...item, date };
  });
  return { total, rows };
}
export async function fetchPrecedentSearchPage(
  options,
  page,
  oc,
  fetchImpl = fetch,
) {
  if (!oc || typeof oc !== 'string') throw fail('OC_REQUIRED');
  const url = new URL('https://www.law.go.kr/DRF/lawSearch.do');
  url.search = new URLSearchParams({
    OC: oc,
    target: 'prec',
    type: 'JSON',
    query: options.query,
    search: options.search === 'body' ? '2' : '1',
    display: String(pageSize),
    page: String(page),
    sort: 'dasc',
    ...(options.from ? { prncYd: options.from + '~' + options.to } : {}),
    // 법원 종류: 대법원(400201)만. 생략하면 전체 법원.
    ...(options.court === 'supreme' ? { org: '400201' } : options.court === 'lower' ? { org: '400202' } : {}),
  });
  try {
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (
      !response.ok ||
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .includes('application/json')
    )
      throw fail('SEARCH_READ_FAILED');
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024)
      throw fail('SEARCH_READ_FAILED');
    const payload = JSON.parse(text);
    const list = payload?.PrecSearch;
    const pick = (entry) => ({
      판례일련번호: entry?.판례일련번호,
      사건번호: entry?.사건번호,
      선고일자: entry?.선고일자,
    });
    // Official detail links can contain OC. Keep only fields needed for the queue, never raw links or query echoes.
    const safe = {
      PrecSearch: {
        totalCnt: list?.totalCnt,
        page: list?.page,
        prec: Array.isArray(list?.prec)
          ? list.prec.map(pick)
          : list?.prec
            ? pick(list.prec)
            : undefined,
      },
    };
    const plain = JSON.stringify(safe);
    const echoed = [...plain.matchAll(/(?:[?&]|&amp;)OC=([^&"'\s]+)/gi)].some(
      (match) => {
        try {
          return decodeURIComponent(match[1].replaceAll('+', ' ')) === oc;
        } catch {
          return false;
        }
      },
    );
    if (plain.includes(oc) || echoed) throw fail('SEARCH_READ_FAILED');
    return safe;
  } catch {
    throw fail('SEARCH_READ_FAILED');
  }
}
export async function planPrecedentCollection(input, fetchPage) {
  const options = precedentSearchOptions(input);
  const items = new Map(),
    pages = new Set();
  let total,
    received = 0,
    page = 1;
  do {
    let payload;
    try {
      payload = await fetchPage(options, page);
    } catch {
      throw fail('SEARCH_READ_FAILED');
    }
    const data = parsePrecedentSearchPage(payload, page);
    total ??= data.total;
    if (data.total !== total) throw fail('SEARCH_TOTAL_CHANGED');
    const fingerprint = JSON.stringify(data.rows.map((row) => row.ID).sort());
    if (pages.has(fingerprint)) throw fail('SEARCH_PAGE_REPEATED');
    pages.add(fingerprint);
    for (const { date, ...item } of data.rows) {
      if (options.from && (date < options.from || date > options.to))
        throw fail('SEARCH_RANGE_CHANGED');
      const previous = items.get(item.ID);
      if (previous && previous.caseNumber !== item.caseNumber)
        throw fail('SEARCH_ID_CONFLICT');
      items.set(item.ID, item);
    }
    received += data.rows.length;
    page++;
  } while (received < total);
  return {
    total,
    pages: page - 1,
    duplicates: received - items.size,
    items: [...items.values()],
  };
}
export async function writePrecedentQueue(destination, input, fetchPage) {
  const path = resolve(destination);
  try {
    await stat(path);
    throw fail('QUEUE_OUTPUT_EXISTS');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const result = await planPrecedentCollection(input, fetchPage);
  if (!result.items.length) return { ...result, saved: false };
  validatePrecedentQueue(result.items);
  await mkdir(dirname(path), { recursive: true });
  if (!(await createRecord(path, result.items)))
    throw fail('QUEUE_OUTPUT_EXISTS');
  return { ...result, saved: true };
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      query: { type: 'string' },
      search: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      court: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node --env-file=local-dev/.env backend/tools/plan-precedent-collection.mjs <new-queue-file> [--query text] [--search title|body] [--from YYYYMMDD --to YYYYMMDD] [--court all|supreme|lower]',
    );
    return;
  }
  if (positionals.length !== 1) throw fail('SEARCH_OPTIONS_INVALID');
  const options = precedentSearchOptions(values),
    oc = process.env.MOLEG_OC?.trim();
  if (!oc) throw fail('OC_REQUIRED');
  const result = await writePrecedentQueue(
    positionals[0],
    options,
    (parameters, page) => fetchPrecedentSearchPage(parameters, page, oc),
  );
  console.log(
    JSON.stringify(
      {
        total: result.total,
        pages: result.pages,
        duplicates: result.duplicates,
        candidates: result.items.length,
        saved: result.saved,
      },
      null,
      2,
    ),
  );
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const allowed = new Set([
      'OC_REQUIRED',
      'SEARCH_OPTIONS_INVALID',
      'SEARCH_RESPONSE_INVALID',
      'SEARCH_TOO_BROAD',
      'SEARCH_PAGE_CHANGED',
      'SEARCH_READ_FAILED',
      'SEARCH_TOTAL_CHANGED',
      'SEARCH_PAGE_REPEATED',
      'SEARCH_RANGE_CHANGED',
      'SEARCH_ID_CONFLICT',
      'QUEUE_OUTPUT_EXISTS',
    ]);
    console.error(allowed.has(error.code) ? error.code : 'SEARCH_PLAN_FAILED');
    process.exitCode = 1;
  }
}
