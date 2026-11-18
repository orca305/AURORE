import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCurrentLaw, titles } from './collect-selected-laws.mjs';

test('only one exact current statute with valid identity can reach the importer', () => {
  assert.ok(titles.includes('근로기준법') && titles.includes('형법'));
  const row = { 법령명한글: '민법', 법령ID: '1778', 법령일련번호: '123456', 시행일자: '2026.01.01' };
  const payload = rows => ({ LawSearch: { page: 1, totalCnt: rows.length, law: rows } });
  assert.deepEqual(selectCurrentLaw(payload([row]), '민법'), { target: 'eflaw', lawId: '001778', MST: '123456', efYd: '20260101' });
  for (const rows of [[], [row, row], [{ ...row, 법령명한글: '민법 시행령' }], [{ ...row, 시행일자: '20260230' }], [{ ...row, 법령일련번호: '../secret' }], [{ ...row, 법령ID: '' }]]) {
    assert.throws(() => selectCurrentLaw(payload(rows), '민법'));
  }
  assert.throws(() => selectCurrentLaw({ LawSearch: { page: 1, totalCnt: 101, law: [row] } }, '민법'));
});
