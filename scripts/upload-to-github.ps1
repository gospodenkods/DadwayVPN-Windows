param([Parameter(Mandatory=$true)][string]$RepositoryUrl)
$ErrorActionPreference='Stop'
if(-not (Test-Path .git)){ git init }
git add --all
$changes = git diff --cached --name-only
if($changes){ git commit -m 'Dadway VPN for Windows 1.0.0' }
git branch -M main
$remotes = git remote
if($remotes -contains 'origin'){ git remote set-url origin $RepositoryUrl } else { git remote add origin $RepositoryUrl }
git push -u origin main
