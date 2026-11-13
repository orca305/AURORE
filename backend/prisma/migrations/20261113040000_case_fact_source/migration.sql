BEGIN;
ALTER TABLE case_fact ADD COLUMN src_msg_id UUID;
ALTER TABLE case_fact ADD CONSTRAINT fk_case_fact_source FOREIGN KEY(src_msg_id) REFERENCES chat_msg(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX uq_case_fact_active_source ON case_fact(user_case_id,src_msg_id) WHERE NOT del_yn AND src_msg_id IS NOT NULL;
COMMIT;
