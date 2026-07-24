param([Parameter(Mandatory=$true)][string]$RepositoryUrl)
$ErrorActionPreference='Stop'
if (-not (Test-Path .git)) { git init }
git branch -M main
if (git remote get-url origin 2>$null) { git remote set-url origin $RepositoryUrl } else { git remote add origin $RepositoryUrl }
git add --all
if (-not (git diff --cached --quiet)) { git commit -m 'Dadway VPN Windows v2.0.1' }
git push -u origin main
