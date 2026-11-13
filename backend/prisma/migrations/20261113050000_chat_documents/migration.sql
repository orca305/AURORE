BEGIN;
ALTER TABLE chat_sess ADD CONSTRAINT uq_chat_sess_owner UNIQUE(id,user_id);
CREATE TABLE attach_doc (
 id UUID PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 chat_sess_id UUID NOT NULL,doc_nm VARCHAR(80) NOT NULL,format_cd VARCHAR(8) NOT NULL CHECK(format_cd IN ('pdf','hwp','hwpx','docx','txt','md')),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),src_sha VARCHAR(64) NOT NULL CHECK(src_sha ~ '^[a-f0-9]{64}$'),
 request_hash VARCHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),md_cont TEXT NOT NULL CHECK(char_length(btrim(md_cont)) BETWEEN 1 AND 50000),
 partial_yn BOOLEAN NOT NULL,rule_ver VARCHAR(16) NOT NULL DEFAULT '1',
 del_yn BOOLEAN NOT NULL DEFAULT false,del_dttm TIMESTAMPTZ(0),del_id BIGINT,
 rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,upt_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_attach_doc_owner FOREIGN KEY(chat_sess_id,user_id) REFERENCES chat_sess(id,user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ck_attach_doc_delete CHECK((NOT del_yn AND del_dttm IS NULL AND del_id IS NULL) OR (del_yn AND del_dttm IS NOT NULL AND del_id IS NOT NULL AND del_id=user_id))
);
CREATE INDEX idx_attach_doc_chat ON attach_doc(chat_sess_id,del_yn,rgst_dttm DESC,id DESC);
COMMIT;
