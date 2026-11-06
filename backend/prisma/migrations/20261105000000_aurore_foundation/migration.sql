BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
-- 기존 laws 행·식별자·시퀀스를 보존한다. 기존 Prisma timestamp는 UTC로 해석한다.
ALTER TABLE "laws" RENAME TO "legal";
ALTER TABLE "legal" RENAME COLUMN "law_id" TO "src_key";
ALTER TABLE "legal" RENAME COLUMN "law_name" TO "legal_nm";
ALTER TABLE "legal" RENAME COLUMN "created_at" TO "rgst_dttm";
ALTER TABLE "legal" RENAME COLUMN "updated_at" TO "upt_dttm";
ALTER TABLE "legal" RENAME CONSTRAINT "laws_pkey" TO "legal_pkey";
ALTER TABLE "legal" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "laws_id_seq" AS BIGINT;
ALTER SEQUENCE "laws_id_seq" RENAME TO "legal_id_seq";
ALTER TABLE "legal" ALTER COLUMN "rgst_dttm" TYPE TIMESTAMPTZ(6) USING "rgst_dttm" AT TIME ZONE 'UTC';
ALTER TABLE "legal" ALTER COLUMN "upt_dttm" TYPE TIMESTAMPTZ(6) USING "upt_dttm" AT TIME ZONE 'UTC';
ALTER TABLE "legal" ALTER COLUMN "upt_dttm" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "legal" ADD COLUMN "src_cd" VARCHAR(60) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN "del_yn" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "del_dttm" TIMESTAMPTZ(6), ADD COLUMN "del_id" BIGINT;
DROP INDEX "laws_law_id_key";

-- CreateTable
CREATE TABLE "src_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "src_cd" VARCHAR(60) NOT NULL,
    "src_key" TEXT NOT NULL,
    "src_url" TEXT NOT NULL,
    "cont_type" VARCHAR(100) NOT NULL,
    "src_cont" TEXT NOT NULL,
    "cont_hash" VARCHAR(64) NOT NULL,
    "rgst_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "src_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_ver" (
    "id" BIGSERIAL NOT NULL,
    "legal_id" BIGINT NOT NULL,
    "ver_key" TEXT NOT NULL,
    "prml_dt" DATE,
    "enfc_dt" DATE,
    "src_snapshot_id" BIGINT,
    "del_yn" BOOLEAN NOT NULL DEFAULT false,
    "del_dttm" TIMESTAMPTZ(6),
    "del_id" BIGINT,
    "rgst_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upt_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_ver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_provi" (
    "id" BIGSERIAL NOT NULL,
    "legal_ver_id" BIGINT NOT NULL,
    "prnt_provi_id" BIGINT,
    "provi_type_cd" VARCHAR(30) NOT NULL,
    "disp_no" TEXT NOT NULL,
    "norm_no" TEXT,
    "sort_seq" INTEGER NOT NULL,
    "provi_nm" TEXT,
    "provi_cont" TEXT NOT NULL,
    "enfc_dt" DATE,
    "del_yn" BOOLEAN NOT NULL DEFAULT false,
    "del_dttm" TIMESTAMPTZ(6),
    "del_id" BIGINT,
    "rgst_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upt_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_provi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cmmn_cd" (
    "id" BIGSERIAL NOT NULL,
    "prnt_cd_id" BIGINT,
    "cd" VARCHAR(60) NOT NULL,
    "cd_nm" VARCHAR(200) NOT NULL,
    "cd_desc" TEXT,
    "node_type_cd" VARCHAR(20) NOT NULL,
    "sort_seq" INTEGER NOT NULL DEFAULT 0,
    "use_yn" BOOLEAN NOT NULL DEFAULT true,
    "sys_yn" BOOLEAN NOT NULL DEFAULT false,
    "del_yn" BOOLEAN NOT NULL DEFAULT false,
    "del_dttm" TIMESTAMPTZ(6),
    "del_id" BIGINT,
    "rgst_id" BIGINT,
    "rgst_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upt_id" BIGINT,
    "upt_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmmn_cd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cmmn_cd_hist" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID NOT NULL,
    "cmmn_cd_id" BIGINT NOT NULL,
    "act_type_cd" VARCHAR(20) NOT NULL,
    "bf_data" JSONB,
    "af_data" JSONB,
    "rgst_id" BIGINT,
    "rgst_dttm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmmn_cd_hist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_legal_src" ON "legal"("src_cd", "src_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_src_snapshot_content" ON "src_snapshot"("src_cd", "src_key", "cont_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_legal_ver_key" ON "legal_ver"("legal_id", "ver_key");

-- CreateIndex
CREATE INDEX "idx_legal_provi_sort" ON "legal_provi"("legal_ver_id", "sort_seq", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_legal_provi_id_ver" ON "legal_provi"("id", "legal_ver_id");

-- CreateIndex
CREATE INDEX "idx_cmmn_cd_parent_sort" ON "cmmn_cd"("prnt_cd_id", "sort_seq", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cmmn_cd_sibling" ON "cmmn_cd"("prnt_cd_id", "cd");

-- CreateIndex
CREATE INDEX "idx_cmmn_cd_hist_code_date" ON "cmmn_cd_hist"("cmmn_cd_id", "rgst_dttm" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_cmmn_cd_hist_request" ON "cmmn_cd_hist"("request_id");

-- AddForeignKey
ALTER TABLE "legal_ver" ADD CONSTRAINT "legal_ver_legal_id_fkey" FOREIGN KEY ("legal_id") REFERENCES "legal"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "legal_ver" ADD CONSTRAINT "legal_ver_src_snapshot_id_fkey" FOREIGN KEY ("src_snapshot_id") REFERENCES "src_snapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "legal_provi" ADD CONSTRAINT "legal_provi_legal_ver_id_fkey" FOREIGN KEY ("legal_ver_id") REFERENCES "legal_ver"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "legal_provi" ADD CONSTRAINT "legal_provi_prnt_provi_id_legal_ver_id_fkey" FOREIGN KEY ("prnt_provi_id", "legal_ver_id") REFERENCES "legal_provi"("id", "legal_ver_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cmmn_cd" ADD CONSTRAINT "cmmn_cd_prnt_cd_id_fkey" FOREIGN KEY ("prnt_cd_id") REFERENCES "cmmn_cd"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cmmn_cd_hist" ADD CONSTRAINT "cmmn_cd_hist_cmmn_cd_id_fkey" FOREIGN KEY ("cmmn_cd_id") REFERENCES "cmmn_cd"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma 모델에서 표현하지 않은 CHECK·부분 UNIQUE. 업무 트리거는 사용하지 않는다.
ALTER TABLE legal ADD CONSTRAINT ck_legal_delete CHECK (del_yn = (del_dttm IS NOT NULL));
ALTER TABLE legal_ver ADD CONSTRAINT ck_legal_ver_delete CHECK (del_yn = (del_dttm IS NOT NULL));
ALTER TABLE legal_provi ADD CONSTRAINT ck_legal_provi_delete CHECK (del_yn = (del_dttm IS NOT NULL)),
    ADD CONSTRAINT ck_legal_provi_not_self CHECK (prnt_provi_id IS DISTINCT FROM id);
ALTER TABLE cmmn_cd ADD CONSTRAINT ck_cmmn_cd_type CHECK (node_type_cd IN ('ROOT', 'GROUP', 'CATEGORY', 'VALUE')),
    ADD CONSTRAINT ck_cmmn_cd_format CHECK (cd ~ '^[A-Z][A-Z0-9_]*$'),
    ADD CONSTRAINT ck_cmmn_cd_root CHECK (
      (node_type_cd = 'ROOT' AND prnt_cd_id IS NULL AND cd = 'AURORE') OR
      (node_type_cd <> 'ROOT' AND prnt_cd_id IS NOT NULL)),
    ADD CONSTRAINT ck_cmmn_cd_not_self CHECK (prnt_cd_id IS DISTINCT FROM id),
    ADD CONSTRAINT ck_cmmn_cd_delete CHECK (del_yn = (del_dttm IS NOT NULL));
CREATE UNIQUE INDEX uq_cmmn_cd_single_root ON cmmn_cd (node_type_cd) WHERE node_type_cd = 'ROOT';
ALTER TABLE cmmn_cd_hist ADD CONSTRAINT ck_cmmn_cd_hist_action
    CHECK (act_type_cd IN ('CREATE', 'UPDATE', 'ARCHIVE', 'RESTORE')),
    ADD CONSTRAINT ck_cmmn_cd_hist_snapshot CHECK (
      (act_type_cd = 'CREATE' AND bf_data IS NULL AND af_data IS NOT NULL) OR
      (act_type_cd IN ('UPDATE', 'ARCHIVE', 'RESTORE') AND bf_data IS NOT NULL AND af_data IS NOT NULL));

-- 대표 공통코드만 경로로 연결한다. 수집·일반 API에는 코드 변경 API를 제공하지 않는다.
INSERT INTO cmmn_cd (cd, cd_nm, node_type_cd, sys_yn) VALUES ('AURORE', 'AURORE', 'ROOT', true);
INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT id, 'LEGAL_GRP', '법규 분류', 'GROUP', true, 1 FROM cmmn_cd WHERE node_type_cd = 'ROOT';
INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT id, 'USER_STAT', '회원 상태', 'GROUP', true, 2 FROM cmmn_cd WHERE node_type_cd = 'ROOT';
INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn)
  SELECT id, 'LAW', '법령', 'CATEGORY', true FROM cmmn_cd WHERE cd = 'LEGAL_GRP';
INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT p.id, v.cd, v.nm, 'VALUE', true, v.seq FROM cmmn_cd p CROSS JOIN
    (VALUES ('ACT', '법률', 1), ('PRES_DEC', '대통령령', 2)) AS v(cd, nm, seq)
  WHERE p.cd = 'LAW';
INSERT INTO cmmn_cd (prnt_cd_id, cd, cd_nm, node_type_cd, sys_yn, sort_seq)
  SELECT p.id, v.cd, v.nm, 'VALUE', true, v.seq FROM cmmn_cd p CROSS JOIN
    (VALUES ('ACTIVE', '정상', 1), ('BLOCKED', '차단', 2), ('WITHDRAWN', '탈퇴', 3)) AS v(cd, nm, seq)
  WHERE p.cd = 'USER_STAT';
INSERT INTO cmmn_cd_hist (request_id, cmmn_cd_id, act_type_cd, af_data)
  SELECT 'a7a00000-0000-4000-8000-202611050000'::uuid, id, 'CREATE',
    jsonb_build_object('cd', cd, 'cd_nm', cd_nm, 'node_type_cd', node_type_cd, 'prnt_cd_id', prnt_cd_id)
  FROM cmmn_cd;

COMMIT;
