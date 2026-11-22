import { AsyncLocalStorage } from 'node:async_hooks';

// 답변 작업의 진행 단계(화면의 "지금 하는 일" 표시용). 이 프로세스 메모리에만 두고, 질문·답변 내용은 담지 않는다.
// 작업이 끝나면 지우고, 오래 남은 값은 자동으로 정리한다.
export type JobStage = 'analyze' | 'search' | 'write';

const current = new AsyncLocalStorage<string>();
const stages = new Map<string, { stage: JobStage; at: number }>();
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
  stages.set(jobId, { stage, at: now });
  if (stages.size > 200) for (const [id, value] of stages) if (now - value.at > KEEP_MS) stages.delete(id);
}

export function stageOf(jobId: string): JobStage | null {
  return stages.get(jobId)?.stage ?? null;
}
