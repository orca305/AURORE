# 데이터베이스

PostgreSQL 17(pgvector 이미지)을 쓰고, 스키마는 [schema.prisma](../backend/prisma/schema.prisma)와 [마이그레이션](../backend/prisma/migrations)이 기준입니다.

## 테이블 구성

| 영역 | 테이블 |
|---|---|
| 회원·인증 | `app_user`, `user_auth`, `user_role`, `user_sess`, `guest_sess`, `user_stat_hist`, `user_agr_yn_hist` |
| 대화·답변 | `chat_sess`, `chat_msg`, `ai_job`, `ans_cite`, `ans_feedback`, `cite_notice_read` |
| 사건·첨부 | `user_case`, `case_fact`, `case_task`, `case_hist`, `attach_doc`, `attach_doc_src`, `ai_job_doc`, `doc_quote` |
| 법령 | `legal`, `legal_ver`, `legal_ver_rev`, `legal_provi`, `legal_corr_hist`, `legal_chg_evt` |
| 판례 | `legal_prec`, `legal_prec_rev`, `legal_prec_provi`, `legal_prec_ref`, `legal_prec_ingest_hist`, `legal_prec_review_hist` |
| 원문·코드 | `src_snapshot`, `cmmn_cd`, `cmmn_cd_hist` |
| 용어 | `legal_term`, `legal_term_hist` |
| 기타 | `user_bmark`, `user_ntf`, `ai_model_hist`, `ai_call_log` |

## 이름

테이블과 컬럼은 `snake_case`를 씁니다. 테이블은 뜻이 드러나게 짓고, 컬럼은 약어를 씁니다.

| 약어 | 뜻 | 약어 | 뜻 |
|---|---|---|---|
| nm | 이름 | cd | 코드 |
| cont | 내용 | seq | 순서 |
| dttm | 일시 | dt | 날짜 |
| rgst | 등록 | upt | 수정 |
| stat | 상태 | del | 삭제 |
| sess | 세션 | msg | 메시지 |
| prnt | 부모 | provi | 조문 |

## 규칙

- **조문 번호는 문자열입니다.** `제10조의2`, `①`, `가.` 같은 표기를 `disp_no`에 그대로 두고, 정렬에는 `sort_seq`를 씁니다. 조, 항, 호를 테이블로 나누지 않고 `legal_provi` 안에서 부모 관계로 표현합니다.
- **공통코드**는 자기 자신을 참조하는 `cmmn_cd` 한 테이블로 관리합니다. API에는 숫자 대신 `ACT`, `PRES_DEC` 같은 코드를 씁니다.
- **일시**는 `TIMESTAMPTZ`, 공포일·시행일 같은 기준일은 `DATE`입니다.
- **삭제**는 `del_yn`, `del_dttm`, `del_id`를 갱신하는 방식만 씁니다. SQL `DELETE`나 Prisma의 `delete`는 쓰지 않습니다. 조회, 검색, 다운로드에서는 삭제된 자료와 그 하위 자료를 제외합니다.
- 개인정보 파기는 위의 삭제와 별개의 일이며, 방법은 아직 정하지 않았습니다.
