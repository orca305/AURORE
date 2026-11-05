# DB 설계 초안 — v1.2 통합

**검토용·물리설계 미승인.** 아래 타입·컬럼·제약·인덱스는 제안이며 DDL이나 현재 구현 명세가 아니다. [승인된 방향](DESIGN_REVIEW.md)과 구분한다. 후속 사용자 결정에 따라 사건은 회원만, 확인 후 저장하며 API 원본은 PostgreSQL, 일반 업무 삭제는 소프트 삭제로 정정했다.

## 1. 공통코드

`cmmn_cd`와 `cmmn_cd_hist`의 두 테이블 방향을 채택한다.

| 테이블 | 주요 컬럼 초안 | 검토할 제약 |
| --- | --- | --- |
| `cmmn_cd` | `id` BIGINT, `cd` VARCHAR(50), `prnt_cd_id` BIGINT NULL, `cd_nm`, `cd_desc`, `sort_seq`, `use_yn`, `sys_yn`, 감사 컬럼 | 자기참조 FK, 자기 자신·순환 금지, 코드 식별 범위, 허용 계층 |
| `cmmn_cd_hist` | `id`, `cmmn_cd_id`, 변경 전후 JSONB, 변경 유형·사유·행위자·일시 | 코드 변경과 이력 기록의 원자성, 이력 수정 제한 |

예시 트리는 `LEGAL_GRP → LAW → ACT / PRES_DEC / PM_ORD / MIN_ORD`, `LEGAL_GRP → ADMIN_RULE → NOTICE / DIR / EST_RULE`이다. 조약·자치법규도 확장 대상이나 전체 코드 목록은 미확정이다. 이전 예시의 상위·하위 `LOCAL_RULE` 중복은 그대로 확정하지 않는다. `USER_STAT`, `PROVI_TYPE`, `REL_TYPE` 등은 별도 루트 후보다.

`legal_grp_cd = LAW`, `legal_type_cd = PRES_DEC`의 부모·자식 일치를 검증해야 한다. 문자열 코드와 내부 ID 중 FK 표현 방식, 전역/루트별 유일성, 필수 시스템 코드 보호는 승인 전 결정한다.

## 2. 법규·판례·원본·검색

| 개념·테이블 후보 | 역할·관계 | 컬럼·검토 사항 |
| --- | --- | --- |
| `legal` | 법규 자체의 안정적 식별 | 외부 식별자·출처, 명칭, 분류·유형 코드; 출처별 동일성 |
| `legal_ver` | `legal`의 버전 | 공포·시행일, 버전 식별자, 원문 연결, 조문별 시행일과 현재 버전 판정 |
| `legal_provi` | `legal_ver` 내부 자기참조 구조 | 아래 조문 컬럼; 부모와 자식의 동일 버전 보장 |
| `legal_prec` | 판례 원문·메타데이터 | 법원·사건번호·선고일·출처·원문, 정정 및 중복 식별 |
| `src_snapshot` | PostgreSQL에 공식 API 원본 보존 | 원본 본문, 출처 URL/기관, 외부 ID, 수집일시, 형식, 해시 후보; 원문 재현 가능성 |
| 법규 관계 후보 | 위임·인용·참조 및 판례 연결 | 출발·대상 법규/조문/버전, 관계 유형, 효력 시점; 테이블명·제약 미확정 |
| 검색 청크·임베딩 후보 | 원문에서 파생되는 검색 자료 | 원문/버전/위치 FK, 청크 순서, 모델·차원·생성 버전; 재생성 가능하도록 분리 |

`legal_provi`의 주요 컬럼 후보: `id`, `legal_ver_id`, `prnt_provi_id`, `provi_type_cd`, `src_cd`, `disp_no`, `norm_no`, `sort_seq`, `provi_nm`, `provi_cont`, `enfc_dt`, `cont_hash`, `rgst_dttm`, `upt_dttm`.

노드 유형은 PART, CHAPTER, SECTION, ARTICLE, PARAGRAPH, ITEM, SUBITEM, ANNEX, APPENDIX, ETC 등을 표현할 수 있다. 번호는 문자열이고 원문·구조를 보존한다. 법규·버전·판례를 사용자 대화 삭제와 함께 물리 삭제하지 않는다. 원문 보존과 정정·접근 제한은 별도 정책으로 검토한다.

## 3. 회원과 비회원

`app_user`(회원)와 `guest_sess`(비회원 세션)를 분리하는 초안이다. `app_user.id` BIGINT, `guest_sess.id` UUID가 후보이며 인증정보·세션 수명·로그인 수단의 상세는 미확정이다. 비회원 대화는 1개월 보관 방향이다. 기산점·달력상 1개월 계산·접속 갱신·만료 작업의 실행 시점은 승인 전 확정한다. 회원의 대화 보유기간이 무제한이라는 뜻은 아니다.

## 4. 질의응답 — 5개 테이블 초안

| 테이블 | 주요 컬럼·타입 후보 | 무결성·인덱스 후보 |
| --- | --- | --- |
| `chat_sess` | `id` UUID, `user_id` BIGINT NULL, `guest_sess_id` UUID NULL, `user_case_id` UUID NULL, `sess_nm`, `stat_cd`, `last_msg_dttm`, `expr_dttm` | 회원/비회원 소유자 정확히 하나(XOR); 연결 사건과 소유자 동일; 회원+수정일, 비회원+만료일 인덱스 |
| `chat_msg` | `id` UUID, `chat_sess_id`, `prnt_msg_id` UUID NULL, `role_cd`, `msg_seq` INTEGER, `msg_cont` TEXT NULL, `stat_cd` | UNIQUE(대화방, 순번); 부모 메시지는 같은 대화방; 본문/첨부 중 하나 필요 |
| `ans_seg` | `id` BIGINT, `msg_id` UUID, `seg_seq` INTEGER, `seg_cont` TEXT, `seg_type_cd` | UNIQUE(메시지, 구간 순번); AI 답변만 연결; EXPL/CAUTION/CONCLUSION은 코드 예시 |
| `ans_cite` | `id` BIGINT, `msg_id`, `ans_seg_id` NULL, `legal_provi_id` NULL, `legal_ver_id` NULL, `legal_prec_id` NULL, `attach_doc_id` NULL, `cite_type_cd`, `cite_cont`, `src_url`, `verify_stat_cd`, `sort_seq` | 인용 유형별 FK 조합; 같은 답변의 구간; (메시지, 표시 순서) 인덱스 |
| `ans_fback` | `id` BIGINT, `msg_id`, `user_id` NULL, `guest_sess_id` NULL, `fback_type_cd`, `fback_cont`, `stat_cd` | 소유권·평가자 검증; 일반 평가는 사용자별 최신 1건, 오류 신고는 복수 허용하는 초안 |

필요한 등록·수정 감사 컬럼과 삭제 컬럼을 함께 설계한다. `LEGAL` 인용은 버전 또는 조문을 참조하고 둘을 함께 지정하면 해당 버전의 조문이어야 한다. `PREC`는 판례, `USER_DOC`는 회원 소유 첨부파일을 참조한다. 단순히 모든 FK 중 하나만 허용하는 제약은 부적합하다. 구체 CHECK·복합 FK·트랜잭션 검증 방식은 미승인이다. 원문 검증 실패·부족 시 확정 인용으로 표시하지 않는다. 답변 오류 정정 이력은 후속 과제다.

## 5. 사건관리 — 2개 테이블 초안

| 테이블 | 주요 컬럼 후보 | 정정된 정책·제약 |
| --- | --- | --- |
| `user_case` | `id` UUID, `user_id` BIGINT NOT NULL, `case_nm`, `case_type_cd`, `stat_cd`, 감사·삭제 컬럼 | 회원만 지원. 비회원 소유 FK는 채택하지 않음. 사용자 확인 후 저장 |
| `case_fact` | `id` BIGINT, `user_case_id`, `fact_type_cd`, `fact_val` JSONB, `src_msg_id` NULL, `verify_stat_cd`, 감사·삭제 컬럼 | 같은 회원의 사건·출처 메시지만 연결; 사실 유형별 필드·타입·길이·마스킹 제한 |

AI 추출 후보와 사용자 확인 사실은 구분한다. 자동 추출만으로 사건을 영구 저장하지 않는다. 확인 화면·미확인 임시 데이터 수명·변경이력은 미확정이다. `case_fact(user_case_id, fact_type_cd)`는 조회 인덱스 후보이며 동일 유형 복수 사실을 금지한다고 확정하지 않는다.

## 6. 첨부파일 — 3개 테이블 초안

| 테이블 | 주요 컬럼 후보 | 제약·정책 |
| --- | --- | --- |
| `attach_doc` | `id` UUID, 필수 `user_id`, 원본 파일명, 확인된 MIME, 크기, 해시, 비공개 저장 키, 상태 | 회원 전용, 저장 키 고유, 크기 제한은 미확정 |
| `chat_msg_doc` | `id` BIGINT, `msg_id`, `attach_doc_id` | UNIQUE(메시지, 파일); 대화·문서 소유자 일치 |
| `doc_parse` | `id` BIGINT, `attach_doc_id`, 파싱 버전, 상태, 추출문·페이지 위치 | PENDING/SUCCESS/PARTIAL/FAILED는 상태 예시; 재처리·버전 관리 |

HWP/HWPX 초기 지원 목표를 유지한다. 실패·부분 파싱을 완전 판독으로 표시하지 않는다. 파일 실물 위치와 파서는 미확정이다. 소프트 삭제 즉시 파일·추출문·인용 접근을 차단하고, 별도 파기 때 실제 파일·추출문·임시파일·인용 복사본까지 처리한다.

## 7. 법률용어 사전 — 구조 미확정

법률용어와 쉬운 설명, 동의어·약어, 공식 정의·출처 및 관련 법규/조문을 연결하는 방향으로 검토한다. 공식 정의와 AI 설명은 구분하고 출처·버전·검수 상태를 추적한다. 용어·동의어·법규 연결을 분리할지, 테이블명·유일성·시점 관리를 어떻게 할지는 후속 설계다. 임의의 테이블 목록을 승인된 스키마로 취급하지 않는다.

## 8. 관심 항목·개정 알림 — 3개 테이블 초안

| 테이블 | 역할·참조 후보 | 제약·인덱스 후보 |
| --- | --- | --- |
| `user_bmark` | 회원의 법규 또는 판례 관심 항목 | 대상 종류별 FK 조합, 활성 회원·법규/판례별 중복 방지 |
| `legal_chg_evt` | 법규 버전의 공포·시행 이벤트, 선택적 조문 참조 | 버전·유형·기준일·대상 범위별 중복 방지; 법규+이벤트일 인덱스 |
| `user_ntf` | 회원별 사이트 내 알림, 이벤트 참조, 읽음 상태 | 회원·이벤트·알림 유형 중복 방지; 회원+읽음+생성일 인덱스 |

공포와 시행을 분리하고 같은 버전 내 조문별 다른 시행일을 고려한다. NULL 대상이 있는 중복 제약은 단순 UNIQUE만으로 충분한지 검토한다. 재수집·재시도에 중복 알림이 생기지 않아야 한다. 이메일·문자·푸시 채널은 확정하지 않았다.

## 9. 삭제와 데이터 수명

일반 업무는 물리 삭제 없이 `del_yn`, `del_dttm`, `del_id`를 갱신한다. FK 물리 CASCADE는 업무 삭제 정책으로 채택하지 않는다.

| 삭제 대상 | 함께 다룰 범위 |
| --- | --- |
| 대화방 | 메시지·답변 구간·근거·평가·첨부 연결의 소프트 삭제/비노출 |
| 사건 | 사실관계 비노출·소프트 삭제, 연결 대화의 처리 범위는 검토 |
| 첨부파일 | 다운로드 차단, 추출 결과·인용 복사본·검색 자료 비노출, 후속 파기 |
| 회원 탈퇴/비회원 만료 | 즉시 접근 차단 후 보유 근거에 따른 별도 파기 절차 |
| 공공 법규·판례 | 사용자 데이터 삭제와 분리, 원문 이력 참조 보존 정책 검토 |

소프트 삭제 전파는 트랜잭션 또는 재시도 가능한 작업으로 설계하되 부분 실패 중에도 접근을 막아야 한다. 복구 권한과 종속 데이터 복구 범위는 미확정이다. 활성 행의 UNIQUE, 기존 참조 보존, 삭제된 행을 이용한 권한 우회 방지도 검토한다.

개인정보 파기 예외 절차는 원문뿐 아니라 질문·답변·사실관계·추출문·인용·임베딩·캐시·로그·백업을 포함해 검토한다. 필드 제거·익명화·키 폐기·파일 파기는 후보이며 물리 SQL `DELETE` 허용은 미승인이다. 파기 완료 판정·증적에는 개인정보를 재복사하지 않는다.

v1.2의 대화 5개 + 사건 2개 + 첨부 3개 + 알림 3개는 총 13개 테이블 초안이다. 위의 법규·회원·코드·사전 후보를 포함한 전체 확정 테이블 수를 뜻하지 않는다.
