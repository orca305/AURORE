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
