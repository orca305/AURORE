BEGIN;
ALTER TABLE ans_cite DROP CONSTRAINT ck_ans_cite_verification;
ALTER TABLE ans_cite ADD CONSTRAINT ck_ans_cite_verification CHECK (btrim(cite_cont) <> '' AND quote_verify_cd='MATCHED' AND support_verify_cd IN ('REVIEWED_DEMO','MODEL_REVIEWED','UNREVIEWED'));
COMMIT;
