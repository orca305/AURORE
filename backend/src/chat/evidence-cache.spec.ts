import { afterEach, describe, expect, it } from 'vitest';
import { EvidenceCache, HEAP_PER_CHAR, PINNED_LAWS, isPinnedLaw } from './evidence-cache.js';

const MB = 1048576;
// 원문 글자 수 → 어림 힙: 1MB 원문 ≒ 12MB. 시험은 작은 상한으로 한다.
const chars = (heapMB: number) => (heapMB * MB) / HEAP_PER_CHAR;

describe('EvidenceCache', () => {
  afterEach(() => {
    delete process.env.AURORE_EVIDENCE_PIN;
  });
  it('evicts by memory use, oldest unused first, and keeps small laws longer than big ones', () => {
    const cache = new EvidenceCache<string>(10 * MB, 50 * MB);
    cache.set('a', 'a', chars(4));
    cache.set('b', 'b', chars(4));
    cache.touch('a');
    cache.set('c', 'c', chars(4)); // 12MB > 10MB → 가장 오래 안 쓴 b 가 밀려남
    expect([cache.has('a'), cache.has('b'), cache.has('c')]).toEqual([true, false, true]);
    cache.set('tiny1', 'x', chars(0.1));
    cache.set('tiny2', 'x', chars(0.1));
    expect(cache.has('tiny1') && cache.has('tiny2')).toBe(true);
  });
  it('never evicts pinned entries and does not count them against the normal limit', () => {
    const cache = new EvidenceCache<string>(10 * MB, 50 * MB);
    cache.set('law', 'v', chars(30), true);
    for (let i = 0; i < 6; i++) cache.set('n' + i, 'v', chars(4));
    expect(cache.has('law')).toBe(true);
    expect(cache.stats().pinnedMB).toBeCloseTo(30, 0);
    expect(cache.stats().normalMB).toBeLessThanOrEqual(10.1);
  });
  it('treats pinned entries beyond the pin limit as normal ones, and keeps the newest entry even when it is huge', () => {
    const cache = new EvidenceCache<string>(10 * MB, 20 * MB);
    cache.set('p1', 'v', chars(15), true);
    cache.set('p2', 'v', chars(15), true); // 핀 상한 초과 → 일반 항목
    expect(cache.stats().pinnedMB).toBeCloseTo(15, 0);
    cache.set('huge', 'v', chars(40));
    expect(cache.has('huge')).toBe(true);
    expect(cache.has('p2')).toBe(false);
    expect(cache.has('p1')).toBe(true);
  });
  it('replaces an existing key without double counting', () => {
    const cache = new EvidenceCache<string>(10 * MB, 50 * MB);
    cache.set('a', '1', chars(4));
    cache.set('a', '2', chars(4));
    expect(cache.get('a')).toBe('2');
    expect(cache.stats().normalMB).toBeCloseTo(4, 0);
  });
});

describe('pinned laws', () => {
  afterEach(() => {
    delete process.env.AURORE_EVIDENCE_PIN;
  });
  it('lists everyday core laws and can be switched off', () => {
    expect(PINNED_LAWS).toContain('민법');
    expect(PINNED_LAWS).toContain('주택임대차보호법');
    expect(new Set(PINNED_LAWS).size).toBe(PINNED_LAWS.length);
    expect(isPinnedLaw('민법')).toBe(true);
    expect(isPinnedLaw('어떤 특별법')).toBe(false);
    process.env.AURORE_EVIDENCE_PIN = '0';
    expect(isPinnedLaw('민법')).toBe(false);
  });
});
