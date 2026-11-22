# 서비스 감시·자동 재시작: 30초마다 화면(3000)·백엔드(3001)·AI 서버(8001)·Ollama(11434)를 확인하고, 죽은 것이 있으면 start-desktop.ps1 로 다시 켠다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File local-dev/supervise-desktop.ps1 [-Collectors]
#   -Collectors : 판례·법령용어 수집 드라이버(D:/DATA 아래 기록 폴더)도 죽어 있으면 다시 시작한다(끝난 폴더는 건너뛰고 이어 받는다).
# 로그: local-dev/runtime/supervisor.log (건강 확인 결과와 재시작 사실만, 질문·키 같은 내용은 기록하지 않는다).
# 재시작이 3번 연속 실패하면 10분 쉬었다가 다시 시도한다. 중지: 이 스크립트의 PowerShell 프로세스를 종료한다.
param([switch]$Collectors)
$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$log = Join-Path $runtime 'supervisor.log'
function Write-Log([string]$message) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message) -Encoding utf8 }
function Test-Http([string]$url) { try { (Invoke-WebRequest -Uri $url -TimeoutSec 4 -UseBasicParsing).StatusCode -eq 200 } catch { $false } }
$checks = [ordered]@{ '화면(3000)' = 'http://127.0.0.1:3000/legals'; '백엔드(3001)' = 'http://127.0.0.1:3001/legals'; 'AI 서버(8001)' = 'http://127.0.0.1:8001/health'; 'Ollama(11434)' = 'http://127.0.0.1:11434/api/version' }
$failures = 0
. (Join-Path $PSScriptRoot 'model-profiles.ps1')
# 모델 상시 대기(keep-warm): 로컬 질문 분석 모델(12B)과 의미 검색 모델(bge-m3)을 항상 메모리에 올려 둔다.
# 쉬었다가 처음 오는 질문이 모델을 다시 불러오느라 수십 초 늦어지는 것을 막는다. 질문·답변 내용은 보내지 않는다(빈 요청).
function Invoke-KeepWarm {
  try {
    $local = Get-AuroreModel
    if ($local) {
      $body = @{ model = $local; keep_alive = '60m' } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120 | Out-Null
    }
    $body = @{ model = 'bge-m3'; input = '대기'; keep_alive = '60m' } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/embed' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120 | Out-Null
  } catch { Write-Log ('모델 대기 요청 실패: ' + $_.Exception.Message) }
}
$lastWarm = [datetime]::MinValue
Write-Log "감시 시작 (collectors=$($Collectors.IsPresent))"
while ($true) {
  $down = @($checks.Keys | Where-Object { -not (Test-Http $checks[$_]) })
  if ($down.Count -gt 0) {
    Write-Log ("다운 감지: " + ($down -join ', '))
    # 한 번 더 확인해 일시적인 응답 지연으로 재시작하지 않는다.
    Start-Sleep -Seconds 10
    $down = @($checks.Keys | Where-Object { -not (Test-Http $checks[$_]) })
  }
  if ($down.Count -gt 0) {
    $startLog = Join-Path $runtime 'supervisor-start.log'
    # 출력을 파이프로 받지 않고 파일로 보낸다(자식 프로세스가 파이프를 붙잡아 멈추는 것을 막는다).
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'start-desktop.ps1') -WindowStyle Hidden -PassThru -RedirectStandardOutput $startLog -RedirectStandardError "$startLog.err"
    if (-not $process.WaitForExit(240000)) { try { $process.Kill() } catch { } }
    $still = @($checks.Keys | Where-Object { -not (Test-Http $checks[$_]) })
    if ($still.Count -eq 0) { Write-Log '재시작 성공'; $failures = 0 } else { $failures++; Write-Log ("재시작 실패(" + $failures + "회): " + ($still -join ', ')) }
    if ($failures -ge 3) { Write-Log '연속 실패 3회: 10분 쉽니다'; Start-Sleep -Seconds 600; $failures = 0 }
  } else { $failures = 0 }
  if (((Get-Date) - $lastWarm).TotalMinutes -ge 10 -and (Test-Http $checks['Ollama(11434)'])) { Invoke-KeepWarm; $lastWarm = Get-Date }
  if ($Collectors) {
    $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { $_.CommandLine }
    $node = (Get-Command node.exe).Source
    foreach ($job in @(
      @{ name = '판례 수집'; match = 'collect-supreme-precedents'; args = @('--env-file=local-dev/.env', '--use-system-ca', 'backend/tools/collect-supreme-precedents.mjs', 'D:/DATA/precedent-supreme', '--from', '2010'); out = 'D:\DATA\precedent-supreme\supervised' },
      @{ name = '용어 수집'; match = 'collect-all-terms'; args = @('--env-file=local-dev/.env', '--use-system-ca', 'backend/tools/collect-all-terms.mjs', 'D:/DATA/terms-collection'); out = 'D:\DATA\terms-collection\supervised' })) {
      if (($running | Where-Object { $_ -match $job.match }).Count -eq 0) {
        # 끝난 수집을 계속 다시 켜지 않도록, 마지막 로그에 완료 표시가 있으면 건너뛴다.
        $done = (Test-Path "$($job.out).log") -and ((Get-Content "$($job.out).log" -Tail 3 -ErrorAction SilentlyContinue) -match 'complete')
        if (-not $done) {
          Start-Process -FilePath $node -ArgumentList $job.args -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput "$($job.out).log" -RedirectStandardError "$($job.out).err.log"
          Write-Log ($job.name + ' 다시 시작')
        }
      }
    }
  }
  Start-Sleep -Seconds 30
}
