# 데이터 수집

모두 저장소 루트에서 실행합니다. 법제처 Open API 인증값(`MOLEG_OC`)이 필요하고, `local-dev/.env`에 둡니다. 법제처 사이트에서 사용할 자료 종류를 신청해야 응답이 옵니다.

수집 도구는 받은 원문의 해시를 확인하고, 중간에 멈추면 다시 실행해 이어 받습니다. 각 스크립트의 옵션은 파일 첫머리 설명을 보세요.

## 법령

- `backend/tools/collect-current-laws.mjs`: 현행 법령
- `backend/tools/collect-law-history.mjs`: 이전 판본
- `backend/tools/embed-provisions.mjs`: 의미 검색용 조문 임베딩(Ollama의 bge-m3)

## 판례

대법원 판례를 기간별로 나눠 받아 DB에 반영합니다.

```powershell
node --env-file=local-dev/.env --use-system-ca backend/tools/collect-supreme-precedents.mjs --from 2020 --to 2026
```

판결문 본문에 특정 법령 이름이 나오는 판례만 받을 수도 있습니다.

```powershell
node --env-file=local-dev/.env --use-system-ca backend/tools/collect-supreme-precedents.mjs --query "주택임대차보호법" --from 2000
```

- 기록 폴더의 기본 위치는 `D:/DATA/precedent-supreme`(검색어를 쓰면 `D:/DATA/precedent-law/<검색어>`)이고, 첫 번째 인자로 바꿀 수 있습니다.
- 반영 없이 받기만 하려면 `--no-apply`를 붙입니다.
- 목록에는 있어도 본문을 받을 수 없는 판례는 제외합니다.
- 응답 오류가 난 기간은 건너뜁니다. 나중에 같은 명령을 다시 실행하면 이어서 받습니다.

판례와 조문은 참조조문을 기준으로 연결합니다(`backend/tools/index-precedent-refs.mjs`).

## 법률용어

- `backend/tools/collect-all-terms.mjs`: 법제처 용어 정의 수집
- `backend/tools/rank-terms-by-usage.mjs`: 현행 조문에서 많이 쓰는 용어 고르기
- `backend/tools/import-ranked-terms.mjs`: 고른 용어를 초안으로 가져오기
- `backend/tools/seed-easy-terms.mjs`: 조문 인용 정의와 쉬운 풀이 등록

용어는 초안으로 들어온 뒤 공개해야 사전에 보입니다. 관리자 화면에서도 하나씩 가져오고 고칠 수 있습니다. 정의를 직접 고친 용어는 다시 수집해도 덮어쓰지 않습니다.

## 예약 수집

법령 수집과 DB 백업은 예약 실행기로 돌릴 수 있습니다. 설정 예시는 `local-dev/collection-scheduler.example.json`이고, 설정이 없으면 모든 예약이 꺼져 있습니다.

```powershell
node backend/tools/collection-scheduler.mjs --status
```

```powershell
node --env-file=local-dev/.env --use-system-ca backend/tools/collection-scheduler.mjs --watch
```
