# AURORE

법규·판례 원문을 근거로 쉬운 설명을 제공하는 법령 해설 AI 프로젝트입니다. 이전 프로젝트명은 **Easy Law AI**입니다.

- 저장소: [orca305/AURORE](https://github.com/orca305/AURORE)
- [설계 문서 목록](docs/README.md)
- [승인된 방향과 검토 중인 설계](docs/DESIGN_REVIEW.md)
- [설계 결정 기록](docs/DECISIONS.md)

설계 기준은 [v3.2 설계 결정](docs/V3_2_SUMMARY.md)이며, 후속 사용자 요청으로 **기존 기능과 공통 기반의 코드 현행화**를 진행했습니다. [코드 현황·검증 범위](docs/CODE_STATUS.md)를 확인하세요. 40개 테이블 전체나 회원·채팅·사건·문서 기능을 구현한 상태는 아니며, 실제 DB 마이그레이션은 적용하지 않았습니다.

## 로컬 실행

Node.js 24와 pnpm 12 기준입니다. 기존 DB 설정은 루트 `.env.example`을 참고하고, 화면 설정은 `frontend/.env.example`을 참고합니다.

- 백엔드: `backend`에서 `pnpm install --frozen-lockfile`, `pnpm run prisma:generate`, `pnpm run build`, `pnpm run start:prod` 순서로 실행합니다. DB 적용 절차는 [백엔드 안내](backend/README.md)를 확인합니다.
- 화면: `frontend`에서 `pnpm install --frozen-lockfile`, `pnpm dev`로 실행합니다. API 기본 주소는 `http://127.0.0.1:3001`입니다.
- AI 서버: `ai-server`에서 별도 Python 가상환경에 `requirements.txt`를 설치한 뒤 `uvicorn main:app --reload --port 8000`으로 실행합니다. 현재는 서비스·상태 확인만 제공합니다.

## 기존 작업 폴더의 원격 주소 갱신

```powershell
git remote set-url origin https://github.com/orca305/AURORE.git
git remote -v
```

로컬 폴더 이름이 `easy-law-ai`여도 사용할 수 있습니다. 새 PC에서는 `git clone https://github.com/orca305/AURORE.git`으로 내려받습니다.
