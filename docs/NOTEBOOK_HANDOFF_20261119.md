# 회사 노트북 인수인계 — 2026-11-19

이 문서를 먼저 읽고 현재 환경을 확인한 뒤 작업을 이어간다. 사용자는 VPN 없이 노트북에서 집 데스크탑의 DB와 로컬 AI를 사용하려 한다. 노트북에 DB·모델을 새로 만들거나 데스크탑 데이터를 초기화하지 않는다.

## 데스크탑에서 완료한 내용

- 저장소 C:/dev/AURORE, 원격 https://github.com/orca305/AURORE.git, main. 이전 개발 커밋 `496ddfb`에 전체 현행 법령 목록·제한 배치 수집 구현이 있다.
- ipTIME 공유기에 데스크탑 MAC 기준 192.168.0.3 DHCP 예약과 `AURORE-SSH` TCP 외부 40222 → 192.168.0.3:2222 규칙을 추가하고 상단 설정저장 확인을 승인했다. 등록된 규칙을 화면에서 재조회했다. DDNS 이름은 사용자가 등록한 값을 사용한다. 로컬 인수인계 TXT에는 실제 이름을 기록했다.
- DDNS A 레코드가 공유기에 표시된 WAN 주소와 일치하는 것을 확인했다. 회사 네트워크에서 실제 외부 접속은 아직 시험하지 않았다. 공유기를 재부팅하는 시험은 하지 않았다.
- Windows sshd 실행 중·자동 시작, TCP 2222 수신. 기존 방화벽 AURORE-SSH-Tunnel-TCP 규칙이 활성·인바운드 허용이며 포트가 2222인 것을 확인했다.
- SSH 사용자 aurore_tunnel, 공개키 인증만 허용. 일반 원격 셸은 차단하고 DB·AI 목적지 전달만 허용한다. 수집 명령을 SSH 셸로 실행할 수 있는 계정이 아니다.
- DB 127.0.0.1:5433 정상, ai-server 127.0.0.1:8001 재실행 후 health 정상. 실제 /intent/analyze 호출이 LEGAL, available=true, model=aurore-local:e4b를 반환했다. Gemma 4 E4B 사용, 의도 자동 분기는 계속 비활성이다.
- 전원 연결 시 자동 절전과 최대 절전 시간은 이미 0(사용 안 함)이었다. 전원 설정을 새로 바꾸지 않았다. 데스크탑 전원은 켜 둔다.
- Windows PowerShell 기본 실행 정책에서 start-desktop.ps1 실행이 차단됐다. 정책 우회나 완화는 하지 않았다. 기존 Python 실행 파일로 AI 서버를 숨김 실행했다. 서비스별 재부팅 자동 복구가 모두 설정됐다는 뜻은 아니다.
- DB 디스크 D:/DATA/DockerDesktopWSL, 원문 D:/DATA/snapshots. F는 사용하지 않는다. 법령 85개·시행본 85개·활성 조문/부칙 10,169개. 현행 목록 5,631개 중 본문 약 1.51%다.

## 노트북에서 첫 작업

1. 노트북의 기존 AURORE 저장소 위치·로컬 변경을 확인한다. 로컬 변경을 버리거나 덮어쓰지 않고 `git pull --ff-only`로 최신 main을 받는다.
2. 등록한 DDNS 이름으로 `Resolve-DnsName <DDNS이름> -Type A`, `Test-NetConnection <DDNS이름> -Port 40222`를 실행한다. 회사망에서 막히면 휴대폰 테더링으로 비교해 집 설정 문제와 구분한다.
3. `Get-ChildItem "$HOME\.ssh" -Name`으로 기존 노트북 키 파일을 확인한다. 기본 파일 이름은 id_ed25519(개인키), id_ed25519.pub(공개키)다. 존재하는 키를 먼저 사용하고 임의로 재생성하지 않는다. 개인키·비밀번호를 채팅/Git에 붙이지 않는다.
4. `ssh-keygen -lf "$HOME\.ssh\id_ed25519.pub"`로 공개키 지문을 확인한다. 이번 데스크탑 세션은 등록 키 파일 ACL 때문에 그 지문을 재확인하지 못했다. `Permission denied (publickey)`가 발생하면 데스크탑의 등록 공개키와 노트북 공개키를 적절한 권한으로 비교한다. 호스트 이름이나 법제처 API 키를 SSH 개인키로 사용하지 않는다.
5. 아래 연결 명령을 실행하고 터널을 사용하는 동안 창을 열어 둔다.

```powershell
.\local-dev\connect-desktop.ps1 -HomeAddress "<등록한 DDNS 이름>"
```

개인키 이름이 다르면 `-IdentityFile "$HOME\.ssh\실제개인키파일"`을 지정한다. 스크립트 실행 정책 때문에 차단되면 정책을 우회하지 말고 다음 ssh 명령을 직접 실행할 수 있다. 주소는 실제 DDNS로 바꾼다.

```powershell
ssh -N -T -p 40222 -i "$HOME\.ssh\id_ed25519" -o HostKeyAlgorithms=ssh-ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=ask -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:15433:127.0.0.1:5433 -L 127.0.0.1:18001:127.0.0.1:8001 aurore_tunnel@<등록한-DDNS-이름>
```

최초 연결의 ED25519 서버 지문은 아래 값과 비교한다. 이는 서버 확인용 지문이며 노트북 개인키의 지문과 다르다.

```text
SHA256:kThdpzy6iWXnC8nGaAgyuw5WFqu1uVT0VA9mhC0JHkQ
```

6. 다른 터미널에서 `Invoke-RestMethod http://127.0.0.1:18001/health`와 실제 DB 접속을 확인한다. TCP 포트 연결 성공만으로 DB 로그인 성공으로 기록하지 않는다.
7. 노트북의 비공개 환경 파일에서 DATABASE_URL의 호스트/포트를 127.0.0.1:15433, DB 이름을 aurore_dev_check로 맞춘다. 계정·암호는 기존 비공개 값을 사용한다. AURORE_AI_URL은 http://127.0.0.1:18001로 지정한다. API 키는 별도이며 이번 터널 연결 자체에는 필요하지 않다.
8. 노트북에서 앱을 실행해 법령 목록과 근거 인용 흐름을 확인한다. 모델·PostgreSQL 설치 없이 데스크탑 서비스를 사용할 수 있지만 노트북 앱 실행용 개발 환경은 필요하다. 현재 집의 웹 3000/3001 포트를 이 터널로 전달한 구성은 아니다.

## 이어서 개발할 범위

- 외부 접속·DB 로그인·AI 응답을 실제 회사 노트북에서 확인하고 결과 기록.
- 인증된 관리자 수집 시작/중지/진행률 기능은 미구현. 현재 터널로 데스크탑 수집 명령 실행을 가정하지 않는다.
- 현행 본문 수집은 데스크탑에서 기존 catalogue와 receipts를 사용해 제한 배치로 이어갈 수 있다. [수집 기록](CURRENT_COLLECTION_20261119.md)을 따른다. 노트북에서 로컬 DB용 수집 명령을 그대로 실행하지 않는다.
- 면접 시연 우선순위는 근거 기반 쉬운 해설, 3~5개 대표 시나리오 화면 통합, 안정적인 시작/실패 안내, 구조도·평가·한계 설명이다. 전체 법령 수집 완료를 면접 시연의 선행 조건으로 잡지 않는다.
- 전체 개발 50~55%, 면접 시연 준비 75~80%는 잠정 범위 추정이며 시험 통과율·법률 정확도가 아니다. 실제 근거 인용 합성 시험은 자료 확충 후 13/13이었다. 자유서술 법률 해설과 폭넓은 품질 검증은 남아 있다.

인증정보와 집 DDNS/WAN IP·MAC 등 장치별 세부 값은 이 Git 문서에 추가하지 않는다. 기존 원문·DB·개인키·비공개 .env를 Git에 넣지 않는다.
