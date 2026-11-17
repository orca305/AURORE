# 데스크탑 작업 인계 — 2026-11-17

## 저장소와 오늘 작업

- 실제 코드: C:\dev\easy-law-ai. origin=https://github.com/orca305/AURORE.git, main.
- 완료: 검색·목록 UI 정리, 관심 항목, 법령/관심 판례 정정 알림, 학습 활용 동의·철회 및 이력, 탈퇴·보관 점검, 법률용어사전 공개/검토/이력, 법제처 용어 선택 수집.
- 법제처 용어 수집은 정의·출처를 자동 채운 검토 초안이다. AI 쉬운 풀이·자동 품질 판정·자동 공개는 아직 아니다. 운영 관리 → 용어사전 → 법제처에서 가져오기.
- OCR은 추후 연결한다. 사용자가 화면 위치를 직접 확인한다.
- 노트북의 AURORE_INTENT_CLASSIFY=0 유지. 학습·분류기 평가·로컬 LLM 검증은 데스크탑에서 재개한다. 기존 의도 분류 결과는 목표 미달이며 실제 응답 분기는 비활성이다.
- 현재 Docker PostgreSQL 17 개발 DB는 37개 public 테이블, 마이그레이션 31개까지 적용했다. 마지막은 20261117050000_term_source_import. 최종 확인 시 법률용어 및 MOLEG_TERM 원본은 0개이며 합성 시험 자료는 임시 DB에서만 사용했다.

## 코드 받기

기존 데스크탑 작업 폴더에서 먼저 git status로 미커밋 변경을 확인한 뒤 git pull --ff-only origin main을 실행한다. 새 환경이면 저장소를 clone한다. 기존 변경을 reset하거나 덮어쓰지 않는다. 가능하면 노트북과 같은 C:\dev\easy-law-ai 경로를 사용한다.

## 설정·DB·원본은 별도 이전

Git에는 코드·마이그레이션·문서만 들어간다. local-dev/.env, frontend/.env.local, DB 데이터, 비공개 원본/수집 이력, 백업, Python 가상환경과 모델 산출물은 자동 전송되지 않는다.

- 데스크탑의 local-dev/.env에 POSTGRES_PASSWORD, DATABASE_URL, MOLEG_OC 및 필요한 운영 경로·인증 설정을 준비한다. 기존 비밀값을 Git에 넣지 않는다.
- 현재 개발 DB 접속 기준: 127.0.0.1:5433 / DB·사용자 aurore_dev_check. PostgreSQL 컨테이너 안 포트는 5432다. 비밀번호는 환경 파일 값이다.
- frontend/.env.local의 BACKEND_URL은 기본 http://127.0.0.1:3001. AI 서버 주소·공식 스냅샷 경로는 데스크탑의 실제 설정에 맞춘다.
- 기존 노트북 자료까지 이어쓰려면 PostgreSQL 백업과 local-dev/snapshots, refresh-runs, precedent-runs, collection-scheduler 등 실제 사용 중인 비공개 파일을 별도 안전한 경로로 옮긴다. 코드 pull만 하면 데이터가 따라오지 않는다. 기존 데스크탑 DB가 있으면 덮어쓰지 말고 별도 복원 DB에서 확인한다.
- 검증한 백업은 노트북 %LOCALAPPDATA%\AURORE\backups 아래에 있다. 2026-11-17T06:43:53Z 백업은 이번 마지막 마이그레이션 적용 전 37개 테이블·500행을 독립 복원 검증한 자료다. 복원 후 마이그레이션을 적용하면 된다. 실제 파일 이전과 데스크탑 복원은 아직 하지 않았다.
- 8TB HDD는 보유 장비 계획이다. 현재 Docker 볼륨을 그 디스크로 옮기는 작업은 하지 않았다. 데스크탑에서 실제 경로·용량·별도 백업을 확인한 후 구성한다.

## 실행 순서

Node.js 24, pnpm 12, Docker Desktop이 필요하다. 먼저 자신의 설정과 사용할 DB를 확인한다.

1. local-dev에서 docker compose up -d로 PostgreSQL을 준비한다. 새 DB를 쓰면 빈 DB이므로 기존 자료는 별도 복원이 필요하다.
2. backend에서 pnpm install --frozen-lockfile, pnpm prisma:generate를 실행한다.
3. 복원할 자료가 있으면 먼저 복원 검증을 한다. 그다음 대상 DATABASE_URL을 확인하고 pnpm db:deploy를 실행한다. migrate reset이나 볼륨 삭제는 사용하지 않는다.
4. backend에서 pnpm build 후 필요에 따라 HOST=127.0.0.1, PORT=3001, AURORE_INTENT_CLASSIFY=0을 설정하고 node --use-system-ca dist/main.js로 실행한다. 시스템 인증서 옵션은 TLS 검증을 끄는 옵션이 아니다.
5. frontend에서 pnpm install --frozen-lockfile, pnpm build, pnpm start --hostname 127.0.0.1 --port 3000 순서로 실행한다.
6. 로그인·회원/관리자 접근·대화/사건·법령/판례·관심/알림·용어사전 화면을 확인한다. 관리자 역할은 로그인 ID 문자열만으로 자동 부여하지 않는다. 기존 역할 DB가 함께 있어야 기존 관리자가 이어진다.
7. AI 서버는 데스크탑 전용 Python 가상환경을 만들고 requirements.txt를 설치한다. 노트북 .venv를 복사하지 않는다. 로컬 모델과 GPU 연결은 아래 후속 작업으로 진행한다.

## 다음 작업 우선순위

1. 데스크탑 저장소·설정·DB/원본 복원 상태와 RTX 4070 Ti 실제 VRAM·드라이버를 확인한다.
2. 보유 장비에 맞는 로컬 LLM을 연결하고 실제 근거 검색·원문 인용 검증·근거 적합성·응답 시간·동시 요청을 평가한다. 규칙/합성 예제 동작을 실제 AI 성능으로 보지 않는다.
3. 법률용어 쉬운 풀이 초안을 AI로 생성하는 연결을 추가한다. 공식 정의는 원문 그대로 보존하고 별도 풀이로 관리한다.
4. 의도 분류 데이터와 문맥 평가를 확충한다. AURORE_INTENT_CLASSIFY=1은 호출 허용이며 Python 평가 기준·라우팅 활성화와는 별개다. 준비 전 성능 기준을 우회하지 않는다.
5. 클로즈베타 AI 제공 방식과 운영 성능을 실제 장비 결과로 결정한다. OCR은 후순위다.

## 검증 기록

서버 단위 43개, 프런트/백엔드 빌드, 프런트 정적 검사 통과. 백엔드 정적 검사 기존 경고 10개 유지. 법률용어사전·수집 임시 DB 통합 2개, 수집 HTTP/파서 경계 3개와 인증된 화면 서버 응답을 통과했다. 오늘 다른 일반 기능의 검증은 해당 기능 문서와 최종 마감 검사 출력을 함께 본다. 이번 마감에 노트북에서 모델 학습·추론·성능 평가를 재실행하지 않는다.

연결 문서: [법제처 수집](TERM_SOURCE_IMPORT.md), [용어사전](LEGAL_TERMS.md), [요구사항 대조](REQUIREMENTS_REVIEW_20261117.md), [의도 분류 상태](INTENT_CLASSIFIER_20261117.md), [학습 동의](LEARNING_CONSENT.md), [탈퇴](ACCOUNT_WITHDRAWAL.md).

### 마감 재확인 한계

커밋 직전 관심 항목·알림·동의/탈퇴·용어사전 통합 7건을 다시 확인하려 했으나 Docker Desktop Linux Engine이 종료되어 임시 DB 생성 단계에서 중단됐다. 제품 동작 단계의 실패로 판정하지 않으며 이번 재실행을 통과로 기록하지 않는다. 같은 실행의 외부 응답 경계 3건은 통과했다. 앞서 완료한 용어사전/수집 DB·화면 검사와 서버 단위 43개 결과는 위 기록과 같다. 종료 준비 중인 노트북에서 Docker를 임의 재기동하지 않았다. 데스크탑에서는 Docker 기동 및 DB 준비 후 일반 기능 통합 검사를 재개한다.
