# 데스크탑 저장소·수집 최종 상태 — 2026-11-18

후속 완료: [첫 법령 수집 결과](COLLECTION_RESULT_20261118.md)를 먼저 읽는다. 아래 인증 미설정·법령 0건은 인증값 제공 전의 기록이며, 현재는 8개 법령이 적재됐다. D 저장 위치는 유지한다.

이 문서가 같은 날짜의 이전 인계 문서에 있는 F 이전 보류·C 운영 상태보다 최신이다.

## D 드라이브 DB 이전 완료

- 사용자 최종 선택: F 대신 D 드라이브 사용.
- 실제 운영 디스크: `D:/DATA/DockerDesktopWSL/disk/docker_data.vhdx`.
- Docker 설정 `CustomWslDistroDir`: `D:\DATA\DockerDesktopWSL`.
- 원래 C 디스크를 DB/Docker/WSL 정상 종료 후 D에 복사하고 전체 SHA-256 일치를 확인했다. 별도 백업 파일은 추가 생성하지 않았다. 원래 C 파일은 분리된 상태로 보존했으며 운영에 사용하지 않는다.
- Docker 재시작 후 D 디스크의 독점 열기가 거부되고 C 원본의 독점 열기는 가능해, D 연결/C 분리 상태를 확인했다.
- 컨테이너 `aurore-desktop-postgres`, 볼륨 `aurore-desktop-e4b-pgdata` 유지. 다른 기존 DB/볼륨도 삭제하지 않았다.
- 접속은 기존 `127.0.0.1:5433`, DB/사용자 `aurore_dev_check` 그대로다. 회사 노트북 SSH 터널 포트도 바꿀 필요 없다.
- PostgreSQL `pg_isready` 정상, 컨테이너 healthy, SQL 조회에서 마이그레이션 31개/법령 0개/판례 0개 확인. 백엔드 `/legals` HTTP 200 확인.
- 향후 수집 원문 경로: `D:/DATA/snapshots`. 로컬 환경 파일도 이 경로를 따르도록 정리한다. 백엔드를 환경 파일을 읽어 재시작했으며 새 원문 경로를 적용했다. 백엔드·프런트 법령 화면 HTTP 200과 AI 상태 정상 응답을 확인했다.
- 확인 시 D 볼륨 논리 여유 공간은 약 1.31TB다. 과거 확인한 Storage Spaces 실제 물리 여유 공간과 논리 여유 공간은 다르므로 대량 수집 전 실제 풀 여유 공간을 다시 확인한다. D가 단일 물리 디스크인 구성에서 같은 D 안의 파일만을 별도 장애 대비 백업으로 보지 않는다.

## F 드라이브는 운영에서 제외

F로의 복사 시 쓰기·읽기가 매우 느렸고, Windows 시스템 로그에서 disk 이벤트 153(I/O 재시도)와 UASPStor 이벤트 129(장치 재설정)이 반복됐다. WMI 대응 관계로 F는 `Disk #4, Partition #0`이며 오류 디스크 4와 일치함을 확인했다. 케이블·USB 포트·전원·장치 자체 중 원인은 아직 확정하지 않았다.

F의 복사본 `F:/DATA/DockerDesktopWSL/disk/docker_data.vhdx`는 남아 있지만 DB 운영 경로가 아니다. F 복사본의 전체 해시 검사는 느린 읽기로 중단했으며 무결성 검증 완료라고 간주하지 않는다. F를 포맷하거나 다른 파일을 지우지 않았다. WSL에 원본/복사본이 같은 디스크 식별자로 중복 연결된 문제는 Docker 종료와 WSL 전체 종료로 해제한 뒤 D 원본 하나만 연결해 해결했다.

F의 연결/장치 문제를 점검하기 전에는 운영 DB나 유일한 백업 저장소로 사용하지 않는다.

## 법제처 수집은 인증 미설정으로 중단

[추가 법령 수집 도구](SELECTED_LAW_COLLECTION.md)를 준비했다. 민법·형법·상법·근로기준법·개인정보 보호법·도로교통법·건축법·소비자기본법의 정확한 현행본 조회와 원문 저장, 명시적 로컬 DB 반영을 지원한다. 기존 검증·저장·조문 가져오기 함수를 재사용한다.

현재와 이전 프로젝트의 실제 환경 파일, 프로세스/사용자/시스템 환경변수에서 설정된 `MOLEG_OC`를 찾지 못했다. 데스크탑 실행은 `BLOCKED / MOLEG_OC_REQUIRED / collected=0 / imported=0`이다. 실제 API를 통해 새 법령을 내려받거나 DB에 반영하지 않았다. 인증값 없이 임의 계정이나 공개 예시 인증값을 쓰지 않는다.

검증: 새 목록 후보·날짜·ID 검사와 기존 목록 사전 점검의 합성 테스트 2건 통과. 실제 API 목록/본문 접근은 인증 설정 후 검증해야 한다.

## 다음 재개

1. 회사 노트북의 기존 API 계정과 인증값, 신청 서비스·호출 IP 조건을 확인하고 데스크탑 `local-dev/.env`에 안전하게 설정한다. Git이나 대화에 인증값을 넣지 않는다.
2. 저장소 루트에서 실행한다.

```powershell
node --env-file=local-dev/.env --use-system-ca backend/tools/collection-preflight.mjs --probe
node --env-file=local-dev/.env --use-system-ca backend/tools/collect-selected-laws.mjs D:/DATA/snapshots --apply
```

3. 법령별 저장/중복 결과와 `/legals`의 원문 조회를 확인한다. 인증값을 나중에 바꾸면 백엔드를 환경 파일을 읽어 다시 시작한다.
4. 회사 노트북 SSH 외부 접속은 공유기 포트포워딩·공인 IP/DDNS 설정 후 별도 시험한다. 저장 위치 이전이 공유기 설정을 대신하지 않는다.

전체 법령·행정규칙·자치법규·판례 및 연혁의 대량 수집은 [전체 수집 준비](FULL_COLLECTION_PREPARATION.md)의 후속 범위이며 아직 완료하지 않았다.
