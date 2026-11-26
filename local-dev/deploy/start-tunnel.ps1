# Cloudflare 터널을 켠다(외부 공개). 먼저 docs/OPERATIONS.md 의 외부 공개 준비를 끝내야 한다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File local-dev/deploy/start-tunnel.ps1
# 중지: 이 스크립트가 띄운 cloudflared 프로세스를 종료하면 바로 외부 접속이 끊긴다.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$config = Join-Path $PSScriptRoot 'cloudflared-config.yml'
if (-not (Test-Path -LiteralPath $config)) { throw "설정 파일이 없습니다: $config (cloudflared-config.example.yml 을 복사해 채워 주세요)" }
$local = Join-Path $PSScriptRoot 'bin/cloudflared.exe'
$cloudflared = if (Test-Path -LiteralPath $local) { $local } else { (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source }
if (-not $cloudflared) { throw 'cloudflared 가 없습니다(local-dev/deploy/bin/cloudflared.exe). docs/OPERATIONS.md 의 외부 공개 1단계를 먼저 하세요.' }

# 공개 전에 이 컴퓨터의 서비스가 정상이고, 접속 코드 보호가 켜져 있는지 확인한다.
function Test-Local([string]$Url) { try { (Invoke-WebRequest -Uri $Url -TimeoutSec 4 -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop).StatusCode } catch { $_.Exception.Response.StatusCode.value__ } }
if ((Test-Local 'http://127.0.0.1:3000/legals') -ne 200) { throw '화면(3000)이 응답하지 않습니다. 먼저 local-dev/start-desktop.cmd 로 서비스를 켜 주세요.' }
$envFile = Join-Path (Split-Path -Parent $root) 'frontend/.env.local'
if (-not (Select-String -Path $envFile -Pattern '^AURORE_ACCESS_CODE=\S+' -Quiet)) { throw 'frontend/.env.local 에 AURORE_ACCESS_CODE 가 없습니다. 접속 코드 없이는 외부에 열지 않습니다.' }
# 접속 코드 보호가 실제로 터널 요청을 막는지(cf 헤더를 흉내 내서) 확인한다.
$probe = try { (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/legals' -Headers @{ 'cf-connecting-ip' = '203.0.113.9' } -TimeoutSec 4 -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
if ($probe -ne 307) { throw "접속 코드 보호가 동작하지 않습니다(응답 $probe). 화면 서버를 다시 빌드·재시작한 뒤 시도하세요." }

Write-Host '접속 코드 보호 확인 완료. 터널을 시작합니다...'
& $cloudflared tunnel --config $config run
