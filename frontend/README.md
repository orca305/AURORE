# AURORE 법규 검색 화면

Next.js 기반 한국어 법규 목록·검색 화면이다. 백엔드 데이터를 서버에서 조회하며 API 장애와 결과 없음 상태를 구분한다. 회원·채팅·사건 기능은 제공하지 않는다.

Node.js 24·pnpm 12 기준으로 이 디렉터리에서 실행한다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

필요하면 `.env.example`을 `.env.local`로 복사하고 `BACKEND_URL`을 설정한다. 기본값은 `http://127.0.0.1:3001`이며 수집 토큰 등 인증정보를 넣을 필요가 없다. 백엔드는 별도로 실행한다.

```powershell
pnpm lint
pnpm build
pnpm start
```

Windows 환경에서 Turbopack의 CSS 처리 프로세스 오류가 확인되어 프로덕션 빌드는 지원되는 Webpack 방식을 사용한다. 검색 요청은 캐시하지 않으며 응답 대기시간은 5초로 제한한다. 연결 실패 시 빈 목록으로 오인하지 않도록 오류를 표시한다. 외부 폰트 다운로드 없이 시스템 글꼴을 사용한다.
