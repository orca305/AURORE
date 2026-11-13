BEGIN;
ALTER TABLE user_stat_hist
  ADD COLUMN prev_stat_cd_id BIGINT,
  ADD COLUMN actor_user_id BIGINT,
  ADD COLUMN reason VARCHAR(1000),
  ADD COLUMN request_id UUID,
  ADD COLUMN request_hash VARCHAR(64),
  ADD CONSTRAINT fk_user_stat_hist_previous FOREIGN KEY (prev_stat_cd_id) REFERENCES cmmn_cd(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_user_stat_hist_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT ck_user_stat_hist_action CHECK (
    (request_id IS NULL AND request_hash IS NULL AND actor_user_id IS NULL AND prev_stat_cd_id IS NULL AND reason IS NULL)
    OR
    (request_id IS NOT NULL AND request_hash IS NOT NULL AND actor_user_id IS NOT NULL AND prev_stat_cd_id IS NOT NULL AND reason IS NOT NULL
     AND request_hash ~ '^[a-f0-9]{64}$' AND char_length(btrim(reason)) BETWEEN 1 AND 1000
     AND prev_stat_cd_id <> stat_cd_id AND actor_user_id <> user_id)
  );
CREATE UNIQUE INDEX uq_user_stat_hist_request ON user_stat_hist(request_id);
CREATE INDEX idx_user_stat_hist_date ON user_stat_hist(user_id, rgst_dttm DESC, id DESC);
COMMIT;
