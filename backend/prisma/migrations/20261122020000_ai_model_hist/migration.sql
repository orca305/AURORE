BEGIN;

-- 운영자가 고른 AI 답변 모델의 변경 이력. 행을 고치거나 지우지 않고 계속 추가만 한다.
-- 현재 설정은 가장 최근 행이고, 롤백도 이전 모델을 새 행으로 추가해서 남긴다. API 키는 저장하지 않는다.
CREATE TABLE ai_model_hist (
    id BIGSERIAL PRIMARY KEY,
    model_cd VARCHAR(60) NOT NULL CHECK (btrim(model_cd) <> ''),
    prev_model_cd VARCHAR(60),
    kind_cd VARCHAR(12) NOT NULL CHECK (kind_cd IN ('CHANGE', 'ROLLBACK')),
    actor_user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reason VARCHAR(500) NOT NULL CHECK (btrim(reason) <> ''),
    rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_model_hist_date ON ai_model_hist (rgst_dttm DESC, id DESC);

COMMIT;
