BEGIN;

-- 대화 상단 고정: 고정한 시각을 넣고, 고정 해제는 NULL 로 되돌린다. 목록에서는 고정한 대화가 먼저 나온다.
ALTER TABLE chat_sess ADD COLUMN pin_dttm TIMESTAMPTZ(0);
CREATE INDEX idx_chat_sess_pinned ON chat_sess (user_id, guest_sess_id, pin_dttm DESC) WHERE pin_dttm IS NOT NULL AND NOT del_yn;

-- 사건의 "다음 할 일": 사건 소유자가 직접 적는 번호 목록. 지울 때는 del_yn 만 바꾼다.
CREATE TABLE case_task (
    id BIGSERIAL PRIMARY KEY,
    user_case_id UUID NOT NULL,
    user_id BIGINT NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    task_txt VARCHAR(200) NOT NULL,
    done_yn BOOLEAN NOT NULL DEFAULT FALSE,
    del_yn BOOLEAN NOT NULL DEFAULT FALSE,
    del_dttm TIMESTAMPTZ(0),
    rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    upt_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_case_task_owner FOREIGN KEY (user_case_id, user_id) REFERENCES user_case (id, user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX idx_case_task_list ON case_task (user_case_id, seq, id) WHERE NOT del_yn;

COMMIT;
