param(
  [Parameter(Mandatory=$true)][string]$HomeAddress,
  [ValidateRange(1,65535)][int]$Port = 40222,
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\id_ed25519"
)
$ErrorActionPreference = 'Stop'
if ($HomeAddress -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*$') { throw 'Enter only a public IP address or DNS hostname.' }
if (-not (Test-Path -LiteralPath $IdentityFile)) { throw "SSH private key missing: $IdentityFile" }
& ssh.exe -N -T -p $Port -i $IdentityFile -o HostKeyAlgorithms=ssh-ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=ask -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L '127.0.0.1:15433:127.0.0.1:5433' -L '127.0.0.1:18001:127.0.0.1:8001' "aurore_tunnel@$HomeAddress"
exit $LASTEXITCODE
