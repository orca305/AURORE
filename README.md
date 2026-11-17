# AURORE

법규·판례 원문을 근거로 쉬운 설명을 제공하는 법령 해설 AI 프로젝트입니다. 이전 프로젝트명은 **Easy Law AI**입니다.

- 저장소: [orca305/AURORE](https://github.com/orca305/AURORE)
- [설계 문서 목록](docs/README.md)
- [승인된 방향과 검토 중인 설계](docs/DESIGN_REVIEW.md)
- [설계 결정 기록](docs/DECISIONS.md)

설계 기준은 v3.2 이후 사용자 결정과 현재 구현 문서입니다. 회원·대화·사건·첨부·관심 항목·알림·관리자·법률용어사전의 일반 기능을 개발했습니다. 로컬 LLM 기반의 실제 답변 품질과 GPU 운영 검증은 데스크탑에서 이어갑니다. 코드 존재와 예제 테스트를 서비스 완성으로 보지 않습니다.

**최신 시작점: [2026-11-17 데스크탑 인계](docs/DESKTOP_HANDOFF_20261117.md)**. 코드·DB·비공개 원본의 이전 범위와 실행 순서를 확인하세요. 과거 설계·코드 상태 문서는 작성 당시의 기록이며 현재 상태는 최신 인계와 기능 문서를 우선합니다.

## 로컬 실행

Node.js 24와 pnpm 12 기준입니다. 현재 개발 DB 설정은 `local-dev/.env`에서 관리하고, 화면 설정은 `frontend/.env.local`에서 관리합니다. 예제 파일에는 실제 비밀값을 넣지 않습니다.

- 백엔드: `backend`에서 `pnpm install --frozen-lockfile`, `pnpm run prisma:generate`, `pnpm run build`, `pnpm run start:prod` 순서로 실행합니다. DB 적용 절차는 [백엔드 안내](backend/README.md)를 확인합니다.
- 화면: `frontend`에서 `pnpm install --frozen-lockfile`, `pnpm dev`로 실행합니다. API 기본 주소는 `http://127.0.0.1:3001`입니다.
- AI 서버: `ai-server`에서 별도 Python 가상환경에 `requirements.txt`를 설치한 뒤 `uvicorn main:app --reload --port 8000`으로 실행합니다. 문서 텍스트 추출·근거 처리와 의도 분류 연결 기반을 제공합니다. OCR과 실제 로컬 LLM 답변 검증은 별도 후속 작업입니다.

## 기존 작업 폴더의 원격 주소 갱신

```powershell
git remote set-url origin https://github.com/orca305/AURORE.git
git remote -v
```

로컬 폴더 이름이 `easy-law-ai`여도 사용할 수 있습니다. 새 PC에서는 `git clone https://github.com/orca305/AURORE.git`으로 내려받습니다.
