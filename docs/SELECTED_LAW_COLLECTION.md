# 임대차 외 현행 법령 수집

2026-11-18 사용자 요청: D:/DATA로 DB를 이전하고 법제처 API로 다른 법령도 수집한다. 추가 백업은 생략한다. 실제 API 인증값은 현재 데스크탑 `local-dev/.env`에 없으며 기존 프로젝트 환경 파일과 사용자/시스템 환경변수에도 설정되어 있지 않았다. 임의 인증값이나 공개 예시 인증값으로 우회하지 않았다.

## 새 수집 도구

`backend/tools/collect-selected-laws.mjs`는 민법·형법·상법·근로기준법·개인정보 보호법·도로교통법·건축법·소비자기본법의 현행 시행본을 순차 조회한다. `eflaw`, `nw=3`의 정확한 법령명을 요구하며 다중 후보·불완전 목록·잘못된 식별자는 거부한다. 본문의 법령 ID·시행일·제목·조문을 확인하고, 기존 원문 검증/저장 함수와 조문 파서/가져오기 함수를 재사용한다.

목록은 질의마다 최대 100건/1페이지로 제한하며 100건 초과는 중단한다. 각 요청 사이 1초 대기, 목록 조회 20초 제한/2MiB 제한을 둔다. 본문 요청은 기존 `readOfficialSample`의 15초 제한과 원문/인증값 반사 검사를 따른다. 공식 호출 할당량을 대신하는 설정이 아니다.

```powershell
# 저장소 루트 C:/dev/AURORE에서, 인증값 설정 후
node --env-file=local-dev/.env --use-system-ca backend/tools/collect-selected-laws.mjs D:/DATA/snapshots

# 검증한 본문을 현재 로컬 개발 DB에 함께 반영
node --env-file=local-dev/.env --use-system-ca backend/tools/collect-selected-laws.mjs D:/DATA/snapshots --apply
```

기본 실행은 원문 저장만 한다. `--apply`는 `127.0.0.1:5433/aurore_dev_check`만 허용하고 법령별 트랜잭션과 기존 가져오기 잠금을 사용한다. 원문 SHA-256 저장과 기존 DB 중복 방지 로직을 재사용한다. 중간 실패 시 앞서 커밋한 법령과 저장 원문은 보존하며 재실행해 계속할 수 있다. 소프트 삭제된 법령은 기존 가져오기 정책에 따라 거부한다. 전체 법령/연혁 수집기는 아니며 행정규칙·자치법규에는 사용하지 않는다.

## 실제 실행 결과

`--apply`로 실행을 시도했지만 `BLOCKED / MOLEG_OC_REQUIRED / collected=0 / imported=0`으로 종료했다. 인증값이 없을 때 외부 호출과 DB 변경을 하지 않는다. 정확한 목록 후보·날짜·식별자 검증 및 사전 점검 도구의 합성 응답 테스트 2건은 통과했다. 실제 API 연결/본문 수집/새 법령 DB 반영은 아직 검증하지 못했다.

다음 재개 시 `MOLEG_OC`와 호출 서버/IP·신청 서비스 조건 확인 → `collection-preflight.mjs --probe` → 이 도구 실행 → `/legals`에서 새 법령과 원문 조회 순으로 검증한다. 인증값을 Git이나 대화에 넣지 않는다.
