BEGIN;

-- 답변에 대한 사용자 피드백. 답변(chat_msg) 하나에 하나만 두고, 사용자가 바꾸면 같은 행을 갱신한다.
-- 작성자(회원·비회원) 식별 정보는 이 표에 두지 않는다. 운영자는 연결된 질문·답변 내용만 본다.
CREATE TABLE ans_feedback (
    id BIGSERIAL PRIMARY KEY,
    chat_sess_id UUID NOT NULL,
    msg_id UUID NOT NULL,
    rating_cd VARCHAR(8) NOT NULL CHECK (rating_cd IN ('HELPFUL', 'IMPROVE')),
    reason_cd VARCHAR(20) CHECK (reason_cd IS NULL OR reason_cd IN ('WRONG_LAW', 'NOT_MY_CASE', 'TOO_HARD', 'MISSING', 'OTHER')),
    reason_txt VARCHAR(300),
    stat_cd VARCHAR(12) NOT NULL DEFAULT 'NEW' CHECK (stat_cd IN ('NEW', 'REVIEWING', 'DONE')),
    admin_note VARCHAR(500),
    handler_user_id BIGINT REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    handled_dttm TIMESTAMPTZ(0),
    del_yn BOOLEAN NOT NULL DEFAULT FALSE,
    del_dttm TIMESTAMPTZ(0),
    rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    upt_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ans_feedback_msg FOREIGN KEY (chat_sess_id, msg_id) REFERENCES chat_msg (chat_sess_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_ans_feedback_reason CHECK (rating_cd = 'IMPROVE' OR (reason_cd IS NULL AND reason_txt IS NULL))
);

CREATE UNIQUE INDEX uq_ans_feedback_msg ON ans_feedback (msg_id) WHERE NOT del_yn;
CREATE INDEX idx_ans_feedback_list ON ans_feedback (stat_cd, rgst_dttm DESC, id DESC) WHERE NOT del_yn;

COMMIT;
