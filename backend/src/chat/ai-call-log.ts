import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * AI 서버가 응답 헤더(X-Aurore-Calls)로 알려 주는 모델 호출 기록을 ai_call_log 에 쌓는다(모니터링용).
 * 내용(질문·원문·답변)은 받지도 저장하지도 않는다. 값은 모두 형식을 검사하고, 저장에 실패해도 답변에는 영향이 없다.
 */
export type AiCallRecord = {
  stageCd: string;
  providerCd: 'external' | 'local';
  modelCd: string;
  latencyMs: number;
  inTokens: number | null;
  outTokens: number | null;
  outcomeCd: 'OK' | 'FALLBACK' | 'ERROR';
  errCd: string | null;
};

const count = (value: unknown, max: number) => (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max ? (value as number) : null);

export function parseAiCalls(header: string | null | undefined): AiCallRecord[] {
  if (!header || header.length > 4000) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(header);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: AiCallRecord[] = [];
  for (const item of raw.slice(0, 12) as Record<string, unknown>[]) {
    const provider = item?.provider;
    const outcome = item?.outcome;
    const latency = count(item?.ms, 3_600_000);
    const stage = typeof item?.stage === 'string' && /^[a-z_]{1,20}$/u.test(item.stage) ? item.stage : null;
    if ((provider !== 'external' && provider !== 'local') || (outcome !== 'OK' && outcome !== 'FALLBACK' && outcome !== 'ERROR') || latency === null || !stage) continue;
    const model = typeof item.model === 'string' && /^[A-Za-z0-9._:-]{1,60}$/u.test(item.model) ? item.model : provider === 'local' ? 'local' : 'unknown';
    out.push({
      stageCd: stage,
      providerCd: provider,
      modelCd: model,
      latencyMs: latency,
      inTokens: count(item.in, 10_000_000),
      outTokens: count(item.out, 10_000_000),
      outcomeCd: outcome,
      errCd: typeof item.error === 'string' && /^[A-Za-z0-9_]{1,30}$/u.test(item.error) ? item.error : null,
    });
  }
  return out;
}

export async function recordAiCalls(db: PrismaService, header: string | null | undefined): Promise<void> {
  if (process.env.AURORE_CALL_LOG === '0') return;
  const rows = parseAiCalls(header);
  if (!rows.length) return;
  try {
    await db.aiCallLog.createMany({ data: rows });
  } catch {
    // 모니터링 기록 실패는 답변에 영향을 주지 않는다.
  }
}
