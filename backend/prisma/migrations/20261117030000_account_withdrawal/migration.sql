BEGIN;
ALTER TABLE app_user ADD COLUMN withdraw_arch_dttm timestamptz(0),
 ADD CONSTRAINT ck_app_user_withdraw_archive CHECK(withdraw_arch_dttm IS NULL OR (del_yn AND del_dttm IS NOT NULL AND withdraw_arch_dttm>=del_dttm));
CREATE INDEX idx_app_user_withdraw_pending ON app_user(del_dttm,id) WHERE del_yn AND withdraw_arch_dttm IS NULL;
ALTER TABLE user_stat_hist DROP CONSTRAINT ck_user_stat_hist_action;
ALTER TABLE user_stat_hist ADD CONSTRAINT ck_user_stat_hist_action CHECK(
 (request_id IS NULL AND request_hash IS NULL AND actor_user_id IS NULL AND prev_stat_cd_id IS NULL AND reason IS NULL)
 OR
 (request_id IS NOT NULL AND request_hash IS NOT NULL AND actor_user_id IS NOT NULL AND prev_stat_cd_id IS NOT NULL AND reason IS NOT NULL
  AND request_hash ~ '^[a-f0-9]{64}$' AND char_length(btrim(reason)) BETWEEN 1 AND 1000 AND prev_stat_cd_id<>stat_cd_id
  AND (actor_user_id<>user_id OR (actor_user_id=user_id AND reason='SELF_WITHDRAWAL')))
);
COMMIT;
