$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$targetDir = Join-Path $env:APPDATA 'npm'

$bunCandidates = @()
$bunCommand = Get-Command bun -ErrorAction SilentlyContinue
if ($bunCommand) {
  $bunCandidates += $bunCommand.Source
}
$bunCandidates += Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64\bun.exe'
$bunPath = $bunCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $bunPath) {
  throw 'Bun executable not found. Install Bun first, then rerun this script.'
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$legacyLauncherNames = @(
  'claude-code-v999',
  'ccb999'
)

$legacyLauncherNames | ForEach-Object {
  Remove-Item -LiteralPath (Join-Path $targetDir "$_.cmd") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $targetDir "$_.ps1") -Force -ErrorAction SilentlyContinue
}

$launcherNames = @(
  'claude-code-codex',
  'claude-code-v666',
  'ccb666'
)

foreach ($name in $launcherNames) {
  $cmdPath = Join-Path $targetDir "$name.cmd"
  $ps1Path = Join-Path $targetDir "$name.ps1"

  $cmdContent = @"
@echo off
setlocal
set "BUN_PATH=$bunPath"
set "REPO_ROOT=$repoRoot"
if exist "%BUN_PATH%" (
  "%BUN_PATH%" "%REPO_ROOT%\dist\cli.js" %*
) else (
  bun "%REPO_ROOT%\dist\cli.js" %*
)
"@

  Set-Content -LiteralPath $cmdPath -Value $cmdContent -Encoding ASCII
  Remove-Item -LiteralPath $ps1Path -Force -ErrorAction SilentlyContinue
}

Write-Host "Installed launchers to ${targetDir}:"
foreach ($name in $launcherNames) {
  Write-Host "  $name"
}
