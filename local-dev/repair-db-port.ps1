#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$resultPath = Join-Path $PSScriptRoot 'runtime/port-repair.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $resultPath) -Force | Out-Null
$wasRunning = (Get-Service winnat).Status -eq 'Running'
$result = @{ success = $false; port = 5433 }
try {
  # WinNAT may reserve the project's port after boot. Release it briefly so Docker can bind.
  if ($wasRunning) { Stop-Service winnat }
  & docker start aurore-desktop-postgres | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Database port is still unavailable.' }
  $result.success = $true
} catch {
  $result.error = $_.Exception.Message
} finally {
  try {
    if ($wasRunning) { Start-Service winnat }
  } catch {
    $result.success = $false
    $result.error = 'Could not restore the Windows NAT service.'
  }
  $result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
if (-not $result.success) { exit 1 }
