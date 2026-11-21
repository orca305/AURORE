import { describe, expect, it } from 'vitest';
import { ensureLawSlots } from './stored-evidence.js';

const key = (row: string) => row;
const rows = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];

describe('ensureLawSlots', () => {
  it('returns the same rows when nothing is reserved or all reserved rows are already in the top', () => {
    expect(ensureLawSlots(rows, [], 6, key)).toBe(rows);
    expect(ensureLawSlots(rows, ['a2', 'a5'], 6, key)).toBe(rows);
  });
  it('keeps the first four, inserts missing rows after them and drops the weakest non-reserved ones', () => {
    const out = ensureLawSlots(rows, ['x1', 'x2'], 6, key);
    expect(out.slice(0, 4)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(out.slice(4, 6)).toEqual(['x1', 'x2']);
    expect(out.slice(0, 6)).not.toContain('a5');
    expect(out.slice(0, 6)).not.toContain('a6');
    // 밀려난 것도 사라지지는 않고 뒤에 남는다(top 이후는 원래 순서 유지).
    expect(out.slice(6)).toEqual(['a5', 'a6', 'a7', 'a8']);
  });
  it('never drops a reserved row that is already in the top and never duplicates', () => {
    const out = ensureLawSlots(rows, ['a6', 'x1'], 6, key);
    expect(out.slice(0, 6)).toContain('a6');
    expect(out.slice(0, 6)).toContain('x1');
    expect(new Set(out).size).toBe(out.length);
  });
  it('moves a reserved row found beyond the limit up instead of duplicating it', () => {
    const out = ensureLawSlots(rows, ['a8'], 6, key);
    expect(out.slice(0, 6)).toContain('a8');
    expect(out.filter((row) => row === 'a8')).toHaveLength(1);
    expect(out).toHaveLength(rows.length);
  });
});
