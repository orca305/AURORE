BEGIN;
CREATE TABLE legal_term(
 id BIGSERIAL PRIMARY KEY,term_nm VARCHAR(100) NOT NULL,norm_nm VARCHAR(100) NOT NULL,aliases TEXT[] NOT NULL DEFAULT '{}',
 def_cont TEXT NOT NULL,easy_cont TEXT,src_nm VARCHAR(200) NOT NULL,src_url VARCHAR(2000) NOT NULL,src_ref VARCHAR(300),
 stat_cd VARCHAR(16) NOT NULL DEFAULT 'DRAFT',rev_no INTEGER NOT NULL DEFAULT 1,pub_dttm TIMESTAMPTZ(0),
 del_yn BOOLEAN NOT NULL DEFAULT false,del_dttm TIMESTAMPTZ(0),del_id BIGINT,
 rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT date_trunc('second',now()),upt_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT date_trunc('second',now()),
 CONSTRAINT ck_legal_term_text CHECK(char_length(btrim(term_nm)) BETWEEN 1 AND 100 AND char_length(btrim(norm_nm)) BETWEEN 1 AND 100 AND char_length(btrim(def_cont)) BETWEEN 1 AND 10000 AND (easy_cont IS NULL OR char_length(btrim(easy_cont)) BETWEEN 1 AND 8000) AND char_length(btrim(src_nm)) BETWEEN 1 AND 200),
 CONSTRAINT ck_legal_term_source CHECK(src_url ~ '^https://[^[:space:]]+$'),
 CONSTRAINT ck_legal_term_aliases CHECK(cardinality(aliases)<=20 AND (cardinality(aliases)=0 OR array_ndims(aliases)=1) AND array_position(aliases,NULL) IS NULL),
 CONSTRAINT ck_legal_term_state CHECK(stat_cd IN ('DRAFT','PUBLISHED') AND rev_no>0 AND ((stat_cd='PUBLISHED')=(pub_dttm IS NOT NULL))),
 CONSTRAINT ck_legal_term_deleted CHECK((NOT del_yn AND del_dttm IS NULL AND del_id IS NULL) OR (del_yn AND del_dttm IS NOT NULL AND del_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_legal_term_active_name ON legal_term(norm_nm) WHERE NOT del_yn;
CREATE INDEX idx_legal_term_list ON legal_term(stat_cd,del_yn,upt_dttm DESC,id DESC);
CREATE TABLE legal_term_hist(
 id UUID PRIMARY KEY,legal_term_id BIGINT NOT NULL REFERENCES legal_term(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 actor_user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,rev_no INTEGER NOT NULL CHECK(rev_no>0),
 act_cd VARCHAR(16) NOT NULL CHECK(act_cd IN ('CREATE','UPDATE','PUBLISH','DELETE')),request_hash VARCHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 bf_data JSONB,af_data JSONB NOT NULL,rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT date_trunc('second',now()),
 CONSTRAINT uq_legal_term_hist_revision UNIQUE(legal_term_id,rev_no),
 CONSTRAINT ck_legal_term_hist_data CHECK(jsonb_typeof(af_data)='object' AND ((act_cd='CREATE' AND bf_data IS NULL) OR (act_cd<>'CREATE' AND bf_data IS NOT NULL AND jsonb_typeof(bf_data)='object')))
);
CREATE INDEX idx_legal_term_hist_actor ON legal_term_hist(actor_user_id);
COMMIT;
