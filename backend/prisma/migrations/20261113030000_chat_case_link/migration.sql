BEGIN;
ALTER TABLE chat_sess ADD COLUMN user_case_id UUID;
ALTER TABLE chat_sess ADD CONSTRAINT fk_chat_case_owner FOREIGN KEY(user_case_id,user_id) REFERENCES user_case(id,user_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE chat_sess ADD CONSTRAINT ck_chat_case_member CHECK(user_case_id IS NULL OR user_id IS NOT NULL);
CREATE INDEX idx_chat_case_list ON chat_sess(user_case_id,user_id,del_yn,upt_dttm DESC,id DESC);
COMMIT;
