# 사용: powershell -File local-dev/switch-model.ps1 fast|quality
# 프로필을 바꾸고, 떠 있는 AI 서버(8001)를 새 모델로 다시 시작한다. 백엔드·프런트는 그대로 둔다.
param([Parameter(Mandatory)][string]$Profile)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'model-profiles.ps1')
$Profile = $Profile.Trim().ToLowerInvariant()
if (-not $AuroreModelProfiles.ContainsKey($Profile)) { throw "Unknown profile. Use: $($AuroreModelProfiles.Keys -join ', ')" }
$model = $AuroreModelProfiles[$Profile]
if (-not ((& ollama list) -match [regex]::Escape($model))) { throw "Model $model is not installed. See local-dev/models/ for how to create it." }
Set-Content -Path (Join-Path $PSScriptRoot 'model-profile.txt') -Value $Profile -NoNewline
$root = Split-Path $PSScriptRoot -Parent
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn main:app' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2
$env:OLLAMA_HOST = '127.0.0.1:11434'; $env:AURORE_AI_MOCK = '0'; $env:AURORE_OLLAMA_MODEL = $model; $env:AURORE_INTENT_ENABLE_ROUTING = '0'
$logRoot = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Force $logRoot | Out-Null
Start-Process -FilePath (Join-Path $root 'ai-server/.venv/Scripts/python.exe') -ArgumentList '-m uvicorn main:app --host 127.0.0.1 --port 8001' -WorkingDirectory (Join-Path $root 'ai-server') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/ai.out.log" -RedirectStandardError "$logRoot/ai.err.log"
Start-Sleep -Seconds 6
Write-Output "AURORE AI model: $Profile ($model)"
