export async function classifyQuestion(question: string, base: URL | string) {
  if (process.env.AURORE_INTENT_CLASSIFY !== '1') return null;
  try {
    const origin = new URL(base);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      return null;
    const response = await fetch(new URL('/intent/classify', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.length > 2000) return null;
    const value = JSON.parse(body) as {
      route?: string;
      label?: string;
      score?: number;
      modelVersion?: string;
      evaluationEligible?: boolean;
      routingEnabled?: boolean;
    };
    if (
      !value ||
      value.evaluationEligible !== true ||
      value.routingEnabled !== true ||
      !['GENERAL', 'LEGAL', 'CLARIFY'].includes(value.route ?? '') ||
      !['GENERAL', 'LEGAL', 'CLARIFY'].includes(value.label ?? '') ||
      (value.route !== 'CLARIFY' && value.route !== value.label) ||
      typeof value.score !== 'number' ||
      !Number.isFinite(value.score) ||
      value.score < 0 ||
      value.score > 1 ||
      typeof value.modelVersion !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.modelVersion)
    )
      return null;
    // A generic/uncertain classification cannot override an explicit legal cue.
    if (
      value.route !== 'LEGAL' &&
      /법률|법적|법원|판례|소송|계약|보증금|임대|임차|권리|고소|해고|임금|상속|이혼|손해배상/u.test(
        question,
      )
    )
      return 'LEGAL';
    return value.route as 'GENERAL' | 'LEGAL' | 'CLARIFY';
  } catch {
    // Classifier failure never disables the existing source search or verified examples.
    return null;
  }
}
