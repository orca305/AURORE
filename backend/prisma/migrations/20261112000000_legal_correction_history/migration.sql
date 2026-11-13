BEGIN;
CREATE TABLE legal_corr_hist (
 id UUID PRIMARY KEY,
 review_key VARCHAR(64) NOT NULL,
 user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 legal_ver_id BIGINT REFERENCES legal_ver(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 before_hash VARCHAR(64) NOT NULL,
 after_hash VARCHAR(64) NOT NULL,
 stat_cd VARCHAR(16) NOT NULL,
 result_cd VARCHAR(32) NOT NULL,
 rev_no INTEGER,
 affected_cnt INTEGER NOT NULL DEFAULT 0,
 rgst_dttm TIMESTAMPTZ(0) NOT NULL,
 end_dttm TIMESTAMPTZ(0) NOT NULL,
 CONSTRAINT ck_legal_corr_hist_hash CHECK (review_key ~ '^[a-f0-9]{64}$' AND before_hash ~ '^[a-f0-9]{64}$' AND after_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT ck_legal_corr_hist_result CHECK (
  (stat_cd='SUCCEEDED' AND result_cd='APPLIED' AND legal_ver_id IS NOT NULL AND rev_no IS NOT NULL AND rev_no > 0 AND before_hash<>after_hash)
  OR (stat_cd='FAILED' AND result_cd IN ('REVIEW_CHANGED','REVIEW_UNAVAILABLE','SOURCE_NOT_CONFIGURED','SOURCE_VERIFY_FAILED','APPLY_FAILED','PERMISSION_CHANGED') AND rev_no IS NULL)),
 CONSTRAINT ck_legal_corr_hist_bounds CHECK (end_dttm>=rgst_dttm AND affected_cnt>=0)
);
CREATE INDEX idx_legal_corr_hist_date ON legal_corr_hist(rgst_dttm DESC,id DESC);
CREATE INDEX idx_legal_corr_hist_version_hash ON legal_corr_hist(legal_ver_id,after_hash);
CREATE UNIQUE INDEX uq_legal_corr_hist_applied ON legal_corr_hist(legal_ver_id,after_hash) WHERE stat_cd='SUCCEEDED';
COMMIT;
