# 법률용어 쉬운 풀이 등록과 대화 용어 툴팁 — 2026-11-20

## 용어 등록 (초안 66개)

- 정의 칸은 법제처 용어 API가 아니라 **DB에 저장된 현행 조문의 원문 인용**이다. 법제처 용어 API는 조회한 77개 중 19개만 있었고 대부분 영어 번역(예: 보증금 = "security deposit")이라 한글 공식 정의로 쓸 수 없었다.
- 인용문은 `backend/tools/easy-terms.json`의 앵커(`from`/`to`) 사이를 `backend/tools/seed-easy-terms.mjs`가 DB 원문에서 **그대로 잘라** 저장한다(손으로 옮겨 적지 않음). 출처는 국가법령정보센터 조문 링크와 시행본 기준일이다.
- 쉬운 풀이(`easy`)는 Claude가 작성한 일반 설명이다. 법률 자문이 아니며, 사람이 검토하기 전에는 공개하지 않는다.
- 66개 모두 `DRAFT`로 등록했다. 공개는 관리자 화면(/admin/terms)에서 검토 후 한다. 공개 전에는 사전 화면과 대화 툴팁에 나타나지 않는다.
- 실행: 먼저 `node --env-file=local-dev/.env backend/tools/seed-easy-terms.mjs`(미리 보기, 저장 안 함), 이어서 `--apply`(관리자 계정 `TERMS_ADMIN_ID`/`TERMS_ADMIN_PW` 환경변수 필요, 이미 있는 이름은 건너뜀).
- 관리자 계정 1개(닉네임 관리자)를 가입 API로 만들고 `user_role`에 ADMIN을 부여했다.

## 대화 용어 하이라이트·툴팁

- 오로르 답변 텍스트에서 **공개된** 용어(이름·동의어)를 찾아 점선 밑줄·배경으로 표시한다. 마우스를 올리거나 키보드로 초점을 주면 쉬운 풀이 툴팁이 나오고, 클릭하면 `/terms/{id}`가 새 탭으로 열린다.
- 가장 긴 이름을 먼저 맞추고(평균임금 안의 임금은 표시하지 않음), 한 글자 이름은 제외하며, 같은 용어는 답변마다 첫 번째만 표시한다. 사용자 메시지와 원문 인용(blockquote)은 바꾸지 않는다.
- `GET /api/terms/glossary`가 공개·미삭제 용어의 이름·동의어·짧은 설명만 전달한다. 실패하면 하이라이트 없이 원문 그대로 보여 준다.
- 파일: `frontend/app/_conversation/term-match.ts`(순수 함수), `term-highlight.tsx`, `frontend/app/api/terms/glossary/route.ts`, 스타일 `conversation.module.css`.
- 시험: `node --test frontend/tools/term-match.test.mjs` 4개 통과. 프런트 빌드·tsc·eslint 통과. 브라우저에서 가짜 목록을 주입해 하이라이트·툴팁·링크를 확인했다(실제 공개 용어가 없어서).
