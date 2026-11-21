import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';

const service = () => new AdminService({} as never, {} as never);

describe('admin AI answer model status', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AURORE_AI_URL;
  });
  it('passes through only the expected fields and never a key', async () => {
    process.env.AURORE_AI_URL = 'http://127.0.0.1:8001';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'external', mode: 'fallback', externalModel: 'claude-haiku-5-5', localModel: 'aurore-local:12b', keyConfigured: true,
          blockedKind: 'BUDGET_EXHAUSTED', blockedSecondsLeft: 600, apiKey: 'must-not-leak', secret: 'x',
          calls: { external: 4, local: 2, fallback: 1, lastFallbackKind: 'BUDGET_EXHAUSTED', extra: 'x' }, sinceSeconds: 30,
        }),
      ),
    );
    const status = (await service().aiStatus()) as Record<string, unknown>;
    expect(status).toMatchObject({ reachable: true, mode: 'fallback', blockedKind: 'BUDGET_EXHAUSTED', blockedSecondsLeft: 600 });
    expect(JSON.stringify(status)).not.toContain('must-not-leak');
    expect(status).not.toHaveProperty('apiKey');
    expect(status.calls).toEqual({ external: 4, local: 2, fallback: 1, lastFallbackKind: 'BUDGET_EXHAUSTED' });
  });
  it('reports unreachable when the AI server fails or is not on loopback', async () => {
    process.env.AURORE_AI_URL = 'http://127.0.0.1:8001';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    expect(await service().aiStatus()).toEqual({ reachable: false });
    process.env.AURORE_AI_URL = 'http://example.com';
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockClear(); // 위의 호출은 세지 않는다.
    expect(await service().aiStatus()).toEqual({ reachable: false });
    expect(spy).not.toHaveBeenCalled();
  });
  it('falls back to local for unknown mode values', async () => {
    process.env.AURORE_AI_URL = 'http://127.0.0.1:8001';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ provider: 'weird', mode: 'weird' })));
    expect(await service().aiStatus()).toMatchObject({ provider: 'local', mode: 'local' });
  });
});
