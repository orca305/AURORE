import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyQuestion } from './intent-routing.js';

const base = new URL('http://127.0.0.1:8000');
const result = {
  route: 'GENERAL',
  label: 'GENERAL',
  score: 0.92,
  modelVersion: 'a'.repeat(64),
  evaluationEligible: true,
  routingEnabled: true,
};
beforeEach(() => vi.stubEnv('AURORE_INTENT_CLASSIFY', '1'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('intent routing boundary', () => {
  it('uses an explicitly enabled, evaluated result and sends only the question', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', request);
    expect(await classifyQuestion('오늘 기분이 좋아요', base)).toBe('GENERAL');
    expect(request.mock.calls[0][0].href).toBe(
      'http://127.0.0.1:8000/intent/classify',
    );
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      question: '오늘 기분이 좋아요',
    });
  });
  it('leaves the search path intact for an experimental, disabled, malformed or unavailable model', async () => {
    for (const response of [
      { ...result, evaluationEligible: false },
      { ...result, routingEnabled: false },
      { ...result, route: 'OTHER' },
      { ...result, label: 'LEGAL' },
      { ...result, score: 2 },
      { ...result, modelVersion: '../../private' },
      null,
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
      );
      expect(await classifyQuestion('질문', base)).toBeNull();
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })),
    );
    expect(await classifyQuestion('질문', base)).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect(await classifyQuestion('질문', base)).toBeNull();
  });
  it('does not skip legal retrieval for explicit legal cues', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(result))),
    );
    expect(
      await classifyQuestion('보증금 반환 계약에 대해 궁금해요', base),
    ).toBe('LEGAL');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...result, route: 'CLARIFY' })),
        ),
    );
    expect(await classifyQuestion('소송 절차', base)).toBe('LEGAL');
  });
  it('does not send a question to non-local, credential-bearing or invalid addresses', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    for (const target of [
      'https://example.com',
      'http://user:secret@127.0.0.1',
      'file:///private',
      'not-a-url',
    ]) {
      expect(await classifyQuestion('질문', target)).toBeNull();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('does not invoke notebook inference unless explicitly enabled', async () => {
    vi.stubEnv('AURORE_INTENT_CLASSIFY', '0');
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    expect(await classifyQuestion('질문', base)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
