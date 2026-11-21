// 법제처 법령용어 API에서 후보 용어의 공식 정의를 읽기 전용으로 가져와 JSON 파일에 저장한다(DB 변경 없음).
// 사용: node --env-file=local-dev/.env --use-system-ca backend/tools/fetch-term-candidates.mjs <새 결과 파일> <용어목록 txt>
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { MolegTermsClient } from '../dist/terms/moleg-terms.js';

const [out, listFile] = process.argv.slice(2);
assert.ok(out && listFile, '결과 파일과 용어 목록 파일이 필요합니다');
const names = (await readFile(listFile, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const client = new MolegTermsClient(new ConfigService({ MOLEG_OC: process.env.MOLEG_OC }));
const norm = s => s.normalize('NFC').replace(/\s/gu, '');
const found = [], missing = [];
for (const name of names) {
  try {
    const page = await client.search(name, 1, 20, 'newest');
    const exact = page.items.filter(item => norm(item.termName) === norm(name));
    if (!exact.length) { missing.push({ name, reason: 'NO_EXACT_MATCH', candidates: page.items.slice(0, 3).map(i => i.termName) }); continue; }
    // 같은 이름이라도 출처별 정의가 다르므로 첫 번째 출처만 사용하고, 나머지는 개수만 기록한다.
    const detail = await client.detail(exact[0].sourceId);
    found.push({ name, sourceId: exact[0].sourceId, otherSources: exact.length - 1, data: detail.data });
    console.log(JSON.stringify({ name, ok: true, otherSources: exact.length - 1 }));
  } catch (error) {
    missing.push({ name, reason: String(error?.message ?? error).slice(0, 80) });
    console.log(JSON.stringify({ name, ok: false }));
  }
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ capturedAt: new Date().toISOString(), found, missing }, null, 1), { flag: 'wx' });
console.log(JSON.stringify({ requested: names.length, found: found.length, missing: missing.length }));
