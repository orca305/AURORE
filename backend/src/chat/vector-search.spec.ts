import { describe, expect, it } from 'vitest';
import { fuseRanks, quantize, searchVectors, topByDot } from './vector-search.js';
import { fuseCandidates, type Candidate } from './stored-evidence.js';

describe('vector search helpers', () => {
  it('quantizes to an L2-normalized int8 vector', () => {
    const q = quantize([3, 4]);
    expect([...q]).toEqual([76, 102]);
  });
  it('returns the highest dot products first', () => {
    const dims = 2;
    const vectors = Int8Array.from([...quantize([1, 0]), ...quantize([0, 1]), ...quantize([1, 1])]);
    const top = topByDot({ ids: ['10', '20', '30'], vectors, dims }, quantize([0, 1]), 2);
    expect(top.map((hit) => hit.id)).toEqual(['20', '30']);
  });
  it('fuses ranked lists so items on both lists win', () => {
    const fused = fuseRanks([['a', 'b', 'c'], ['c', 'a']]);
    const order = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([key]) => key);
    expect(order).toEqual(['a', 'c', 'b']);
  });
  it('returns nothing when disabled', async () => {
    process.env.AURORE_VECTOR_SEARCH = '0';
    expect(await searchVectors('보증금')).toEqual([]);
    delete process.env.AURORE_VECTOR_SEARCH;
  });
});

describe('candidate fusion', () => {
  const row = (id: number, score: number, vector = false, proviId?: string): Candidate => ({
    kind: 'LEGAL', snapshotId: 1n, targetId: BigInt(id), legalId: 1n, sourceKey: 'k' + id, edition: 'e', date: '20260101', article: '1', title: 't' + id, proviNm: null, proviId, vector, score,
  });
  it('adds vector-only articles and ranks rows found by both searches first', () => {
    const fused = fuseCandidates([row(1, 9), row(2, 5)], [row(2, 0, true, '22'), row(3, 0, true, '33')], ['22', '33']);
    expect(fused.map((r) => Number(r.targetId))).toEqual([2, 1, 3]);
    expect(fused.find((r) => Number(r.targetId) === 3)?.vector).toBe(true);
  });
});

describe('law level factor', () => {
  it('mirrors the SQL ranking factor by law name', async () => {
    const { levelFactor } = await import('./stored-evidence.js');
    expect(levelFactor('근로기준법 제2조')).toBe(1);
    expect(levelFactor('도로교통법 시행령 제30조의2')).toBe(0.7);
    expect(levelFactor('인구동향조사 규칙 제6조')).toBe(0.4);
    expect(levelFactor('국민연금공단법 제3조')).toBe(0.6);
  });
});

describe('embedChunks', () => {
  it('sends only texts it has not embedded yet', async () => {
    const sent: string[][] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] };
      sent.push(input);
      return new Response(JSON.stringify({ embeddings: input.map(() => Array.from({ length: 1024 }, () => 1)) }));
    }) as typeof fetch;
    try {
      const { embedChunks } = await import('./vector-search.js');
      expect(await embedChunks(['캐시 시험 가', '캐시 시험 나'])).toHaveLength(2);
      expect(await embedChunks(['캐시 시험 나', '캐시 시험 다', '캐시 시험 가'])).toHaveLength(3);
      expect(sent).toEqual([['캐시 시험 가', '캐시 시험 나'], ['캐시 시험 다']]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
