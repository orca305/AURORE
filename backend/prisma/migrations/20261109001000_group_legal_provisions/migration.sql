BEGIN;

ALTER TABLE legal_provi ADD COLUMN src_parts JSONB;
ALTER TABLE legal_provi ADD CONSTRAINT ck_legal_provi_src_parts CHECK (
  src_parts IS NULL OR CASE
    WHEN jsonb_typeof(src_parts) = 'array' THEN jsonb_array_length(src_parts) > 0
    ELSE false
  END
);

COMMIT;
