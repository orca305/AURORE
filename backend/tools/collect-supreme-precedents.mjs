// 대법원 판례 전체 수집 드라이버: 선고일 기간별 폴더(최대 1000건)로 나눠 목록 → 원문 수집 → DB 반영을 순서대로 반복한다.
// 기존 도구(plan-/resume-/apply-precedent-collection.mjs)를 그대로 호출하므로 검증·중복 방지·되돌리기 규칙도 같다.
// 다시 실행하면 끝난 폴더(applied.json)는 건너뛰고 이어 받는다. 한 기간이 1000건을 넘으면 반으로 나눠 다시 시도한다.
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/collect-supreme-precedents.mjs [기록 루트, 기본 D:/DATA/precedent-supreme] [--from 2000] [--to 2026] [--no-apply]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { from: { type: 'string' }, to: { type: 'string' }, 'no-apply': { type: 'boolean' } },
});
const root = positionals[0] ?? 'D:/DATA/precedent-supreme';
// 2000년 이전 판례는 생활 법률 질문에 쓸모가 적어 기본으로 받지 않는다(2026-11-21 사용자 결정).
const firstYear = Number(values.from ?? 2000);
const lastYear = Number(values.to ?? new Date().getFullYear());
const tools = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (!process.env.MOLEG_OC) throw new Error('MOLEG_OC 가 필요합니다');
await mkdir(root, { recursive: true });

const run = (script, args) => {
  const result = spawnSync(process.execPath, ['--use-system-ca', join(tools, script), ...args], { env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, out: result.stdout ?? '', err: (result.stderr ?? '').trim() };
};
const log = (value) => console.log(JSON.stringify({ at: new Date().toISOString(), ...value }));
const ymd = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');
const days = (from, to) => Math.round((Date.parse(to.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) - Date.parse(from.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))) / 86400000);

// 본문이 법제처에 없다고 확인된 판례 일련번호(목록 단계에서 뺀다).
const excludedPath = join(root, 'excluded.json');
const excluded = new Set(existsSync(excludedPath) ? JSON.parse(await readFile(excludedPath, 'utf8')) : []);
/** 법제처 본문 조회가 "일치하는 판례가 없습니다"를 돌려주면 true. 네트워크 오류 등은 false(일시 오류로 본다). */
async function missingAtSource(id) {
  if (!/^\d{1,12}$/.test(id)) return false;
  try {
    const url = new URL('https://www.law.go.kr/DRF/lawService.do');
    url.search = new URLSearchParams({ OC: process.env.MOLEG_OC, target: 'prec', ID: id, type: 'JSON' }).toString();
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    return response.ok && text.length < 500 && text.includes('일치하는 판례가 없습니다');
  } catch {
    return false;
  }
}

const attempts = {};
/** 기간 하나: 목록(너무 많으면 반으로 나눔) → 수집 → 반영. */
async function period(from, to) {
  const folder = join(root, from + '-' + to);
  if (existsSync(join(folder, 'applied.json')) || existsSync(join(folder, 'empty.json'))) return;
  if (!existsSync(join(folder, 'input.json'))) {
    const plan = run('plan-precedent-collection.mjs', [join(folder, 'input.json'), '--court', 'supreme', '--from', from, '--to', to]);
    if (!plan.ok && plan.err.includes('SEARCH_TOO_BROAD')) {
      if (days(from, to) < 2) throw new Error('하루 선고 건수가 1000건을 넘어 나눌 수 없습니다: ' + from);
      const mid = new Date(Date.parse(from.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) + Math.floor(days(from, to) / 2) * 86400000);
      const next = new Date(mid.getTime() + 86400000);
      log({ split: from + '-' + to, into: [from + '-' + ymd(mid), ymd(next) + '-' + to] });
      await period(from, ymd(mid));
      await period(ymd(next), to);
      return;
    }
    if (!plan.ok) {
      // 목록 조회 응답이 일시적으로 비정상일 수 있다. 잠시 쉬고 다시 시도하고, 계속 실패하면 이 기간은 건너뛴다(나중에 다시 실행하면 이어서 받는다).
      attempts[from + to] = (attempts[from + to] ?? 0) + 1;
      if (attempts[from + to] < 4) {
        log({ period: from + '-' + to, planRetry: attempts[from + to], reason: plan.err.slice(0, 40) });
        await delay(20_000 * attempts[from + to]);
        return period(from, to);
      }
      log({ period: from + '-' + to, skipped: true, reason: 'PLAN_FAILED ' + plan.err.slice(0, 40) });
      return;
    }
    const planned = JSON.parse(plan.out);
    // 사건번호가 '대법원-2025-두-35037' 같은 새 형식인 항목은 목록에는 있지만 본문 조회(lawService)가 "일치하는 판례가 없습니다"를 돌려준다.
    // 수집기는 첫 실패에서 멈추므로, 원문 수집을 시작하기 전(목록이 고정되기 전)에 이런 항목을 뺀다.
    if (planned.saved) {
      const listPath = join(folder, 'input.json');
      const items = JSON.parse(await readFile(listPath, 'utf8'));
      // 정상 판례 사건번호는 숫자로 시작한다(2022두31112, 4287민상383). 법원 이름으로 시작하는 형식과 본문이 없다고 확인된 판례는 뺀다.
      const usable = items.filter((item) => /^\d/u.test(item.caseNumber) && !excluded.has(item.ID));
      if (usable.length !== items.length) {
        log({ period: from + '-' + to, unavailableFormat: items.length - usable.length });
        if (!usable.length) planned.saved = false;
        else await writeFile(listPath, JSON.stringify(usable, null, 2));
        planned.candidates = usable.length;
      }
    }
    if (!planned.saved) {
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'empty.json'), JSON.stringify({ from, to, total: 0 }));
      log({ period: from + '-' + to, total: 0 });
      return;
    }
    log({ period: from + '-' + to, planned: planned.candidates });
  }
  // 원문 수집: 실패하면 잠시 쉬고 이어서(같은 판례 3회 연속 실패면 이 기간은 건너뛰고 나중에 다시 실행).
  for (let failures = 0; ; ) {
    const status = JSON.parse(run('resume-precedent-collection.mjs', [folder, '--status']).out || '{}');
    if (status.initialized && status.remaining === 0) break;
    const step = run('resume-precedent-collection.mjs', status.initialized ? [folder, '--limit', '1000'] : [folder, '--queue', join(folder, 'input.json'), '--limit', '1000']);
    if (!step.ok) {
      // 실패한 판례의 본문이 법제처에 아예 없으면(일치하는 판례 없음) 제외 목록에 넣고 이 기간의 목록을 다시 만든다.
      const nextId = JSON.parse(run('resume-precedent-collection.mjs', [folder, '--status']).out || '{}').nextId;
      if (nextId && (await missingAtSource(nextId))) {
        excluded.add(nextId);
        await writeFile(excludedPath, JSON.stringify([...excluded]));
        const aside = join(root, '_discarded-20261121', from + '-' + to + '-' + Date.now());
        await mkdir(join(root, '_discarded-20261121'), { recursive: true });
        await rename(folder, aside);
        log({ period: from + '-' + to, excluded: nextId, replan: true });
        return period(from, to);
      }
      if (++failures >= 3) {
        log({ period: from + '-' + to, skipped: true, reason: step.err.slice(0, 60) });
        return;
      }
      await delay(30_000 * failures);
    } else failures = 0;
  }
  if (values['no-apply']) return;
  const applied = run('apply-precedent-collection.mjs', [folder, '--apply']);
  if (!applied.ok) {
    log({ period: from + '-' + to, applyFailed: applied.err.slice(0, 80) });
    return;
  }
  await writeFile(join(folder, 'applied.json'), JSON.stringify({ from, to, appliedAt: new Date().toISOString() }));
  log({ period: from + '-' + to, applied: true });
}

for (let year = lastYear; year >= firstYear; year--) await period(year + '0101', year + '1231');
log({ complete: true, from: firstYear, to: lastYear });
