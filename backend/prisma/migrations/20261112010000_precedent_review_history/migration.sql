CREATE TABLE legal_prec_review_hist (
 id UUID PRIMARY KEY,
 request_hash VARCHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 prior_ref_id BIGINT NOT NULL REFERENCES legal_prec_provi(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 next_ref_id BIGINT NOT NULL REFERENCES legal_prec_provi(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 decision VARCHAR(16) NOT NULL CHECK (decision IN ('VERIFIED','UNVERIFIED')),
 reason VARCHAR(2000) NOT NULL CHECK (length(trim(reason))>0),
 rgst_dttm TIMESTAMPTZ(0) NOT NULL,
 CONSTRAINT uq_legal_prec_review_prior UNIQUE(prior_ref_id),
 CHECK (prior_ref_id<>next_ref_id)
);
CREATE INDEX idx_legal_prec_review_date ON legal_prec_review_hist(rgst_dttm DESC,id DESC);
