ALTER TABLE ai_job ADD COLUMN case_context JSONB;
ALTER TABLE ai_job ADD CONSTRAINT ck_ai_job_case_context CHECK (case_context IS NULL OR (jsonb_typeof(case_context)='object' AND case_context ?& ARRAY['caseId','revision','factIds','asOf','hash'] AND jsonb_typeof(case_context->'factIds')='array'));
