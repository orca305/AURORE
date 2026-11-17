BEGIN;
ALTER TABLE legal_term ADD COLUMN src_cd VARCHAR(20) NOT NULL DEFAULT 'MANUAL',ADD COLUMN src_key VARCHAR(30),ADD COLUMN src_hash VARCHAR(64),ADD COLUMN src_snapshot_id BIGINT REFERENCES src_snapshot(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE legal_term ALTER COLUMN src_ref TYPE TEXT;
ALTER TABLE legal_term ADD CONSTRAINT ck_legal_term_source_ref CHECK(src_ref IS NULL OR char_length(src_ref)<=4000),ADD CONSTRAINT ck_legal_term_origin CHECK((src_cd='MANUAL' AND src_key IS NULL AND src_hash IS NULL AND src_snapshot_id IS NULL) OR (src_cd='MOLEG_TERM' AND src_key IS NOT NULL AND src_hash IS NOT NULL AND src_key ~ '^[1-9][0-9]{0,11}$' AND src_hash ~ '^[a-f0-9]{64}$' AND src_snapshot_id IS NOT NULL));
DROP INDEX uq_legal_term_active_name;
CREATE UNIQUE INDEX uq_legal_term_active_name ON legal_term(norm_nm) WHERE NOT del_yn AND src_cd='MANUAL';
CREATE UNIQUE INDEX uq_legal_term_source ON legal_term(src_cd,src_key);
ALTER TABLE legal_term_hist ADD COLUMN src_snapshot_id BIGINT REFERENCES src_snapshot(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE legal_term_hist DROP CONSTRAINT legal_term_hist_act_cd_check,DROP CONSTRAINT ck_legal_term_hist_data;
ALTER TABLE legal_term_hist ADD CONSTRAINT ck_legal_term_hist_action CHECK(act_cd IN ('CREATE','UPDATE','PUBLISH','DELETE','IMPORT')),
 ADD CONSTRAINT ck_legal_term_hist_source CHECK(act_cd<>'IMPORT' OR src_snapshot_id IS NOT NULL),
 ADD CONSTRAINT ck_legal_term_hist_data CHECK(jsonb_typeof(af_data)='object' AND ((act_cd IN ('CREATE','IMPORT') AND bf_data IS NULL) OR (act_cd IN ('UPDATE','PUBLISH','DELETE','IMPORT') AND bf_data IS NOT NULL AND jsonb_typeof(bf_data)='object')));
COMMIT;
