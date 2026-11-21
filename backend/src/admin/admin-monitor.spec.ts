import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminMonitorService, estimateCost, modelPrices } from './admin-monitor.service.js';
import { parseAiCalls, recordAiCalls } from '../chat/ai-call-log.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const header = (calls: unknown) => JSON.stringify(calls);

describe('parseAiCalls', () => {
  it('형식이 맞는 호출만 받고 모르는 값은 버린다', () => {
    const rows = parseAiCalls(
      header([
        { stage: 'answer', provider: 'external', model: 'claude-haiku-5-5', ms: 8200, in: 3000, out: 500, outcome: 'OK', error: null },
        { stage: 'answer', provider: 'external', model: 'claude-haiku-5-5', ms: 120, in: null, out: null, outcome: 'FALLBACK', error: 'BUDGET_EXHAUSTED' },
        { stage: 'answer', provider: 'cloud', model: 'x', ms: 1, outcome: 'OK' },
        { stage: 'Bad Stage!', provider: 'local', model: '', ms: 1, outcome: 'OK' },
        { stage: 'propose', provider: 'local', model: '', ms: -5, outcome: 'OK' },
        { stage: 'propose', provider: 'local', model: 'a b c <script>', ms: 900, in: 'x', out: 1.5, outcome: 'ERROR', error: 'bad error!' },
      ]),
    );
    expect(rows).toEqual([
      { stageCd: 'answer', providerCd: 'external', modelCd: 'claude-haiku-5-5', latencyMs: 8200, inTokens: 3000, outTokens: 500, outcomeCd: 'OK', errCd: null },
      { stageCd: 'answer', providerCd: 'external', modelCd: 'claude-haiku-5-5', latencyMs: 120, inTokens: null, outTokens: null, outcomeCd: 'FALLBACK', errCd: 'BUDGET_EXHAUSTED' },
      { stageCd: 'propose', providerCd: 'local', modelCd: 'local', latencyMs: 900, inTokens: null, outTokens: null, outcomeCd: 'ERROR', errCd: null },
    ]);
    expect(parseAiCalls('not json')).toEqual([]);
    expect(parseAiCalls(null)).toEqual([]);
  });

  it('저장에 실패해도 예외를 밖으로 내지 않고, 끄면 저장하지 않는다', async () => {
    const createMany = vi.fn().mockRejectedValue(new Error('db'));
    const db = { aiCallLog: { createMany } } as unknown as PrismaService;
    await expect(recordAiCalls(db, header([{ stage: 'answer', provider: 'local', model: '', ms: 5, outcome: 'OK' }]))).resolves.toBeUndefined();
    expect(createMany).toHaveBeenCalledOnce();
    process.env.AURORE_CALL_LOG = '0';
    await recordAiCalls(db, header([{ stage: 'answer', provider: 'local', model: '', ms: 5, outcome: 'OK' }]));
    delete process.env.AURORE_CALL_LOG;
    expect(createMany).toHaveBeenCalledOnce();
  });
});

describe('estimateCost', () => {
  afterEach(() => delete process.env.AURORE_MODEL_PRICES);
  it('토큰 수와 모델별 가격으로 추정 비용을 계산하고, 가격표가 없으면 가정값이라고 알린다', () => {
    expect(modelPrices().assumed).toBe(true);
    expect(estimateCost('claude-haiku-5-5', 1_000_000, 1_000_000)).toBe(6);
    expect(estimateCost('unknown-model', 1000, 1000)).toBe(0);
    process.env.AURORE_MODEL_PRICES = JSON.stringify({ 'claude-sonnet-5-5': { in: 3, out: 15 }, bad: { in: 'x' } });
    const { prices, assumed } = modelPrices();
    expect(assumed).toBe(false);
    expect(Object.keys(prices)).toEqual(['claude-sonnet-5-5']);
  });
});

describe('AdminMonitorService', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ blockedKind: null })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ['AURORE_DAILY_COST_LIMIT_USD', 'AURORE_ALERT_ERROR_RATE']) delete process.env[key];
  });

  const build = (window: Record<string, unknown>, dailyCalls = 100) => {
    const results = [
      [{ day: '2026-11-22', calls: dailyCalls, errors: 5, fallbacks: 0, external: 80, local: 15, avg_ms: 9000.4, p95_ms: 15000.9 }],
      [{ day: '2026-11-22', model_cd: 'claude-haiku-5-5', in_tokens: 2_000_000n, out_tokens: 400_000n }],
      [{ stage_cd: 'answer', calls: 40, errors: 1, avg_ms: 9000, p95_ms: 14000 }],
      [{ day: '2026-11-22', jobs: 50 }],
      [{ day: 'last-hour', calls: 10, errors: 0, fallbacks: 0, external: 10, local: 0, avg_ms: 8000, p95_ms: 12000, ...window }],
    ];
    let at = 0;
    const db = { $queryRaw: vi.fn(async () => results[at++]) } as unknown as PrismaService;
    return new AdminMonitorService(db);
  };

  it('일별 질문 수·지연·오류율·외부 비율·추정 비용을 모은다', async () => {
    const result = await build({}).monitor(7);
    expect(result.daily[0]).toEqual({ day: '2026-11-22', questions: 50, calls: 100, avgMs: 9000, p95Ms: 15001, errorRate: 0.05, externalShare: 0.842, fallbacks: 0, estimatedCostUsd: 4 });
    expect(result.stages[0]).toMatchObject({ stage: 'answer', calls: 40 });
    expect(result.alerts).toEqual([]);
    expect(result.pricesAssumed).toBe(true);
  });

  it('임계치를 넘으면 알림을 낸다: 오류율·느림·로컬 전환·비용·외부 모델 차단·AI 서버 불가', async () => {
    process.env.AURORE_DAILY_COST_LIMIT_USD = '3';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ blockedKind: 'BUDGET_EXHAUSTED' })));
    const result = await build({ errors: 4, p95_ms: 60000, fallbacks: 8, external: 2 }).monitor(7);
    expect(result.alerts.map((a) => a.code).sort()).toEqual(['COST', 'ERROR_RATE', 'EXTERNAL_BLOCKED', 'FALLBACK', 'SLOW']);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    const down = await build({}).monitor(7);
    expect(down.alerts.map((a) => a.code)).toContain('AI_DOWN');
  });

  it('호출이 5건 미만이면 오류율·지연 알림을 내지 않는다', async () => {
    const result = await build({ calls: 3, errors: 3, p95_ms: 99999 }).monitor(1);
    expect(result.alerts).toEqual([]);
  });
});
