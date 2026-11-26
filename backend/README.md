# 백엔드

NestJS, Prisma, PostgreSQL로 만든 API 서버입니다. 인증, 대화와 답변 작업, 사건, 첨부 문서, 법령·판례 검색, 용어사전, 관리자 기능을 담당합니다. 기본 포트는 3001입니다.

## 실행

```powershell
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run build
pnpm run start:prod
```

`DATABASE_URL`이 필요합니다. 개발 중에는 `pnpm run start:dev`를 씁니다.

서버를 켠다고 DB가 바뀌지는 않습니다. 새 마이그레이션이 있으면 백업한 뒤 `pnpm run db:deploy`로 적용합니다. `migrate reset`은 데이터를 지우므로 쓰지 않습니다.

## 검사

```powershell
pnpm run test
pnpm run test:e2e
pnpm exec tsc --noEmit
pnpm run lint
```

## 폴더

- `src/`: 기능별 모듈(`auth`, `chat`, `cases`, `documents`, `legal`, `terms`, `notifications`, `admin` 등)
- `prisma/`: 스키마와 마이그레이션
- `tools/`: 데이터 수집, 평가, 백업 스크립트. 사용법은 각 파일 첫머리에 있고, 자주 쓰는 것은 [데이터 수집](../docs/DATA_COLLECTION.md)에 정리했습니다.
