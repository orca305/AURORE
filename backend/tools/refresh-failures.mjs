export const refreshFailureMessages = {
  PLAN_FAILED: 'Change-list planning failed.',
  PREVIEW_FAILED: 'Source preview failed.',
  PREPARE_FAILED: 'Edition preparation failed.',
  REVIEW_FAILED: 'Correction preparation failed.',
  TOO_MANY_CANDIDATES: 'Split the collection date range before staging.',
  INCOMPLETE_REPORT: 'The staging report is incomplete.',
  EDITION_CONFLICT: 'An edition conflict needs review.',
  STAGING_FAILED:
    'Source staging failed. Check the collector and source availability.',
};
export function safeRefreshFailure(value) {
  const code =
    typeof value?.code === 'string' &&
    Object.hasOwn(refreshFailureMessages, value.code)
      ? value.code
      : 'STAGING_FAILED';
  return { code, message: refreshFailureMessages[code] };
}
