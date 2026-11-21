import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModelService, allowedModels } from './admin-model.service.js';
import type { AdminGuard } from './admin.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type Hist = { id: bigint; modelCd: string; prevModelCd: string | null };

function setup(history: Hist[] = []) {
  const created: Record<string, unknown>[] = [];
  const hist = {
    findFirst: vi.fn(async () => history[0] ?? null),
    findMany: vi.fn(async () => history.map((row) => ({ ...row, kindCd: 'CHANGE', reason: '사유', rgstDttm: new Date('2026-11-22T00:00:00Z'), actor: { loginId: 'admin' } }))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      created.push(data);
      return data;
    }),
  };
  const tx = { $executeRaw: vi.fn(async () => 1), aiModelHist: hist };
  const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), aiModelHist: hist } as unknown as PrismaService;
  const access = { require: vi.fn(async () => ({ id: '5', loginId: 'admin' })) } as unknown as AdminGuard;
  return { service: new AdminModelService(db, access), created, hist };
}

let selected = 'claude-haiku-5-5';
let pushes: string[] = [];
let aiDown = false;
let rejectPush = false;

beforeEach(() => {
  selected = 'claude-haiku-5-5';
  pushes = [];
  aiDown = false;
  rejectPush = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (aiDown) throw new Error('down');
    if (path === '/legal/status') return new Response(JSON.stringify({ selectedModel: selected, overridden: false }));
    if (path === '/legal/model') {
      if (rejectPush) return new Response('{}', { status: 422 });
      selected = JSON.parse(String(init?.body)).model;
      pushes.push(selected);
      return new Response('{}');
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AURORE_ALLOWED_MODELS;
});

describe('allowedModels', () => {
  it('기본 목록에 로컬이 항상 들어가고 이상한 이름은 거른다', () => {
    expect(allowedModels()).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'LOCAL']);
    process.env.AURORE_ALLOWED_MODELS = 'claude-sonnet-5-5, bad name!, claude-sonnet-5-5';
    expect(allowedModels()).toEqual(['claude-sonnet-5-5', 'LOCAL']);
  });
});

describe('AdminModelService.apply', () => {
  it('허용된 모델로 바꾸면 AI 서버에 반영하고 처리자·사유·이전 모델을 이력에 남긴다', async () => {
    const { service, created } = setup();
    const result = await service.apply({ model: 'claude-sonnet-5-5', reason: '  답변 품질 비교  ' }, 'Bearer x', 'CHANGE');
    expect(result).toMatchObject({ model: 'claude-sonnet-5-5', previousModel: 'claude-haiku-5-5', kind: 'CHANGE' });
    expect(pushes).toEqual(['claude-sonnet-5-5']);
    expect(created).toEqual([{ modelCd: 'claude-sonnet-5-5', prevModelCd: 'claude-haiku-5-5', kindCd: 'CHANGE', actorUserId: 5n, reason: '답변 품질 비교' }]);
  });

  it('허용 목록 밖 모델과 빈 사유는 거절하고 아무것도 바꾸지 않는다', async () => {
    const { service, created } = setup();
    await expect(service.apply({ model: 'claude-opus-5-5', reason: '시험' }, 'Bearer x', 'CHANGE')).rejects.toThrow('허용된 모델');
    await expect(service.apply({ model: 'LOCAL', reason: '   ' }, 'Bearer x', 'CHANGE')).rejects.toThrow('교체 사유');
    expect(pushes).toEqual([]);
    expect(created).toEqual([]);
  });

  it('AI 서버에 연결하지 못하거나 반영이 거절되면 이력도 남기지 않는다', async () => {
    const down = setup();
    aiDown = true;
    await expect(down.service.apply({ model: 'LOCAL', reason: '시험' }, 'Bearer x', 'CHANGE')).rejects.toThrow('연결하지 못해서');
    expect(down.created).toEqual([]);
    aiDown = false;
    rejectPush = true;
    const rejected = setup();
    await expect(rejected.service.apply({ model: 'LOCAL', reason: '시험' }, 'Bearer x', 'CHANGE')).rejects.toThrow('반영하지 못해서');
    expect(rejected.created).toEqual([]);
  });

  it('이미 쓰는 모델로 바꾸려 하면 거절한다', async () => {
    const { service } = setup([{ id: 1n, modelCd: 'claude-haiku-5-5', prevModelCd: null }]);
    await expect(service.apply({ model: 'claude-haiku-5-5', reason: '시험' }, 'Bearer x', 'CHANGE')).rejects.toThrow('이미');
  });

  it('이력을 남기지 못하면 AI 서버를 원래 모델로 되돌린다', async () => {
    const { service, hist } = setup();
    hist.create.mockRejectedValueOnce(new Error('db'));
    await expect(service.apply({ model: 'LOCAL', reason: '시험' }, 'Bearer x', 'CHANGE')).rejects.toThrow('db');
    expect(pushes).toEqual(['LOCAL', 'claude-haiku-5-5']);
  });

  it('롤백은 직전 모델로 되돌리고 새 이력 행으로 남긴다. 이전 모델이 없으면 거절한다', async () => {
    selected = 'claude-sonnet-5-5';
    const { service, created } = setup([{ id: 2n, modelCd: 'claude-sonnet-5-5', prevModelCd: 'claude-haiku-5-5' }]);
    const result = await service.apply({ reason: '품질 저하' }, 'Bearer x', 'ROLLBACK');
    expect(result).toMatchObject({ model: 'claude-haiku-5-5', previousModel: 'claude-sonnet-5-5', kind: 'ROLLBACK' });
    expect(pushes).toEqual(['claude-haiku-5-5']);
    expect(created[0]).toMatchObject({ kindCd: 'ROLLBACK', modelCd: 'claude-haiku-5-5', prevModelCd: 'claude-sonnet-5-5' });

    const none = setup([{ id: 1n, modelCd: 'claude-haiku-5-5', prevModelCd: null }]);
    await expect(none.service.apply({ reason: '시험' }, 'Bearer x', 'ROLLBACK')).rejects.toThrow('이전 모델이 없어요');
  });
});

describe('AdminModelService.settings', () => {
  it('허용 목록, 현재 설정, AI 서버가 실제로 쓰는 모델, 이력을 알려 준다', async () => {
    selected = 'claude-haiku-5-5';
    const { service } = setup([{ id: 2n, modelCd: 'claude-sonnet-5-5', prevModelCd: 'claude-haiku-5-5' }]);
    const settings = await service.settings();
    expect(settings).toMatchObject({ current: 'claude-sonnet-5-5', effective: 'claude-haiku-5-5', reachable: true, inSync: false, canRollback: true });
    expect(settings.history[0]).toMatchObject({ model: 'claude-sonnet-5-5', actor: 'admin', kind: 'CHANGE' });
    expect(JSON.stringify(settings)).not.toMatch(/api[-_ ]?key/iu);
  });
});
