import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminGuard } from './admin.guard.js';

export const LOCAL_MODEL = 'LOCAL';

/** 운영자가 고를 수 있는 모델(AURORE_ALLOWED_MODELS, 쉼표 구분) + 로컬. API 키는 환경변수로만 두고 화면에서 입력하지 않는다. */
export function allowedModels(): string[] {
  const raw = process.env.AURORE_ALLOWED_MODELS ?? 'claude-haiku-5-5,claude-sonnet-5-5';
  const external = raw.split(',').map((model) => model.trim()).filter((model) => /^[A-Za-z0-9._-]{1,60}$/u.test(model));
  return [...new Set([...external, LOCAL_MODEL])];
}

type AiStatus = { selectedModel?: string; overridden?: boolean } | null;

/**
 * AI 답변 모델 교체. 현재 설정은 변경 이력(ai_model_hist)의 가장 최근 행이고, AI 서버에 바로 반영한다.
 * 이력은 추가만 한다(롤백도 이전 모델을 새 행으로 남긴다). AI 서버에 반영하지 못하면 이력도 남기지 않는다.
 */
@Injectable()
export class AdminModelService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminModelService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly access: AdminGuard,
  ) {}

  /** 서버를 켤 때 마지막으로 정한 모델을 AI 서버에 다시 알려 준다(AI 서버가 먼저 다시 켜졌어도 DB 설정을 따른다). */
  async onApplicationBootstrap() {
    if (process.env.VITEST) return;
    const latest = await this.db.aiModelHist.findFirst({ orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }], select: { modelCd: true } }).catch(() => null);
    if (!latest || !allowedModels().includes(latest.modelCd)) return;
    await this.push(latest.modelCd).catch((error) => this.logger.warn('AI model sync skipped: ' + (error instanceof Error ? error.name : 'error')));
  }

  private aiUrl(path: string) {
    const url = new URL(path, process.env.AURORE_AI_URL || 'http://127.0.0.1:8000');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new ServiceUnavailableException('AI 서버 주소가 올바르지 않아요.');
    return url;
  }

  private async status(): Promise<AiStatus> {
    try {
      const response = await fetch(this.aiUrl('/legal/status'), { signal: AbortSignal.timeout(3000), redirect: 'error' });
      return response.ok ? ((await response.json()) as AiStatus) : null;
    } catch {
      return null;
    }
  }

  private async push(model: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.AURORE_AI_ADMIN_TOKEN) headers['x-aurore-admin-token'] = process.env.AURORE_AI_ADMIN_TOKEN;
    const response = await fetch(this.aiUrl('/legal/model'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('AiRejected');
  }

  private async latest(client: Pick<PrismaService, 'aiModelHist'> = this.db) {
    return client.aiModelHist.findFirst({ orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }], select: { id: true, modelCd: true, prevModelCd: true } });
  }

  async settings() {
    const [history, status] = await Promise.all([
      this.db.aiModelHist.findMany({
        orderBy: [{ rgstDttm: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, modelCd: true, prevModelCd: true, kindCd: true, reason: true, rgstDttm: true, actor: { select: { loginId: true } } },
      }),
      this.status(),
    ]);
    const effective = typeof status?.selectedModel === 'string' ? status.selectedModel.slice(0, 60) : null;
    const current = history[0]?.modelCd ?? null;
    return {
      allowed: allowedModels(),
      current,
      effective,
      reachable: status !== null,
      inSync: current === null || effective === current,
      canRollback: Boolean(history[0]?.prevModelCd),
      history: history.map((row) => ({
        id: row.id.toString(),
        model: row.modelCd,
        previousModel: row.prevModelCd,
        kind: row.kindCd,
        reason: row.reason,
        actor: row.actor.loginId,
        at: row.rgstDttm.toISOString(),
      })),
    };
  }

  private cleanReason(value: string) {
    const reason = value.normalize('NFC').trim();
    if (!reason || reason.length > 500 || /[\p{Cc}\p{Surrogate}]/u.test(reason.replace(/[\r\n\t]/g, '')))
      throw new BadRequestException('교체 사유를 1~500자로 입력해 주세요.');
    return reason;
  }

  /** 모델을 바꾼다(kind=CHANGE) 또는 직전 모델로 되돌린다(kind=ROLLBACK, model 생략). */
  async apply(input: { model?: string; reason: string }, authorization: string | undefined, kind: 'CHANGE' | 'ROLLBACK') {
    const reason = this.cleanReason(input.reason);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aurore-ai-model'))`;
        const actor = await this.access.require(authorization, tx);
        const latest = await this.latest(tx as unknown as PrismaService);
        const status = await this.status();
        if (!status) throw new ConflictException('AI 서버에 연결하지 못해서 모델을 바꿀 수 없어요.');
        const before = latest?.modelCd ?? (typeof status.selectedModel === 'string' ? status.selectedModel : null);
        if (!before) throw new ConflictException('현재 모델을 확인하지 못했어요.');
        let target: string;
        if (kind === 'ROLLBACK') {
          if (!latest?.prevModelCd) throw new ConflictException('되돌릴 이전 모델이 없어요.');
          target = latest.prevModelCd;
        } else {
          target = (input.model ?? '').trim();
        }
        if (!allowedModels().includes(target)) throw new BadRequestException('허용된 모델 목록에 없는 모델이에요.');
        if (target === before && status.selectedModel === target) throw new ConflictException('이미 이 모델을 쓰고 있어요.');
        try {
          await this.push(target);
        } catch {
          throw new ConflictException('AI 서버에 반영하지 못해서 바꾸지 않았어요.');
        }
        try {
          await tx.aiModelHist.create({ data: { modelCd: target, prevModelCd: before, kindCd: kind, actorUserId: BigInt(actor.id), reason } });
        } catch (error) {
          await this.push(before).catch(() => undefined); // 이력을 남기지 못하면 AI 서버도 원래대로 돌린다
          throw error;
        }
        return { model: target, previousModel: before, kind };
      },
      { timeout: 20000 },
    );
  }
}
