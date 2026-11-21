// 법령용어 전체 수집(읽기 전용, DB 변경 없음): 법제처 용어 목록 전체 → 용어별 공식 정의를 JSONL 로 저장한다. 중단 후 다시 실행하면 이어 받는다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/collect-all-terms.mjs [기록 폴더, 기본 D:/DATA/terms-collection]
// 저장: list.jsonl(용어 번호·이름·사전 코드), details.jsonl(공식 정의), failed.jsonl(실패 번호·고정 코드), state.json(목록 진행).
// 인증값(OC)은 어떤 파일에도 쓰지 않는다. 요청 간격은 최소 0.6초.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { parseTermDetail, parseTermSearch } from '../dist/terms/moleg-terms.js';

const dir = process.argv[2] ?? 'D:/DATA/terms-collection';
const oc = process.env.MOLEG_OC?.trim();
if (!oc) throw new Error('MOLEG_OC 가 필요합니다');
await mkdir(dir, { recursive: true });
const file = (name) => join(dir, name);
const readLines = async (name) => (existsSync(file(name)) ? (await readFile(file(name), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const safe = (value) => {
  const text = JSON.stringify(value);
  if (text.includes(oc)) throw new Error('CREDENTIAL_IN_OUTPUT');
  return text;
};
let last = 0;
async function call(route, params) {
  await delay(Math.max(0, 600 - (Date.now() - last)));
  last = Date.now();
  const url = new URL('https://www.law.go.kr/DRF/' + route);
  url.search = new URLSearchParams({ OC: oc, target: 'lstrm', type: 'JSON', ...params }).toString();
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('HTTP_' + response.status);
      const raw = (await response.text()).replace(/^\uFEFF/, '');
      return { raw, payload: JSON.parse(raw) };
    } catch (error) {
      if (attempt >= 3) throw error;
      await delay(3000 * attempt);
    }
  }
}

// 1) 목록
const state = existsSync(file('state.json')) ? JSON.parse(await readFile(file('state.json'), 'utf8')) : { nextPage: 1, listDone: false, total: null };
while (!state.listDone) {
  let page;
  try {
    const { payload } = await call('lawSearch.do', { display: '100', page: String(state.nextPage), sort: 'rasc' });
    page = parseTermSearch(payload, state.nextPage, 100);
  } catch (error) {
    // 형식이 다른 항목이 있는 쪽은 건너뛰고 기록한다(전체가 멈추지 않도록). 건너뛴 쪽은 bad-pages.jsonl 에 남는다.
    await appendFile(file('bad-pages.jsonl'), JSON.stringify({ page: state.nextPage, code: /^[A-Z_0-9]+$/.test(String(error?.message)) ? error.message : 'LIST_FAILED' }) + '\n');
    state.nextPage++;
    state.listDone = state.nextPage * 100 > (state.total ?? 0) + 100;
    await writeFile(file('state.json'), JSON.stringify(state));
    continue;
  }
  state.total ??= page.total;
  if (page.items.length)
    await appendFile(file('list.jsonl'), page.items.map((item) => safe({ sourceId: item.sourceId, termName: item.termName, dictionaryCode: item.dictionaryCode })).join('\n') + '\n');
  if (state.nextPage % 50 === 0) console.log(JSON.stringify({ stage: 'list', page: state.nextPage, total: state.total }));
  state.listDone = !page.items.length || state.nextPage * 100 >= state.total;
  state.nextPage++;
  await writeFile(file('state.json'), JSON.stringify(state));
}

// 2) 상세(공식 정의)
const listed = [...new Map((await readLines('list.jsonl')).map((row) => [row.sourceId, row])).values()];
const done = new Set((await readLines('details.jsonl')).map((row) => row.sourceId));
const failed = new Set((await readLines('failed.jsonl')).map((row) => row.sourceId));
const pending = listed.filter((row) => !done.has(row.sourceId) && !failed.has(row.sourceId));
console.log(JSON.stringify({ stage: 'detail', listed: listed.length, done: done.size, failed: failed.size, pending: pending.length }));
let streak = 0, count = 0;
for (const row of pending) {
  try {
    const { raw, payload } = await call('lawService.do', { trmSeqs: row.sourceId });
    if (raw.includes(oc)) throw new Error('CREDENTIAL_IN_RESPONSE');
    const data = parseTermDetail(payload, row.sourceId);
    await appendFile(file('details.jsonl'), safe({ sourceId: row.sourceId, termName: row.termName, rawHash: createHash('sha256').update(raw).digest('hex'), data }) + '\n');
    streak = 0;
  } catch (error) {
    const code = /^[A-Z_0-9]+$/.test(String(error?.message)) ? error.message : 'DETAIL_FAILED';
    await appendFile(file('failed.jsonl'), JSON.stringify({ sourceId: row.sourceId, code }) + '\n');
    if (++streak >= 20) throw new Error('연속 실패 20회로 멈춥니다. 다시 실행하면 이어 받습니다(실패 목록은 failed.jsonl).');
  }
  if (++count % 500 === 0) console.log(JSON.stringify({ stage: 'detail', done: done.size + count, of: listed.length }));
}
console.log(JSON.stringify({ stage: 'complete', listed: listed.length }));
