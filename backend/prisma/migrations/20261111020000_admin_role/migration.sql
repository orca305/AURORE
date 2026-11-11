BEGIN;
CREATE TABLE user_role (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role_cd_id BIGINT NOT NULL REFERENCES cmmn_cd(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  rgst_id BIGINT,
  rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT date_trunc('second', CURRENT_TIMESTAMP),
  del_yn BOOLEAN NOT NULL DEFAULT false,
  del_dttm TIMESTAMPTZ(0),
  del_id BIGINT,
  CONSTRAINT ck_user_role_delete CHECK (del_yn = (del_dttm IS NOT NULL) AND (del_dttm IS NULL OR del_dttm >= rgst_dttm))
);
CREATE INDEX idx_user_role_user_code ON user_role(user_id, role_cd_id);
CREATE UNIQUE INDEX uq_user_role_active ON user_role(user_id, role_cd_id) WHERE NOT del_yn;
WITH role_group AS (
  INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT id, 'USER_ROLE', '회원 권한', 'GROUP', true, 4
  FROM cmmn_cd WHERE node_type_cd = 'ROOT' AND cd = 'AURORE' AND NOT del_yn AND use_yn
  RETURNING id, cd, cd_nm, node_type_cd, prnt_cd_id
), admin AS (
  INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT id, 'ADMIN', '관리자', 'VALUE', true, 1 FROM role_group
  RETURNING id, cd, cd_nm, node_type_cd, prnt_cd_id
), added AS (SELECT * FROM role_group UNION ALL SELECT * FROM admin)
INSERT INTO cmmn_cd_hist (request_id, cmmn_cd_id, act_type_cd, af_data)
SELECT 'a7a00000-0000-4000-8000-202611110200'::uuid, id, 'CREATE',
  jsonb_build_object('cd', cd, 'cd_nm', cd_nm, 'node_type_cd', node_type_cd, 'prnt_cd_id', prnt_cd_id) FROM added;
COMMIT;
