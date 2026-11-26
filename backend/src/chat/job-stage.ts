import { AsyncLocalStorage } from 'node:async_hooks';

// 답변 작업의 진행 단계(화면의 "지금 하는 일" 표시용)와, 답이 완성되기 전에 먼저 보여 줄 결론 문장.
// 이 프로세스 메모리에만 두고(DB에 저장하지 않는다) 작업이 끝나면 지우며, 오래 남은 값은 자동으로 정리한다.
export type JobStage = 'analyze' | 'search' | 'write';

const current = new AsyncLocalStorage<string>();
const stages = new Map<string, { stage: JobStage; at: number; preview?: string }>();
const KEEP_MS = 10 * 60 * 1000;

/** 이 함수 안에서 일어나는 모든 비동기 작업은 같은 작업 id 로 단계를 남긴다. */
export function runWithJobStage<T>(jobId: string, run: () => Promise<T>): Promise<T> {
  return current.run(jobId, async () => {
    try {
      return await run();
    } finally {
      stages.delete(jobId);
    }
  });
}

export function reportStage(stage: JobStage) {
  const jobId = current.getStore();
  if (!jobId) return;
  const now = Date.now();
  stages.set(jobId, { ...stages.get(jobId), stage, at: now });
  if (stages.size > 200) for (const [id, value] of stages) if (now - value.at > KEEP_MS) stages.delete(id);
}

/** 지금 도는 답변 작업이 있는가(결론을 먼저 받아 보여 줄 화면이 있는가). */
export const inJob = () => current.getStore() !== undefined;

export function reportPreview(preview: string) {
  const jobId = current.getStore();
  if (!jobId || !preview) return;
  stages.set(jobId, { stage: 'write', at: Date.now(), preview });
}

export function previewOf(jobId: string): string | null {
  return stages.get(jobId)?.preview ?? null;
}

export function stageOf(jobId: string): JobStage | null {
  return stages.get(jobId)?.stage ?? null;
}
