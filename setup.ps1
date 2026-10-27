<#
.SYNOPSIS
  themerchantengine install on Windows (plan E4.1): the local profile only.

.DESCRIPTION
  Checks git, Docker Desktop, Docker Compose v2 and the Node major in .nvmrc,
  builds the stepper bundle when it is missing or stale, and runs it with
  --profile local. A server install runs setup.sh on the box itself; this
  wrapper refuses any other profile so a Windows laptop cannot be told to
  issue certificates it cannot serve.

.EXAMPLE
  ./setup.ps1
  ./setup.ps1 -DryRun
  ./setup.ps1 -Answers ci/answers.json
#>

[CmdletBinding()]
param(
  [string]$Answers,
  [switch]$DryRun,
  [switch]$Reset,
  [string]$State
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location $Root

function Fail([string]$What, [string]$Fix) {
  Write-Host ''
  Write-Host "setup: $What" -ForegroundColor Red
  Write-Host "  $Fix"
  exit 1
}

function Test-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

# ── prerequisites ─────────────────────────────────────────────────────────
if (-not (Test-Path '.nvmrc')) { Fail 'This checkout has no .nvmrc, so the Node version it needs is unknown.' 'Run setup from a complete clone of the engine repository.' }
$WantMajor = ((Get-Content '.nvmrc' -Raw).Trim() -replace '^v', '') -split '\.' | Select-Object -First 1
if (-not (Test-Command git)) { Fail 'git is not installed.' 'Install Git for Windows (https://git-scm.com) and run ./setup.ps1 again.' }
if (-not (Test-Command docker)) { Fail 'Docker is not installed.' 'Install Docker Desktop (https://docs.docker.com/desktop/install/windows-install/) and run ./setup.ps1 again.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker is installed but not running.' 'Start Docker Desktop, wait for it to report running, and run ./setup.ps1 again.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose v2 is not available.' 'Update Docker Desktop; Compose v2 ships with it.' }
if (-not (Test-Command node)) { Fail 'Node.js is not installed.' "Install Node $WantMajor (https://nodejs.org) and run ./setup.ps1 again." }
# No quotes inside the expression handed to node: Windows PowerShell 5.1 strips
# them before the native process sees its argument, so the split happens here.
$HaveMajor = ((node -p 'process.versions.node').Trim() -split '\.')[0]
if ($HaveMajor -ne $WantMajor) { Fail "Node $HaveMajor is installed but the engine needs Node $WantMajor." "Install Node $WantMajor and run ./setup.ps1 again." }

# ── free ports for the local profile ──────────────────────────────────────
# A re-run finds this project's own containers on the ports; that is the
# expected state, so the check is skipped when one of them is running.
$OwnStack = (docker ps --format '{{.Names}}' 2>$null) | Where-Object { $_ -like 'themerchantengine-*' }
if ($OwnStack) {
  Write-Host "setup: this project's containers are running; the port check is skipped for a re-run"
} else {
  foreach ($port in 53000, 53200, 53300) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
      $owner = try { (Get-Process -Id $listener[0].OwningProcess -ErrorAction Stop).ProcessName } catch { 'unknown' }
      Fail "Port $port is in use by $owner (pid $($listener[0].OwningProcess))." "Stop it and run ./setup.ps1 again."
    }
  }
}

# ── the stepper bundle ────────────────────────────────────────────────────
$Bundle = Join-Path $Root 'tools/setup/dist/index.js'
$Stale = -not (Test-Path $Bundle)
if (-not $Stale) {
  $built = (Get-Item $Bundle).LastWriteTimeUtc
  $sources = @(Get-ChildItem -Recurse -File 'tools/setup/src', 'libs/shared/common/src') + @(Get-Item 'tools/setup/build.mjs')
  $Stale = ($sources | Where-Object { $_.LastWriteTimeUtc -gt $built } | Select-Object -First 1) -ne $null
}
if ($Stale) {
  Write-Host 'setup: building the stepper'
  if (-not (Test-Path 'node_modules/esbuild') -and -not (Test-Path 'tools/setup/node_modules/esbuild')) {
    # A fresh clone: the stepper's own small install from its own lockfile.
    Push-Location 'tools/setup'
    try { npm ci --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
    catch { Pop-Location; Fail "The stepper's dependencies did not install." 'Check the network, then run ./setup.ps1 again.' }
    Pop-Location
  }
  node tools/setup/build.mjs
  if ($LASTEXITCODE -ne 0) { Fail 'The stepper did not build.' 'Read the error above and run ./setup.ps1 again.' }
}

$argv = @('--profile', 'local')
if ($Answers) { $argv += @('--answers', $Answers) }
if ($DryRun) { $argv += '--dry-run' }
if ($Reset) { $argv += '--reset' }
if ($State) { $argv += @('--state', $State) }

& node $Bundle @argv
exit $LASTEXITCODE
