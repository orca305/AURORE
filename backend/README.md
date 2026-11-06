# AURORE API

NestJS·Prisma·PostgreSQL 기반의 법규 목록·등록 및 공통코드 조회 API다. 전체 제품 기능은 [코드 현황](../docs/CODE_STATUS.md)과 구분한다.

## 실행

Node.js 24와 pnpm 12 기준이며, 이 디렉터리에서 실행한다.

```powershell
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:validate
pnpm run build
pnpm run start:prod
```

루트 `.env`의 `DATABASE_URL`이 필요하다. 기본 포트는 3001이다. 개발 중에는 `pnpm start:dev`를 사용한다. 실행 시 자동 마이그레이션이나 DB 초기화는 하지 않는다.

## DB 적용 전 확인

후속 마이그레이션은 기존 `laws` 데이터를 유지하면서 `legal`로 이름과 타입을 전환하고 버전·조문·원본·공통코드 테이블을 추가한다. 실제 DB에는 아직 적용하지 않았다. 백업, 기존 마이그레이션 이력과 스키마, 기존 시각이 UTC인지 확인한 뒤 별도로 적용한다. 앱과 DB를 함께 배포해야 하며 이전 앱 바이너리와 변경된 DB는 호환되지 않는다.

적용 대상으로 명시적으로 선택한 DB에만 `pnpm run db:deploy`를 사용한다. `migrate reset`이나 기존 볼륨 삭제로 해결하지 않는다. 기존 `legal` 등 동명 테이블이 있으면 먼저 충돌을 분석한다. 메모리 DB 테스트 통과가 실제 PostgreSQL 17 배포 검증을 대신하지 않는다.

## API

| 주소 | 동작 |
| --- | --- |
| `GET /` | 서비스명 |
| `GET /legals?q=민법&limit=20&offset=0` | 삭제되지 않은 법규 이름 검색 |
| `POST /legals` | `{ "srcCd": "LEGACY", "srcKey": "001", "legalNm": "법규명" }` 등록 |
| `GET /legals/:id/versions` | 삭제되지 않은 법규 버전 목록 |
| `GET /legals/:id/versions/:versionId/provisions` | 같은 버전의 보이는 조문 목록 |
| `GET /common-codes?path=AURORE/LEGAL_GRP/LAW` | 활성 경로 바로 아래의 의미형 코드 조회 |
| `GET /laws`, `POST /laws` | 이전 `lawId`, `lawName` 필드명 호환. 등록 출처는 `LEGACY` |

목록은 기본 20개·최대 100개, offset은 최대 100000이다. 식별자는 BIGINT 손실 방지를 위해 JSON 문자열이다. 공통코드는 최대 100개를 반환한다. 조문 번호는 `제10조의2`, `①` 등 원문 문자열을 유지한다. 공포·시행일은 데이터이며 자동 법률 적용 판정은 제공하지 않는다.

모든 등록 주소는 `Authorization: Bearer …`가 필요하다. 루트 `.env`의 `LEGAL_INGEST_TOKEN`을 32바이트 이상의 무작위 비밀값으로 설정해야 활성화된다. 설정이 없으면 503, 인증 실패는 401, 중복 등록은 409, 입력 오류는 400이다. 수집 전용 인증이며 회원·관리자 인증이 아니다. 비밀값을 화면이나 Git에 넣지 않는다. 등록 API는 기본정보만 저장하며 공식 원문 수집·버전 적재 기능은 아직 없다.

## 검증

```powershell
pnpm run test
pnpm run test:e2e
pnpm exec tsc --noEmit
pnpm run lint
```

단위·메모리 DB 테스트 12개 및 HTTP 테스트 3개다. PGlite는 개발 전용이며 기존 DB에 연결하지 않고 마이그레이션·데이터 보존·제약을 검증한다. HTTP 테스트도 DB를 대체하므로 실제 PostgreSQL 연결 테스트와는 구분한다.
