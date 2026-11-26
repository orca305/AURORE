/** AI 서버의 /legal/answer-stream 응답(한 줄에 JSON 하나): 결론이 먼저 오고 마지막 줄에 전체 결과나 오류가 온다. */
export async function readAnswerStream(
  response: Response,
  onConclusion: (text: string) => void,
): Promise<{ result: unknown; calls: string | null }> {
  if (!response.body) return { result: null, calls: null };
  const decoder = new TextDecoder();
  let pending = '';
  let total = 0;
  let result: unknown = null;
  let calls: string | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    const value = JSON.parse(line) as { conclusion?: unknown; result?: unknown; calls?: unknown };
    if (typeof value.conclusion === 'string') onConclusion(value.conclusion.slice(0, 300));
    if (value.result !== undefined) result = value.result;
    if (typeof value.calls === 'string') calls = value.calls;
  };
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > 200_000) throw new Error('DocumentAiResponseLimit');
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(take);
  }
  take(pending + decoder.decode());
  return { result, calls };
}
