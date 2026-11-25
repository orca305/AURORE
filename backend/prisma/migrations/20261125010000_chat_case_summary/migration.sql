BEGIN;

-- 대화의 사건 개요: 첫 질문에서 자동으로 정리해 두고 이어지는 모든 질문의 공통 맥락으로 쓴다(확인되지 않은 사용자 설명).
ALTER TABLE chat_sess ADD COLUMN case_sum VARCHAR(600);

COMMIT;
