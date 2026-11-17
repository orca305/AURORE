BEGIN;
ALTER TABLE legal_prec_rev ADD CONSTRAINT uq_legal_prec_rev_id_target UNIQUE(id,legal_prec_id);
ALTER TABLE legal_chg_evt ALTER COLUMN legal_id DROP NOT NULL,ALTER COLUMN legal_ver_id DROP NOT NULL,ALTER COLUMN src_rev_id DROP NOT NULL;
ALTER TABLE legal_chg_evt ADD COLUMN legal_prec_id bigint REFERENCES legal_prec(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD COLUMN src_prec_rev_id bigint, ADD COLUMN bf_prec_rev_id bigint;
ALTER TABLE legal_chg_evt ADD CONSTRAINT fk_legal_chg_evt_prec_source FOREIGN KEY(src_prec_rev_id,legal_prec_id) REFERENCES legal_prec_rev(id,legal_prec_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT fk_legal_chg_evt_prec_before FOREIGN KEY(bf_prec_rev_id,legal_prec_id) REFERENCES legal_prec_rev(id,legal_prec_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE legal_chg_evt DROP CONSTRAINT legal_chg_evt_check1;
ALTER TABLE legal_chg_evt ADD CONSTRAINT ck_legal_chg_evt_target CHECK(
 (legal_id IS NOT NULL AND legal_ver_id IS NOT NULL AND src_rev_id IS NOT NULL AND legal_prec_id IS NULL AND src_prec_rev_id IS NULL AND bf_prec_rev_id IS NULL AND
  ((evt_type_cd='CORRECTED' AND bf_rev_id IS NOT NULL AND bf_rev_id<>src_rev_id AND scope_cd='VERSION') OR (evt_type_cd<>'CORRECTED' AND bf_rev_id IS NULL)))
 OR
 (legal_id IS NULL AND legal_ver_id IS NULL AND src_rev_id IS NULL AND bf_rev_id IS NULL AND legal_prec_id IS NOT NULL AND src_prec_rev_id IS NOT NULL AND bf_prec_rev_id IS NOT NULL AND src_prec_rev_id<>bf_prec_rev_id AND evt_type_cd='CORRECTED' AND scope_cd='VERSION')
);
CREATE INDEX idx_legal_chg_evt_prec_date ON legal_chg_evt(legal_prec_id,evt_dttm,id);
COMMIT;
