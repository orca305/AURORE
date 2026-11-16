BEGIN;
CREATE TABLE legal_prec_ingest_hist (
 id uuid PRIMARY KEY,
 batch_key varchar(64) NOT NULL CHECK (batch_key ~ '^[a-f0-9]{64}$'),
 source_key varchar(12) NOT NULL CHECK (source_key ~ '^[1-9][0-9]{0,11}$'),
 user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 before_hash varchar(64) CHECK (before_hash ~ '^[a-f0-9]{64}$'),
 after_hash varchar(64) NOT NULL CHECK (after_hash ~ '^[a-f0-9]{64}$'),
 stat_cd varchar(16) NOT NULL CHECK (stat_cd IN ('SUCCEEDED','FAILED')),
 result_cd varchar(32) NOT NULL CHECK (result_cd IN ('APPLIED','UNCHANGED','FORMAT_ONLY','PREVIOUSLY_SEEN','REVIEW_UNAVAILABLE','REVIEW_CHANGED','SOURCE_NOT_CONFIGURED','SOURCE_VERIFY_FAILED','PERMISSION_CHANGED','APPLY_FAILED')),
 rev_no integer CHECK (rev_no > 0),
 rgst_dttm timestamptz(0) NOT NULL,
 end_dttm timestamptz(0) NOT NULL CHECK (end_dttm >= rgst_dttm),
 CHECK ((stat_cd = 'SUCCEEDED' AND rev_no IS NOT NULL AND result_cd IN ('APPLIED','UNCHANGED','FORMAT_ONLY','PREVIOUSLY_SEEN')) OR (stat_cd = 'FAILED' AND rev_no IS NULL AND result_cd IN ('REVIEW_UNAVAILABLE','REVIEW_CHANGED','SOURCE_NOT_CONFIGURED','SOURCE_VERIFY_FAILED','PERMISSION_CHANGED','APPLY_FAILED')))
);
CREATE INDEX idx_legal_prec_ingest_hist_date ON legal_prec_ingest_hist(rgst_dttm DESC,id DESC);
COMMIT;
