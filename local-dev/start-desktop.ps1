$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Test-LocalHttp([string]$Url) {
  try { return (Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 } catch { return $false }
}
function Wait-LocalHttp([string]$Url, [int]$Seconds = 45) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalHttp $Url) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Service did not become ready: $Url. Check local-dev/runtime logs."
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$python = Join-Path $projectRoot 'ai-server/.venv/Scripts/python.exe'
$backend = Join-Path $projectRoot 'backend/dist/main.js'
$next = Join-Path $projectRoot 'frontend/node_modules/next/dist/bin/next'
$envPath = Join-Path $PSScriptRoot '.env'
foreach ($required in @($python, $backend, $next, $envPath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required project file is missing: $required" }
}

& docker desktop start --timeout 60
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop could not start.' }
& docker compose --env-file $envPath -f (Join-Path $PSScriptRoot 'compose.yml') -f (Join-Path $PSScriptRoot 'compose.desktop.yml') up -d postgres
if ($LASTEXITCODE -ne 0) { throw 'AURORE database could not start. If Windows reserves port 5433, run local-dev/repair-db-port.ps1 as administrator and retry. Existing database files are preserved.' }
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  & docker exec aurore-desktop-postgres pg_isready -q -U aurore_dev_check -d aurore_dev_check
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}
if ($LASTEXITCODE -ne 0) { throw 'AURORE database is not ready.' }

$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:AURORE_AI_MOCK = '0'
$env:AURORE_OLLAMA_MODEL = 'aurore-local:e4b'
$env:AURORE_INTENT_CLASSIFY = '0'
$env:AURORE_INTENT_ENABLE_ROUTING = '0'
$env:AURORE_AI_URL = 'http://127.0.0.1:8001'
if (-not (Test-LocalHttp 'http://127.0.0.1:11434/api/version')) {
  Start-Process -FilePath (Get-Command ollama.exe -ErrorAction Stop).Source -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput "$logRoot/ollama.out.log" -RedirectStandardError "$logRoot/ollama.err.log"
}
Wait-LocalHttp 'http://127.0.0.1:11434/api/version'
if (-not (Test-LocalHttp 'http://127.0.0.1:8001/health')) {
  Start-Process -FilePath $python -ArgumentList '-m uvicorn main:app --host 127.0.0.1 --port 8001' -WorkingDirectory (Join-Path $projectRoot 'ai-server') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/ai.out.log" -RedirectStandardError "$logRoot/ai.err.log"
}
Wait-LocalHttp 'http://127.0.0.1:8001/health'
if (-not (Test-LocalHttp 'http://127.0.0.1:3001/legals')) {
  Start-Process -FilePath $node -ArgumentList @("--env-file=`"$envPath`"", '--use-system-ca', "`"$backend`"") -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/backend.out.log" -RedirectStandardError "$logRoot/backend.err.log"
}
Wait-LocalHttp 'http://127.0.0.1:3001/legals'
if (-not (Test-LocalHttp 'http://127.0.0.1:3000/legals')) {
  Start-Process -FilePath $node -ArgumentList @("`"$next`"", 'start', '--hostname', '127.0.0.1', '--port', '3000') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/frontend.out.log" -RedirectStandardError "$logRoot/frontend.err.log"
}
Wait-LocalHttp 'http://127.0.0.1:3000/legals'
Write-Output 'AURORE ready: UI 3000, backend 3001, AI 8001, DB 5433 (loopback only).'
