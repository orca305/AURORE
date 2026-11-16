BEGIN;
ALTER TABLE ai_job ADD CONSTRAINT uq_ai_job_chat UNIQUE(chat_sess_id,id);
ALTER TABLE attach_doc ADD CONSTRAINT uq_attach_doc_chat UNIQUE(chat_sess_id,id);
CREATE TABLE ai_job_doc (
 job_id UUID NOT NULL,attach_doc_id UUID NOT NULL,chat_sess_id UUID NOT NULL,md_hash VARCHAR(64) NOT NULL CHECK(md_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(job_id,attach_doc_id),
 CONSTRAINT fk_job_doc_job FOREIGN KEY(chat_sess_id,job_id) REFERENCES ai_job(chat_sess_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_job_doc_document FOREIGN KEY(chat_sess_id,attach_doc_id) REFERENCES attach_doc(chat_sess_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX idx_job_doc_document ON ai_job_doc(attach_doc_id);
CREATE TABLE doc_quote (
 id BIGSERIAL PRIMARY KEY,chat_sess_id UUID NOT NULL,msg_id UUID NOT NULL,attach_doc_id UUID NOT NULL,
 quote TEXT NOT NULL CHECK(char_length(quote) BETWEEN 8 AND 1200),md_hash VARCHAR(64) NOT NULL CHECK(md_hash ~ '^[a-f0-9]{64}$'),
 quote_verify_cd VARCHAR(24) NOT NULL DEFAULT 'MATCHED' CHECK(quote_verify_cd='MATCHED'),
 support_verify_cd VARCHAR(24) NOT NULL DEFAULT 'MODEL_REVIEWED' CHECK(support_verify_cd='MODEL_REVIEWED'),
 rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_doc_quote_message FOREIGN KEY(chat_sess_id,msg_id) REFERENCES chat_msg(chat_sess_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_doc_quote_document FOREIGN KEY(chat_sess_id,attach_doc_id) REFERENCES attach_doc(chat_sess_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX idx_doc_quote_message ON doc_quote(msg_id,id);
CREATE INDEX idx_doc_quote_document ON doc_quote(attach_doc_id);
COMMIT;
