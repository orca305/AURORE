# 운영

Windows 컴퓨터 한 대에서 돌리는 것을 기준으로 합니다.

## 처음 설치

1. `.env.example`과 `frontend/.env.example`을 참고해 `local-dev/.env`, `frontend/.env.local`을 만듭니다.
2. `backend`와 `frontend`에서 `pnpm install --frozen-lockfile`을 실행합니다. 백엔드는 `pnpm run prisma:generate`와 `pnpm run build`, 화면은 `pnpm build`까지 합니다.
3. `ai-server/.venv`에 가상환경을 만들고 `requirements.txt`를 설치합니다.
4. Ollama에 로컬 모델과 `bge-m3`를 받습니다. 품질 우선 프로필은 `local-dev/models/aurore-12b.Modelfile` 첫 줄의 안내대로 만듭니다.
5. DB를 띄운 뒤 `backend`에서 `pnpm run db:deploy`로 마이그레이션을 적용합니다.

`local-dev/.env`에 `ANTHROPIC_API_KEY`가 있으면 답변에 Claude Haiku를 씁니다. 없으면 로컬 모델만 씁니다.

## 켜고 끄기

```powershell
powershell -ExecutionPolicy Bypass -File local-dev/start-desktop.ps1
```

`local-dev/supervise-desktop.ps1`을 실행해 두면 화면, 백엔드, AI 서버, Ollama를 확인해 꺼진 것을 다시 켭니다. 로그는 `local-dev/runtime`에 남습니다. 로컬 모델은 `local-dev/switch-model.ps1`로 바꿉니다.

## 백업

백업 도구는 DB를 덤프한 뒤 임시 DB에 복원해 내용이 같은지까지 확인합니다. 기존 DB에는 쓰지 않습니다. 백엔드를 빌드한 상태에서 실행합니다.

```powershell
node --env-file=local-dev/.env backend/tools/verify-db-backup.mjs
```

- 기본 저장 위치는 `%LOCALAPPDATA%/AURORE/backups`이고 `AURORE_BACKUP_DIR`로 바꿀 수 있습니다.
- 이미 만든 백업은 `--verify <폴더>`로 다시 확인합니다.
- 덤프에는 계정과 대화 내용이 들어 있으니 개인 저장소에만 두고 Git에 올리지 않습니다.
- 새 백업이 검증되면 7일이 지난 백업을 정리합니다.
- `.env` 같은 설정 파일은 백업에 포함되지 않습니다.

## 외부 공개

화면(3000)만 Cloudflare 터널로 내보내고, 접속 코드를 입력한 사람만 들어오게 합니다.

1. `cloudflared` 실행 파일을 `local-dev/deploy/bin/cloudflared.exe`에 둡니다.
2. `cloudflared tunnel login`으로 본인 계정에 로그인합니다.
3. `cloudflared tunnel create aurore`로 터널을 만들고 `cloudflared tunnel route dns aurore <주소>`로 주소를 연결합니다.
4. `cloudflared-config.example.yml`을 `cloudflared-config.yml`로 복사해 채웁니다.
5. `frontend/.env.local`에 `AURORE_ACCESS_CODE`를 설정합니다.
6. 터널을 켭니다. 서비스 상태와 접속 코드 보호를 먼저 확인하고, 문제가 있으면 열지 않습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File local-dev/deploy/start-tunnel.ps1
```

설정 파일, 터널 인증 파일, 실행 파일은 Git에 올리지 않습니다. 코드를 바꾸고 화면을 다시 켜면 이전 접속은 모두 끊깁니다.

알아 둘 점은 다음과 같습니다.

- 질문은 외부 AI로 전송됩니다. `AURORE_DAILY_COST_LIMIT_USD`는 알림 표시용이며 호출을 막지 않습니다.
- 이용약관과 개인정보 처리방침의 법률 검토 전에는 접속 코드 없이 공개하지 않습니다.
- 컴퓨터가 꺼지면 서비스도 멈춥니다. 감시 스크립트는 터널을 다시 켜지 않습니다.
