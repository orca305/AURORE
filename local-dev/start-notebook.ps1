param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $PSScriptRoot '.env.notebook'
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Create local-dev/.env.notebook from .env.notebook.example and enter desktop DB credentials locally. Open the SSH tunnel with connect-desktop.ps1 first.' }
$env:HOST='127.0.0.1'
$env:PORT='3001'
$env:BACKEND_URL='http://127.0.0.1:3001'
$env:AURORE_INTENT_CLASSIFY='0'
$env:AURORE_INTENT_ENABLE_ROUTING='0'
& $node "--env-file=$envPath" (Join-Path $PSScriptRoot 'check-notebook.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop connection check failed. No app, local database or local AI was started. Check the SSH tunnel and the desktop services.' }
foreach ($port in @(3000,3001)) {
 $client=[System.Net.Sockets.TcpClient]::new()
 try { $task=$client.ConnectAsync('127.0.0.1',$port);if($task.Wait(500) -and $client.Connected){throw "Port $port is already in use. Review and close that server before starting notebook mode."} } catch [System.AggregateException] { } finally { $client.Dispose() }
}
if (-not $SkipBuild) {
 $pnpm=(Get-Command pnpm -ErrorAction Stop).Source
 Push-Location (Join-Path $projectRoot 'backend')
 try { & $pnpm prisma:generate;if($LASTEXITCODE -ne 0){throw 'Prisma generation failed.'};& $pnpm build;if($LASTEXITCODE -ne 0){throw 'Backend build failed.'} } finally {Pop-Location}
 Push-Location (Join-Path $projectRoot 'frontend')
 try { & $pnpm build;if($LASTEXITCODE -ne 0){throw 'Frontend build failed.'} } finally {Pop-Location}
}
$backend=Join-Path $projectRoot 'backend/dist/main.js'
$next=Join-Path $projectRoot 'frontend/node_modules/next/dist/bin/next'
foreach($path in @($backend,$next,(Join-Path $projectRoot 'frontend/.next/BUILD_ID'))) {if(-not(Test-Path -LiteralPath $path)){throw 'Build files are missing. Run without -SkipBuild.'}}
$logRoot=Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
function Wait-NotebookHttp([string]$Url) {
 for($attempt=0;$attempt -lt 45;$attempt++) {try{if((Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200){return}}catch{};Start-Sleep -Milliseconds 500}
 throw "App did not become ready: $Url. Check local-dev/runtime logs. Review the started process before retrying."
}
$backendProcess=Start-Process -FilePath $node -ArgumentList @("--env-file=`"$envPath`"",'--use-system-ca',"`"$backend`"") -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/notebook-backend-$stamp.out.log" -RedirectStandardError "$logRoot/notebook-backend-$stamp.err.log" -PassThru
Write-Output "Notebook backend PID: $($backendProcess.Id)"
Wait-NotebookHttp 'http://127.0.0.1:3001/legals'
$frontendProcess=Start-Process -FilePath $node -ArgumentList @("--env-file=`"$envPath`"",'--use-system-ca',"`"$next`"",'start','--hostname','127.0.0.1','--port','3000') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/notebook-frontend-$stamp.out.log" -RedirectStandardError "$logRoot/notebook-frontend-$stamp.err.log" -PassThru
Write-Output "Notebook frontend PID: $($frontendProcess.Id)"
Wait-NotebookHttp 'http://127.0.0.1:3000/legals'
Write-Output 'Notebook ready: UI 3000, backend 3001; desktop DB tunnel 15433, desktop AI tunnel 18001. Keep the SSH tunnel open.'
