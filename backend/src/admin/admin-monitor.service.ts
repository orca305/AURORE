import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 모델별 가격(USD / 100만 토큰). 환경변수 AURORE_MODEL_PRICES(JSON)로 정확한 값을 넣는다. 없으면 아래 가정값이며 화면에 "가정값"이라고 알린다. */
const DEFAULT_PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-5-5': { in: 1, out: 5 },
  'claude-sonnet-5-5': { in: 3, out: 15 },
};

export function modelPrices(): { prices: Record<string, { in: number; out: number }>; assumed: boolean } {
  const raw = process.env.AURORE_MODEL_PRICES;
  if (!raw) return { prices: DEFAULT_PRICES, assumed: true };
  try {
    const parsed = JSON.parse(raw) as Record<string, { in?: unknown; out?: unknown }>;
    const prices: Record<string, { in: number; out: number }> = {};
    for (const [model, price] of Object.entries(parsed)) {
      if (typeof price?.in === 'number' && typeof price?.out === 'number' && price.in >= 0 && price.out >= 0) prices[model] = { in: price.in, out: price.out };
    }
    return { prices, assumed: false };
  } catch {
    return { prices: DEFAULT_PRICES, assumed: true };
  }
}

export const estimateCost = (model: string, inTokens: number, outTokens: number, prices = modelPrices().prices) => {
  const price = prices[model];
  return price ? (inTokens * price.in + outTokens * price.out) / 1_000_000 : 0;
};

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

type DailyRow = { day: string; calls: number; errors: number; fallbacks: number; external: number; local: number; avg_ms: number | null; p95_ms: number | null };
type TokenRow = { day: string; model_cd: string; in_tokens: bigint; out_tokens: bigint };
type StageRow = { stage_cd: string; calls: number; errors: number; avg_ms: number | null; p95_ms: number | null };
type JobRow = { day: string; jobs: number };
type WindowRow = DailyRow;

export type Alert = { level: 'warn' | 'danger'; code: string; message: string };

/**
 * AI 호출 모니터링: 일별 질문 수, 평균·P95 지연, 오류율, 외부/로컬 비율, 추정 비용과 임계치 알림.
 * 호출 기록(ai_call_log)에는 내용이 없고 단계·모델·시간·토큰·결과 코드만 있다.
 */
@Injectable()
export class AdminMonitorService {
  constructor(private readonly db: PrismaService) {}

  private async aiStatus(): Promise<{ reachable: boolean; blockedKind: string | null }> {
    try {
      const url = new URL('/legal/status', process.env.AURORE_AI_URL || 'http://127.0.0.1:8000');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return { reachable: false, blockedKind: null };
      const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) return { reachable: false, blockedKind: null };
      const value = (await response.json()) as { blockedKind?: unknown };
      return { reachable: true, blockedKind: typeof value.blockedKind === 'string' ? value.blockedKind.slice(0, 40) : null };
    } catch {
      return { reachable: false, blockedKind: null };
    }
  }

  async monitor(days: number) {
    const span = Math.min(30, Math.max(1, Math.trunc(days) || 7));
    const since = Prisma.sql`now() - make_interval(days => ${span})`;
    const day = Prisma.sql`to_char(date_trunc('day', occurred_dttm AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD')`;
    const [daily, tokens, stages, jobs, window, status] = await Promise.all([
      this.db.$queryRaw<DailyRow[]>(Prisma.sql`SELECT ${day} AS day, count(*)::int AS calls,
        (count(*) FILTER (WHERE outcome_cd = 'ERROR'))::int AS errors, (count(*) FILTER (WHERE outcome_cd = 'FALLBACK'))::int AS fallbacks,
        (count(*) FILTER (WHERE provider_cd = 'external' AND outcome_cd = 'OK'))::int AS external, (count(*) FILTER (WHERE provider_cd = 'local' AND outcome_cd = 'OK'))::int AS local,
        avg(latency_ms)::float8 AS avg_ms, (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::float8 AS p95_ms
        FROM ai_call_log WHERE occurred_dttm >= ${since} GROUP BY 1 ORDER BY 1 DESC`),
      this.db.$queryRaw<TokenRow[]>(Prisma.sql`SELECT ${day} AS day, model_cd, coalesce(sum(in_tokens), 0)::bigint AS in_tokens, coalesce(sum(out_tokens), 0)::bigint AS out_tokens
        FROM ai_call_log WHERE occurred_dttm >= ${since} AND provider_cd = 'external' GROUP BY 1, 2`),
      this.db.$queryRaw<StageRow[]>(Prisma.sql`SELECT stage_cd, count(*)::int AS calls, (count(*) FILTER (WHERE outcome_cd = 'ERROR'))::int AS errors,
        avg(latency_ms)::float8 AS avg_ms, (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::float8 AS p95_ms
        FROM ai_call_log WHERE occurred_dttm >= now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC`),
      this.db.$queryRaw<JobRow[]>(Prisma.sql`SELECT to_char(date_trunc('day', rgst_dttm AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS day, count(*)::int AS jobs
        FROM ai_job WHERE rgst_dttm >= ${since} GROUP BY 1`),
      this.db.$queryRaw<WindowRow[]>(Prisma.sql`SELECT 'last-hour' AS day, count(*)::int AS calls,
        (count(*) FILTER (WHERE outcome_cd = 'ERROR'))::int AS errors, (count(*) FILTER (WHERE outcome_cd = 'FALLBACK'))::int AS fallbacks,
        (count(*) FILTER (WHERE provider_cd = 'external' AND outcome_cd = 'OK'))::int AS external, (count(*) FILTER (WHERE provider_cd = 'local' AND outcome_cd = 'OK'))::int AS local,
        avg(latency_ms)::float8 AS avg_ms, (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::float8 AS p95_ms
        FROM ai_call_log WHERE occurred_dttm >= now() - interval '1 hour'`),
      this.aiStatus(),
    ]);
    const { prices, assumed } = modelPrices();
    const costByDay = new Map<string, number>();
    for (const row of tokens) costByDay.set(row.day, (costByDay.get(row.day) ?? 0) + estimateCost(row.model_cd, Number(row.in_tokens), Number(row.out_tokens), prices));
    const jobsByDay = new Map(jobs.map((row) => [row.day, row.jobs]));
    const round = (value: number | null) => (value === null ? null : Math.round(value));
    const dailyOut = daily.map((row) => ({
      day: row.day,
      questions: jobsByDay.get(row.day) ?? 0,
      calls: row.calls,
      avgMs: round(row.avg_ms),
      p95Ms: round(row.p95_ms),
      errorRate: row.calls ? Number((row.errors / row.calls).toFixed(3)) : 0,
      externalShare: row.external + row.local ? Number((row.external / (row.external + row.local)).toFixed(3)) : null,
      fallbacks: row.fallbacks,
      estimatedCostUsd: Number((costByDay.get(row.day) ?? 0).toFixed(4)),
    }));

    const alerts: Alert[] = [];
    const last = window[0];
    const errorLimit = num('AURORE_ALERT_ERROR_RATE', 0.2);
    const slowLimit = num('AURORE_ALERT_P95_MS', 40_000);
    const fallbackLimit = num('AURORE_ALERT_FALLBACK_RATE', 0.5);
    const costLimit = num('AURORE_DAILY_COST_LIMIT_USD', 0);
    if (!status.reachable) alerts.push({ level: 'danger', code: 'AI_DOWN', message: 'AI 서버에 연결하지 못했어요.' });
    if (status.blockedKind) alerts.push({ level: 'danger', code: 'EXTERNAL_BLOCKED', message: `외부 모델을 쓸 수 없는 상태예요(${status.blockedKind}). 답변이 로컬 모델로 처리돼요.` });
    if (last && last.calls >= 5 && last.errors / last.calls > errorLimit) alerts.push({ level: 'warn', code: 'ERROR_RATE', message: `최근 1시간 호출 오류율이 ${Math.round((last.errors / last.calls) * 100)}%예요(기준 ${Math.round(errorLimit * 100)}%).` });
    if (last && last.calls >= 5 && (last.p95_ms ?? 0) > slowLimit) alerts.push({ level: 'warn', code: 'SLOW', message: `최근 1시간 응답이 느려요(P95 ${Math.round((last.p95_ms ?? 0) / 1000)}초, 기준 ${Math.round(slowLimit / 1000)}초).` });
    const attempts = last ? last.external + last.fallbacks : 0;
    if (last && attempts >= 3 && last.fallbacks / attempts > fallbackLimit) alerts.push({ level: 'warn', code: 'FALLBACK', message: `최근 1시간 외부 모델 호출 중 ${Math.round((last.fallbacks / attempts) * 100)}%가 로컬로 대신 처리됐어요.` });
    const today = dailyOut[0];
    if (costLimit > 0 && today && today.estimatedCostUsd > costLimit) alerts.push({ level: 'warn', code: 'COST', message: `오늘 추정 비용이 $${today.estimatedCostUsd.toFixed(2)}로 한도($${costLimit})를 넘었어요.` });

    return {
      days: span,
      daily: dailyOut,
      stages: stages.map((row) => ({ stage: row.stage_cd, calls: row.calls, errors: row.errors, avgMs: round(row.avg_ms), p95Ms: round(row.p95_ms) })),
      alerts,
      pricesAssumed: assumed,
      thresholds: { errorRate: errorLimit, p95Ms: slowLimit, fallbackRate: fallbackLimit, dailyCostUsd: costLimit || null },
    };
  }
}
