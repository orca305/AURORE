BEGIN;
ALTER TABLE chat_msg ADD COLUMN clarify_cd VARCHAR(24), ADD COLUMN clarify_reply_to UUID;
ALTER TABLE chat_msg ADD CONSTRAINT ck_chat_msg_clarification CHECK ((clarify_cd IS NULL OR (role_cd='ASSISTANT' AND clarify_cd IN ('SOURCE_GAP','RELEVANCE_GAP'))) AND (clarify_reply_to IS NULL OR role_cd='USER'));
ALTER TABLE chat_msg ADD CONSTRAINT fk_chat_msg_clarification FOREIGN KEY(chat_sess_id,clarify_reply_to) REFERENCES chat_msg(chat_sess_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX idx_chat_msg_clarification ON chat_msg(chat_sess_id,clarify_reply_to);
COMMIT;
