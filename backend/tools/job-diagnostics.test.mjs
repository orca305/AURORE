import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generationErrorCode,
  JOB_ERROR_CODES,
  JOB_RESULT_CODES,
} from '../dist/chat/job-diagnostics.js';
test('operational diagnostics expose only known codes and never exception text', () => {
  assert.equal(
    generationErrorCode(new Error('DocumentQuoteMismatch')),
    'EVIDENCE_INVALID',
  );
  assert.equal(
    generationErrorCode(new Error('DocumentAiUnavailable')),
    'AI_UNAVAILABLE',
  );
  assert.equal(
    generationErrorCode(new Error('DocumentAiUpstreamFailure')),
    'AI_UPSTREAM_FAILURE',
  );
  assert.equal(
    generationErrorCode(new Error('DocumentAiMustBeLocal')),
    'AI_CONFIGURATION',
  );
  assert.equal(
    generationErrorCode(new Error('CaseContextChanged')),
    'CASE_CONTEXT_CHANGED',
  );
  assert.equal(
    generationErrorCode(new Error('PRIVATE_CANARY')),
    'GENERATION_FAILED',
  );
  assert.ok(
    !JSON.stringify([JOB_ERROR_CODES, JOB_RESULT_CODES]).includes(
      'PRIVATE_CANARY',
    ),
  );
});
