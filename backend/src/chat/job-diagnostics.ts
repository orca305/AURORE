export const JOB_RESULT_CODES = [
  'EVIDENCE_FOUND',
  'SOURCE_GAP',
  'RELEVANCE_GAP',
  'DOCUMENT_GAP',
  'AI_NOT_READY',
  'FACTS_UNCONFIRMED',
  'SOURCE_CHANGED',
  'GUIDANCE',
] as const;
export type JobResultCode = (typeof JOB_RESULT_CODES)[number];
export const JOB_ERROR_CODES = [
  'CASE_CONTEXT_CHANGED',
  'GENERATION_FAILED',
  'TOTAL_TIMEOUT',
  'ATTEMPTS_EXHAUSTED',
  'AI_UNAVAILABLE',
  'AI_CONFIGURATION',
  'AI_UPSTREAM_FAILURE',
  'EVIDENCE_INVALID',
  'SOURCE_UNAVAILABLE',
] as const;
export function generationErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'CaseContextChanged') return 'CASE_CONTEXT_CHANGED';
  if (message === 'DocumentAiUnavailable') return 'AI_UNAVAILABLE';
  if (message === 'DocumentAiUpstreamFailure') return 'AI_UPSTREAM_FAILURE';
  if (message === 'DocumentAiMustBeLocal') return 'AI_CONFIGURATION';
  if (
    [
      'DocumentEvidenceInvalid',
      'DocumentQuoteMismatch',
      'DocumentQuoteDuplicate',
      'DocumentAiResponseLimit',
    ].includes(message)
  )
    return 'EVIDENCE_INVALID';
  if (['DocumentUnavailable', 'DocumentContextLimit'].includes(message))
    return 'SOURCE_UNAVAILABLE';
  return 'GENERATION_FAILED';
}
