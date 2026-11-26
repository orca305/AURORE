import { describe, expect, it } from 'vitest';
import { readAnswerStream } from './answer-stream.js';
import { previewOf, reportPreview, reportStage, runWithJobStage, stageOf } from './job-stage.js';

const body = (...chunks: Uint8Array[]) =>
  new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }));

describe('readAnswerStream', () => {
  it('announces the conclusion before the result, even when a chunk splits a Korean character', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ conclusion: '네, 청구할 수 있어요.' }) + '\n' + JSON.stringify({ result: { verified: true }, calls: '[]' }) + '\n',
    );
    const seen: string[] = [];
    const out = await readAnswerStream(body(bytes.slice(0, 17), bytes.slice(17)), (text) => seen.push(text));
    expect(seen).toEqual(['네, 청구할 수 있어요.']);
    expect(out).toEqual({ result: { verified: true }, calls: '[]' });
  });

  it('returns no result when the server reports an error', async () => {
    const out = await readAnswerStream(body(new TextEncoder().encode('{"error":502,"calls":null}\n')), () => {});
    expect(out).toEqual({ result: null, calls: null });
  });
});

describe('answer preview', () => {
  it('is kept per job while it runs and removed when it ends', async () => {
    await runWithJobStage('job-1', async () => {
      reportStage('write');
      reportPreview('먼저 보여 줄 결론');
      expect(previewOf('job-1')).toBe('먼저 보여 줄 결론');
      expect(stageOf('job-1')).toBe('write');
    });
    expect(previewOf('job-1')).toBeNull();
  });
});
