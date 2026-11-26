# 화면

Next.js로 만든 웹 화면입니다. 대화, 대화 기록, 나의 사건, 법령·판례 검색, 용어사전, 마이페이지, 관리자 화면이 있습니다.

## 실행

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`.env.example`을 `.env.local`로 복사해 백엔드 주소(`BACKEND_URL`) 등을 설정합니다. 백엔드는 따로 켜야 합니다.

배포용 빌드는 다음과 같습니다.

```powershell
pnpm lint
pnpm build
pnpm start
```

Windows에서 Turbopack의 CSS 처리 오류가 있어 빌드는 Webpack을 사용합니다.
