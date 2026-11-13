BEGIN;
CREATE TABLE user_case (
 id UUID PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 case_nm VARCHAR(80) NOT NULL CHECK(char_length(btrim(case_nm)) BETWEEN 1 AND 80),
 case_type_cd_id BIGINT NOT NULL REFERENCES cmmn_cd(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 rev_no INTEGER NOT NULL DEFAULT 1 CHECK(rev_no>0),del_yn BOOLEAN NOT NULL DEFAULT false,del_dttm TIMESTAMPTZ(0),del_id BIGINT,
 rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,upt_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_user_case_owner UNIQUE(id,user_id),
 CONSTRAINT ck_user_case_delete CHECK((NOT del_yn AND del_dttm IS NULL AND del_id IS NULL) OR (del_yn AND del_dttm IS NOT NULL AND del_id IS NOT NULL AND del_id=user_id))
);
CREATE INDEX idx_user_case_list ON user_case(user_id,del_yn,upt_dttm DESC,id DESC);
CREATE TABLE case_fact (
 id BIGSERIAL PRIMARY KEY,user_case_id UUID NOT NULL REFERENCES user_case(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 fact_type_cd_id BIGINT NOT NULL REFERENCES cmmn_cd(id) ON DELETE RESTRICT ON UPDATE RESTRICT,fact_val JSONB NOT NULL,
 verify_stat_cd VARCHAR(24) NOT NULL DEFAULT 'USER_CONFIRMED' CHECK(verify_stat_cd='USER_CONFIRMED'),
 del_yn BOOLEAN NOT NULL DEFAULT false,del_dttm TIMESTAMPTZ(0),del_id BIGINT,
 rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,upt_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_case_fact_case UNIQUE(user_case_id,id),
 CONSTRAINT ck_case_fact_delete CHECK((NOT del_yn AND del_dttm IS NULL AND del_id IS NULL) OR (del_yn AND del_dttm IS NOT NULL AND del_id IS NOT NULL)),
 CONSTRAINT ck_case_fact_value CHECK(jsonb_typeof(fact_val)='object' AND fact_val ?& ARRAY['title','content','occurredOn']
   AND fact_val-ARRAY['title','content','occurredOn']='{}'::jsonb
   AND jsonb_typeof(fact_val->'title')='string' AND char_length(btrim(fact_val->>'title')) BETWEEN 1 AND 80
   AND jsonb_typeof(fact_val->'content')='string' AND char_length(btrim(fact_val->>'content')) BETWEEN 1 AND 4000
   AND (fact_val->'occurredOn'='null'::jsonb OR (jsonb_typeof(fact_val->'occurredOn')='string' AND fact_val->>'occurredOn' ~ '^\d{4}-\d{2}-\d{2}$')))
);
CREATE INDEX idx_case_fact_list ON case_fact(user_case_id,del_yn,id);
CREATE TABLE case_hist (
 id UUID PRIMARY KEY,user_case_id UUID NOT NULL,user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 fact_id BIGINT,rev_no INTEGER NOT NULL CHECK(rev_no>0),act_type_cd VARCHAR(24) NOT NULL,
 request_hash VARCHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),bf_data JSONB,af_data JSONB NOT NULL,
 rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_case_hist_owner FOREIGN KEY(user_case_id,user_id) REFERENCES user_case(id,user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_case_hist_fact FOREIGN KEY(user_case_id,fact_id) REFERENCES case_fact(user_case_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT uq_case_hist_revision UNIQUE(user_case_id,rev_no),
 CONSTRAINT ck_case_hist_action CHECK(act_type_cd IN ('CREATE_CASE','UPDATE_CASE','DELETE_CASE','CREATE_FACT','UPDATE_FACT','DELETE_FACT')),
 CONSTRAINT ck_case_hist_fact CHECK((act_type_cd IN ('CREATE_FACT','UPDATE_FACT','DELETE_FACT'))=(fact_id IS NOT NULL)),
 CONSTRAINT ck_case_hist_snapshot CHECK(jsonb_typeof(af_data)='object' AND
   ((act_type_cd IN ('CREATE_CASE','CREATE_FACT') AND bf_data IS NULL) OR
    (act_type_cd IN ('UPDATE_CASE','DELETE_CASE','UPDATE_FACT','DELETE_FACT') AND bf_data IS NOT NULL AND jsonb_typeof(bf_data)='object')))
);
CREATE INDEX idx_case_hist_date ON case_hist(user_case_id,rgst_dttm DESC,rev_no DESC);
WITH inserted AS (
 INSERT INTO cmmn_cd(prnt_cd_id,cd,cd_nm,node_type_cd,sys_yn,sort_seq)
 SELECT r.id,v.cd,v.nm,'GROUP',true,v.seq FROM cmmn_cd r CROSS JOIN (VALUES('CASE_TYPE','사건 분류',20),('CASE_FACT_TYPE','사실관계 유형',21)) v(cd,nm,seq)
 WHERE r.cd='AURORE' AND r.node_type_cd='ROOT' ON CONFLICT(prnt_cd_id,cd) DO NOTHING RETURNING *
) INSERT INTO cmmn_cd_hist(request_id,cmmn_cd_id,act_type_cd,af_data)
 SELECT 'a7a00000-0000-4000-8000-202611130200'::uuid,id,'CREATE',jsonb_build_object('cd',cd,'cd_nm',cd_nm,'node_type_cd',node_type_cd,'prnt_cd_id',prnt_cd_id) FROM inserted;
WITH inserted AS (
 INSERT INTO cmmn_cd(prnt_cd_id,cd,cd_nm,node_type_cd,sys_yn,sort_seq)
 SELECT p.id,v.cd,v.nm,'VALUE',true,v.seq FROM cmmn_cd p JOIN cmmn_cd r ON r.id=p.prnt_cd_id
 JOIN (VALUES('CASE_TYPE','LEASE','임대차',1),('CASE_TYPE','EMPLOYMENT','근로',2),('CASE_TYPE','CONTRACT','계약·금전',3),('CASE_TYPE','OTHER','기타',4),('CASE_FACT_TYPE','STATEMENT','사용자 확인 사실관계',1)) v(grp,cd,nm,seq) ON v.grp=p.cd
 WHERE r.cd='AURORE' AND r.node_type_cd='ROOT' AND p.node_type_cd='GROUP' ON CONFLICT(prnt_cd_id,cd) DO NOTHING RETURNING *
) INSERT INTO cmmn_cd_hist(request_id,cmmn_cd_id,act_type_cd,af_data)
 SELECT 'a7a00000-0000-4000-8000-202611130200'::uuid,id,'CREATE',jsonb_build_object('cd',cd,'cd_nm',cd_nm,'node_type_cd',node_type_cd,'prnt_cd_id',prnt_cd_id) FROM inserted;
COMMIT;
