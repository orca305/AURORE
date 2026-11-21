BEGIN;

-- AI 모델 호출 기록(모니터링용). 질문·원문·답변 내용은 저장하지 않고, 단계·제공자·모델·걸린 시간·토큰 수·결과 코드만 쌓는다.
-- 추가만 하고 고치거나 지우지 않는다.
CREATE TABLE ai_call_log (
    id BIGSERIAL PRIMARY KEY,
    occurred_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stage_cd VARCHAR(20) NOT NULL,
    provider_cd VARCHAR(10) NOT NULL CHECK (provider_cd IN ('external', 'local')),
    model_cd VARCHAR(60) NOT NULL,
    latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
    in_tokens INTEGER CHECK (in_tokens IS NULL OR in_tokens >= 0),
    out_tokens INTEGER CHECK (out_tokens IS NULL OR out_tokens >= 0),
    outcome_cd VARCHAR(10) NOT NULL CHECK (outcome_cd IN ('OK', 'FALLBACK', 'ERROR')),
    err_cd VARCHAR(30)
);

CREATE INDEX idx_ai_call_log_date ON ai_call_log (occurred_dttm DESC, id DESC);

COMMIT;
