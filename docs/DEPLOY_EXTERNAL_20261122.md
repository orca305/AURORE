# 외부 공개(Cloudflare 터널 + 접속 코드) 안내

이 컴퓨터에서 돌아가는 서비스를 인터넷에 열되, **접속 코드를 입력한 사람만** 들어오게 하는 방식이다.
화면(3000)만 터널로 내보내고, 백엔드(3001)·AI 서버(8001)·DB(5433)·Ollama(11434)는 이 컴퓨터 안(127.0.0.1)에서만 열려 있다.

## 지금 코드에 들어간 보호
- 접속 코드 보호: `frontend/proxy.ts` + `/gate` 화면. `frontend/.env.local` 의 `AURORE_ACCESS_CODE` 가 있으면 터널(Cloudflare)을 거친 요청은 코드를 입력해야 열린다. 이 컴퓨터에서 `localhost` 로 직접 열 때는 코드가 필요 없다.
- 틀린 코드를 8번 넣으면 10분 동안 그 접속 주소를 막는다.
- 개발용 화면(`/dev`)은 터널로는 열리지 않는다(404). 검색 엔진에는 `noindex` 헤더로 노출하지 않는다.
- 접속 코드를 바꾸면(`.env.local` 수정 후 화면 서버 재시작) 이전에 입력한 사람의 쿠키는 모두 무효가 된다.

## 준비 순서
1. **cloudflared 준비**: Cloudflare 공식 릴리스(2026.11.1)의 `cloudflared-windows-amd64.exe` 를 `local-dev/deploy/bin/cloudflared.exe` 에 둔다(설치 불필요, Git에는 올라가지 않음). GitHub 릴리스의 SHA256 과 일치하는지 확인했다.
2. **Cloudflare 로그인**: `local-dev/deploy/bin/cloudflared.exe tunnel login` → 브라우저가 열리면 본인 Cloudflare 계정으로 로그인하고 쓸 도메인을 고른다. (계정 로그인은 본인이 직접 한다.)
3. **터널 만들기**: `cloudflared tunnel create aurore` → 터널 ID 와 인증 파일(`~\.cloudflared\<터널ID>.json`)이 생긴다. 인증 파일은 비밀이다.
4. **주소 연결**: `cloudflared tunnel route dns aurore <공개 주소>` (예: `aurore.내도메인.com`).
5. **설정 파일**: `local-dev/deploy/cloudflared-config.example.yml` 을 `cloudflared-config.yml` 로 복사해 터널 ID, 인증 파일 경로, 공개 주소를 채운다. 이 파일은 Git에 올라가지 않는다.
6. **켜기**: `powershell -NoProfile -ExecutionPolicy Bypass -File local-dev/deploy/start-tunnel.ps1`
   - 켜기 전에 서비스가 정상인지, 접속 코드 보호가 실제로 막는지 스스로 확인하고, 하나라도 어긋나면 터널을 열지 않는다.
7. **끄기**: 터널 창을 닫거나 `cloudflared` 프로세스를 종료하면 바로 외부 접속이 끊긴다.

## 공유할 때
- 공개 주소와 접속 코드를 따로 전달한다(코드는 `frontend/.env.local` 의 `AURORE_ACCESS_CODE`).
- 접속자가 늘면 코드를 바꿔 다시 나눠 주는 방식으로 접근을 정리한다.

## 열기 전에 알아 둘 것
- **AI 비용**: 질문은 외부 AI(Anthropic Claude)로 전송된다. 일일 비용 알림 기준(`AURORE_DAILY_COST_LIMIT_USD`)을 설정해 두고 `/admin/ai-monitor` 에서 확인한다. 알림은 표시만 하고 호출을 막지는 않는다.
- **개인정보**: 이용 안내와 개인정보 처리방침은 아직 법무 검토를 받은 문구가 아니다. 지인 테스트 범위에서만 쓴다.
- **전체 공개 전에 필요한 것**: 접속 주소(IP)별 질문 횟수 제한, 비회원 세션 생성 제한, 약관·개인정보 처리방침 검토, 백업과 장애 대응. 지금은 이 항목들이 없어서 코드 보호 없이 전체 공개하면 안 된다.
- **이 컴퓨터가 꺼지면 서비스도 꺼진다.** `local-dev/supervise-desktop.ps1` 감시는 서비스(3000·3001·8001·Ollama)만 다시 켜고, 터널은 따로 켜야 한다.
- **계정 보호**: 관리자 계정 비밀번호는 충분히 길게 쓰고, 공개 중에는 `/admin` 화면에 불필요하게 들어가지 않는다.
