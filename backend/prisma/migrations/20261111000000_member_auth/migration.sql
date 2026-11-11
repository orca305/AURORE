BEGIN;

-- CreateTable
CREATE TABLE "app_user" (
    "id" BIGSERIAL NOT NULL,
    "login_id" VARCHAR(12) NOT NULL,
    "nick_nm" VARCHAR(12) NOT NULL,
    "stat_cd_id" BIGINT NOT NULL,
    "del_yn" BOOLEAN NOT NULL DEFAULT false,
    "del_dttm" TIMESTAMPTZ(0),
    "del_id" BIGINT,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upt_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_auth" (
    "user_id" BIGINT NOT NULL,
    "pw_salt" BYTEA NOT NULL,
    "pw_hash" BYTEA NOT NULL,

    CONSTRAINT "user_auth_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_sess" (
    "token_hash" BYTEA NOT NULL,
    "user_id" BIGINT NOT NULL,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL,
    "last_act_dttm" TIMESTAMPTZ(0) NOT NULL,
    "revoke_dttm" TIMESTAMPTZ(0),

    CONSTRAINT "user_sess_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "user_stat_hist" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "stat_cd_id" BIGINT NOT NULL,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_stat_hist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_agr_yn_hist" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "agr_cd_id" BIGINT NOT NULL,
    "agr_yn" BOOLEAN NOT NULL,
    "pol_ver" VARCHAR(32) NOT NULL,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_agr_yn_hist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_app_user_login_id" ON "app_user"("login_id");

-- CreateIndex
CREATE INDEX "idx_user_sess_user" ON "user_sess"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_stat_hist_user" ON "user_stat_hist"("user_id", "id");

-- CreateIndex
CREATE INDEX "idx_user_agr_hist_user" ON "user_agr_yn_hist"("user_id", "agr_cd_id", "id");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_stat_cd_id_fkey" FOREIGN KEY ("stat_cd_id") REFERENCES "cmmn_cd"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_auth" ADD CONSTRAINT "user_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_sess" ADD CONSTRAINT "user_sess_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_stat_hist" ADD CONSTRAINT "user_stat_hist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_stat_hist" ADD CONSTRAINT "user_stat_hist_stat_cd_id_fkey" FOREIGN KEY ("stat_cd_id") REFERENCES "cmmn_cd"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_agr_yn_hist" ADD CONSTRAINT "user_agr_yn_hist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_agr_yn_hist" ADD CONSTRAINT "user_agr_yn_hist_agr_cd_id_fkey" FOREIGN KEY ("agr_cd_id") REFERENCES "cmmn_cd"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE app_user
  ADD CONSTRAINT ck_app_user_login_id CHECK (login_id ~ '^[a-z][a-z0-9_]{3,11}$'),
  ADD CONSTRAINT ck_app_user_nickname CHECK (char_length(nick_nm) >= 2 AND nick_nm = btrim(nick_nm)),
  ADD CONSTRAINT ck_app_user_delete CHECK (del_yn = (del_dttm IS NOT NULL));

ALTER TABLE user_auth ADD CONSTRAINT ck_user_auth_digest
  CHECK (octet_length(pw_salt) = 16 AND octet_length(pw_hash) = 32);
ALTER TABLE user_sess ADD CONSTRAINT ck_user_sess_bounds
  CHECK (octet_length(token_hash) = 32 AND last_act_dttm >= rgst_dttm
    AND (revoke_dttm IS NULL OR revoke_dttm >= rgst_dttm));

WITH agreement_group AS (
  INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT id, 'USER_AGR', '회원 동의', 'GROUP', true, 3
  FROM cmmn_cd WHERE node_type_cd = 'ROOT' AND cd = 'AURORE'
  RETURNING id, cd, cd_nm, node_type_cd, prnt_cd_id
), learning AS (
  INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT id, 'LEARNING', '학습 활용', 'VALUE', true, 1 FROM agreement_group
  RETURNING id, cd, cd_nm, node_type_cd, prnt_cd_id
), added AS (
  SELECT * FROM agreement_group UNION ALL SELECT * FROM learning
)
INSERT INTO cmmn_cd_hist (request_id, cmmn_cd_id, act_type_cd, af_data)
SELECT 'a7a00000-0000-4000-8000-202611110000'::uuid, id, 'CREATE',
  jsonb_build_object('cd', cd, 'cd_nm', cd_nm, 'node_type_cd', node_type_cd, 'prnt_cd_id', prnt_cd_id)
FROM added;

COMMIT;


