BEGIN;

-- CreateTable
CREATE TABLE "guest_sess" (
    "id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL,
    "last_act_dttm" TIMESTAMPTZ(0) NOT NULL,
    "expr_dttm" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "guest_sess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sess" (
    "id" UUID NOT NULL,
    "user_id" BIGINT,
    "guest_sess_id" UUID,
    "sess_nm" VARCHAR(80) NOT NULL,
    "phase_cd" VARCHAR(32) NOT NULL DEFAULT 'start',
    "rev_no" INTEGER NOT NULL DEFAULT 0,
    "next_msg_seq" INTEGER NOT NULL DEFAULT 1,
    "expr_dttm" TIMESTAMPTZ(0),
    "del_yn" BOOLEAN NOT NULL DEFAULT false,
    "del_dttm" TIMESTAMPTZ(0),
    "del_id" BIGINT,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upt_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_msg" (
    "id" UUID NOT NULL,
    "chat_sess_id" UUID NOT NULL,
    "prnt_msg_id" UUID,
    "msg_seq" INTEGER NOT NULL,
    "role_cd" VARCHAR(16) NOT NULL,
    "msg_cont" TEXT NOT NULL,
    "del_yn" BOOLEAN NOT NULL DEFAULT false,
    "del_dttm" TIMESTAMPTZ(0),
    "del_id" BIGINT,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_msg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_job" (
    "id" UUID NOT NULL,
    "chat_sess_id" UUID NOT NULL,
    "input_msg_id" UUID NOT NULL,
    "answer_msg_id" UUID,
    "request_hash" VARCHAR(64) NOT NULL,
    "owner_auth_hash" BYTEA NOT NULL,
    "phase_cd" VARCHAR(32) NOT NULL,
    "stat_cd" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "provider_cd" VARCHAR(20) NOT NULL DEFAULT 'DEMO',
    "attempt_no" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_dttm" TIMESTAMPTZ(0),
    "next_run_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_dttm" TIMESTAMPTZ(0) NOT NULL,
    "error_cd" VARCHAR(40),
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upt_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ans_cite" (
    "id" BIGSERIAL NOT NULL,
    "msg_id" UUID NOT NULL,
    "src_snapshot_id" BIGINT NOT NULL,
    "legal_ver_id" BIGINT,
    "legal_prec_id" BIGINT,
    "cite_type_cd" VARCHAR(16) NOT NULL,
    "cite_cont" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "src_url" TEXT NOT NULL,
    "view_href" TEXT NOT NULL,
    "quote_verify_cd" VARCHAR(24) NOT NULL,
    "support_verify_cd" VARCHAR(24) NOT NULL,
    "rgst_dttm" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ans_cite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_guest_sess_token" ON "guest_sess"("token_hash");

-- CreateIndex
CREATE INDEX "idx_chat_sess_user_date" ON "chat_sess"("user_id", "upt_dttm", "id");

-- CreateIndex
CREATE INDEX "idx_chat_sess_guest_date" ON "chat_sess"("guest_sess_id", "upt_dttm", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_chat_msg_same_chat" ON "chat_msg"("chat_sess_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_chat_msg_sequence" ON "chat_msg"("chat_sess_id", "msg_seq");

-- CreateIndex
CREATE INDEX "idx_ai_job_queue" ON "ai_job"("stat_cd", "next_run_dttm", "rgst_dttm");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_job_input" ON "ai_job"("chat_sess_id", "input_msg_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_job_answer" ON "ai_job"("chat_sess_id", "answer_msg_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ans_cite_message" ON "ans_cite"("msg_id");

-- AddForeignKey
ALTER TABLE "chat_sess" ADD CONSTRAINT "chat_sess_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "chat_sess" ADD CONSTRAINT "chat_sess_guest_sess_id_fkey" FOREIGN KEY ("guest_sess_id") REFERENCES "guest_sess"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "chat_msg" ADD CONSTRAINT "chat_msg_chat_sess_id_fkey" FOREIGN KEY ("chat_sess_id") REFERENCES "chat_sess"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "chat_msg" ADD CONSTRAINT "chat_msg_chat_sess_id_prnt_msg_id_fkey" FOREIGN KEY ("chat_sess_id", "prnt_msg_id") REFERENCES "chat_msg"("chat_sess_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_chat_sess_id_fkey" FOREIGN KEY ("chat_sess_id") REFERENCES "chat_sess"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_chat_sess_id_input_msg_id_fkey" FOREIGN KEY ("chat_sess_id", "input_msg_id") REFERENCES "chat_msg"("chat_sess_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_chat_sess_id_answer_msg_id_fkey" FOREIGN KEY ("chat_sess_id", "answer_msg_id") REFERENCES "chat_msg"("chat_sess_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ans_cite" ADD CONSTRAINT "ans_cite_msg_id_fkey" FOREIGN KEY ("msg_id") REFERENCES "chat_msg"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ans_cite" ADD CONSTRAINT "ans_cite_src_snapshot_id_fkey" FOREIGN KEY ("src_snapshot_id") REFERENCES "src_snapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ans_cite" ADD CONSTRAINT "ans_cite_legal_ver_id_fkey" FOREIGN KEY ("legal_ver_id") REFERENCES "legal_ver"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ans_cite" ADD CONSTRAINT "ans_cite_legal_prec_id_fkey" FOREIGN KEY ("legal_prec_id") REFERENCES "legal_prec"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE guest_sess ADD CONSTRAINT ck_guest_sess
  CHECK (octet_length(token_hash) = 32 AND last_act_dttm >= rgst_dttm AND expr_dttm > last_act_dttm);
ALTER TABLE chat_sess
  ADD CONSTRAINT ck_chat_sess_owner CHECK ((user_id IS NULL) <> (guest_sess_id IS NULL)),
  ADD CONSTRAINT ck_chat_sess_expiry CHECK ((user_id IS NULL) = (expr_dttm IS NOT NULL)),
  ADD CONSTRAINT ck_chat_sess_state CHECK (rev_no >= 0 AND next_msg_seq > 0 AND phase_cd IN ('start','lease-end','renewal-delivery')),
  ADD CONSTRAINT ck_chat_sess_delete CHECK (del_yn = (del_dttm IS NOT NULL));
ALTER TABLE chat_msg
  ADD CONSTRAINT ck_chat_msg_sequence CHECK (msg_seq > 0),
  ADD CONSTRAINT ck_chat_msg_content CHECK (btrim(msg_cont) <> '' AND (role_cd <> 'USER' OR char_length(msg_cont) <= 1000)),
  ADD CONSTRAINT ck_chat_msg_role CHECK ((role_cd = 'USER' AND prnt_msg_id IS NULL) OR (role_cd = 'ASSISTANT' AND prnt_msg_id IS NOT NULL)),
  ADD CONSTRAINT ck_chat_msg_delete CHECK (del_yn = (del_dttm IS NOT NULL));
ALTER TABLE ai_job
  ADD CONSTRAINT ck_ai_job_stat CHECK (stat_cd IN ('QUEUED','RUNNING','SUCCEEDED','RETRY_WAIT','FAILED','CANCELLED')),
  ADD CONSTRAINT ck_ai_job_lease CHECK (
    (stat_cd = 'RUNNING' AND lease_token IS NOT NULL AND lease_dttm IS NOT NULL) OR
    (stat_cd <> 'RUNNING' AND lease_token IS NULL AND lease_dttm IS NULL)),
  ADD CONSTRAINT ck_ai_job_answer CHECK ((stat_cd = 'SUCCEEDED') = (answer_msg_id IS NOT NULL)),
  ADD CONSTRAINT ck_ai_job_attempt CHECK (attempt_no BETWEEN 0 AND 3),
  ADD CONSTRAINT ck_ai_job_hash CHECK (request_hash ~ '^[0-9a-f]{64}$' AND octet_length(owner_auth_hash) = 32);
CREATE UNIQUE INDEX uq_ai_job_active_chat ON ai_job(chat_sess_id)
  WHERE stat_cd IN ('QUEUED','RUNNING','RETRY_WAIT');
ALTER TABLE ans_cite
  ADD CONSTRAINT ck_ans_cite_target CHECK (
    (cite_type_cd = 'LEGAL' AND legal_ver_id IS NOT NULL AND legal_prec_id IS NULL) OR
    (cite_type_cd = 'PREC' AND legal_ver_id IS NULL AND legal_prec_id IS NOT NULL)),
  ADD CONSTRAINT ck_ans_cite_verification CHECK (
    btrim(cite_cont) <> '' AND quote_verify_cd = 'MATCHED' AND support_verify_cd = 'REVIEWED_DEMO');
ALTER TABLE ans_cite
  ADD CONSTRAINT fk_ans_cite_legal_snapshot FOREIGN KEY (legal_ver_id, src_snapshot_id)
    REFERENCES legal_ver_rev(legal_ver_id, src_snapshot_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_ans_cite_prec_snapshot FOREIGN KEY (legal_prec_id, src_snapshot_id)
    REFERENCES legal_prec_rev(legal_prec_id, src_snapshot_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMIT;


