# 로컬 AI 모델 프로필 (start-desktop.ps1 과 switch-model.ps1 이 함께 쓴다).
#   fast    : aurore-local:e4b  - 빠름(100문항 평균 약 5.7초), 기본값
#   quality : aurore-local:12b  - 해설 품질이 높음(해설 검증 통과 약 1.5배), 약 3초 느림
# 프로필은 local-dev/model-profile.txt 한 단어로 정한다. 새 프로필은 아래 표에 한 줄 더하면 된다.
$AuroreModelProfiles = @{ fast = 'aurore-local:e4b'; quality = 'aurore-local:12b' }
function Get-AuroreProfile {
  $file = Join-Path $PSScriptRoot 'model-profile.txt'
  $name = if (Test-Path $file) { (Get-Content $file -Raw).Trim().ToLowerInvariant() } else { 'fast' }
  if (-not $AuroreModelProfiles.ContainsKey($name)) { throw "Unknown model profile '$name'. Use: $($AuroreModelProfiles.Keys -join ', ')" }
  return $name
}
function Get-AuroreModel { return $AuroreModelProfiles[(Get-AuroreProfile)] }

# 답변·해설 모델: local-dev/.env 에 ANTHROPIC_API_KEY 가 있으면 Claude Haiku(claude-haiku-5-5)로 고정한다(2026-11-21 결정).
# 예산 소진·인증 오류·과부하·네트워크 문제가 있으면 AI 서버가 같은 요청을 로컬 모델(model-profile.txt 의 모델)로 자동으로 대신 처리한다.
# 키가 없으면 전부 로컬 모델로 동작한다. 이 함수는 현재 프로세스(와 그 자식인 AI 서버)에만 환경변수를 넣고, 키를 출력하거나 파일에 쓰지 않는다.
# 외부 모델을 쓰지 않으려면 .env 에서 키를 지우거나 AURORE_EXPLAIN_PROVIDER=local 을 설정한다.
function Set-AuroreExternalEnv {
  $envFile = Join-Path $PSScriptRoot '.env'
  if ($env:AURORE_EXPLAIN_PROVIDER -eq 'local' -or -not (Test-Path $envFile)) { return 'local' }
  $line = Get-Content $envFile | Where-Object { $_ -match '^ANTHROPIC_API_KEY=.' } | Select-Object -First 1
  if (-not $line) { return 'local' }
  $env:ANTHROPIC_API_KEY = ($line -replace '^ANTHROPIC_API_KEY=', '').Trim().Trim('"').Trim("'")
  $env:AURORE_EXPLAIN_PROVIDER = 'anthropic'
  if (-not $env:AURORE_EXPLAIN_MODEL) { $env:AURORE_EXPLAIN_MODEL = 'claude-haiku-5-5' }
  return 'haiku'
}
