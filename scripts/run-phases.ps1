<#
.SYNOPSIS
The headless phase loop for a PowerShell terminal. Same contract as
scripts/run-phases.sh.

.DESCRIPTION
Runs every open phase of a feature in its own `claude -p "/phase <id>"`
session, one after the other, and stops on the first phase that reports
BLOCKED, exits non-zero, ends with a non-success result, leaves its tasks
open, or pushes the spent total past the cap.

Run it from a plain terminal, not from inside a Claude Code session.

.PARAMETER Feature
The feature under specs/features/<slug>/. Default: the active feature (last
/phase or /feature prompt, else the newest tracked tasks.md with an open task).

.PARAMETER DryRun
List the open phases and the command for each, run nothing.

.PARAMETER Budget
Per-phase cap passed as --max-budget-usd, default 20.

.PARAMETER MaxTurns
Per-phase cap passed as --max-turns, default 250.

.PARAMETER Total
Stop once the spent total leaves no room for one more phase, or a result
carries no cost. Default 0, no cap.

.PARAMETER Model
Passed through as --model to every phase session.

.NOTES
Env: RUN_PHASES_LOG_DIR, where each result JSON lands, default
dist/.claude/run-phases. CLAUDE_PROJECT_DIR and ACTIVE_PHASE_STATE_DIR are
honoured the way the hooks honour them.
#>
[CmdletBinding()]
param(
  [string]$Feature = '',
  [switch]$DryRun,
  [double]$Budget = 20,
  [int]$MaxTurns = 250,
  [double]$Total = 0,
  [string]$Model = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$stateDir = if ($env:ACTIVE_PHASE_STATE_DIR) { $env:ACTIVE_PHASE_STATE_DIR } else { Join-Path $repoRoot 'dist/.claude' }
$logDir = if ($env:RUN_PHASES_LOG_DIR) { $env:RUN_PHASES_LOG_DIR } else { Join-Path $repoRoot 'dist/.claude/run-phases' }

# Phase ids in file order, each with an open task in its section.
function Get-OpenPhases([string]$path) {
  $open = @()
  $id = ''
  $hasOpen = $false
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^## ') {
      if ($id -and $hasOpen) { $open += $id }
      $id = ''
      $hasOpen = $false
      if ($line -match '^## Phase (\S+)') { $id = $Matches[1].TrimEnd(':') }
      continue
    }
    if ($id -and $line.StartsWith('- [ ] ')) { $hasOpen = $true }
  }
  if ($id -and $hasOpen) { $open += $id }
  return $open
}

function Get-FeatureOf([string]$tasksFile) {
  return Split-Path -Leaf (Split-Path -Parent $tasksFile)
}

# A feature slug: lower-case letters, digits and dashes, no leading dash.
function Test-Slug([string]$value) {
  return $value -cmatch '^[a-z0-9][a-z0-9-]*$'
}

# True when the repo-relative file is tracked and present in the worktree.
function Test-Tracked([string]$file) {
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $file))) { return $false }
  Push-Location $repoRoot
  try {
    & git ls-files --error-unmatch -- $file 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
}

# The active feature: the recorded phase or feature first, then the newest
# tracked tasks.md with an open task. Returns the repo-relative tasks path.
function Resolve-ActiveTasksFile {
  $stateFile = Join-Path $stateDir 'active-phase'
  if (Test-Path -LiteralPath $stateFile) {
    $state = (Get-Content -LiteralPath $stateFile -Raw).Trim()
    if ($state -match '^feature=(\S+)$') {
      # The state file is data on disk: only a slug becomes a path, and only
      # a tracked tasks file is read.
      $slug = $Matches[1]
      $file = "specs/features/$slug/tasks.md"
      if ((Test-Slug $slug) -and (Test-Tracked $file) -and (Get-OpenPhases (Join-Path $repoRoot $file)).Count -gt 0) { return $file }
    } elseif ($state -match '^phase=(\S+)$') {
      $wanted = $Matches[1].ToLowerInvariant()
      foreach ($file in Get-TrackedTasksFiles) {
        $ids = Get-OpenPhases (Join-Path $repoRoot $file) | ForEach-Object { $_.ToLowerInvariant() }
        if ($ids -contains $wanted) { return $file }
      }
    }
  }
  foreach ($file in Get-TrackedTasksFiles) {
    if ((Get-OpenPhases (Join-Path $repoRoot $file)).Count -gt 0) { return $file }
  }
  return $null
}

function Get-TrackedTasksFiles {
  Push-Location $repoRoot
  try {
    $files = & git ls-files -- 'specs/*/tasks.md' 2>$null
    if (-not $files) { return @() }
    return @($files | ForEach-Object { Get-Item -LiteralPath (Join-Path $repoRoot $_) } |
      Sort-Object LastWriteTimeUtc -Descending |
      ForEach-Object { [System.IO.Path]::GetRelativePath($repoRoot, $_.FullName) -replace '\\', '/' })
  } finally {
    Pop-Location
  }
}

function Read-ResultField([string]$path, [string]$key) {
  try {
    $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
  if ($null -eq $json) { return $null }
  return $json.$key
}

# A usage error goes to stderr without tripping $ErrorActionPreference, so the
# exit code that follows is the one the caller sees (Write-Error would exit 1).
function Write-Usage([string]$message) {
  [Console]::Error.WriteLine($message)
}

function Stop-Loop([string]$id, [string]$why) {
  Write-Output "run-phases: stopped at ${id}: $why"
  exit 1
}

# 1. Which feature.
if ($Feature) {
  # The slug becomes a path, so it is validated before it is joined, and the
  # tasks file must be tracked so a scratch copy never drives a paid loop.
  if (-not (Test-Slug $Feature)) {
    Write-Usage "run-phases: invalid feature slug '$Feature'"
    exit 2
  }
  $tasksFile = "specs/features/$Feature/tasks.md"
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $tasksFile))) {
    Write-Usage "run-phases: no tasks file at $tasksFile"
    exit 2
  }
  if (-not (Test-Tracked $tasksFile)) {
    Write-Usage "run-phases: $tasksFile is not tracked"
    exit 2
  }
} else {
  $tasksFile = Resolve-ActiveTasksFile
  if (-not $tasksFile) {
    Write-Usage 'run-phases: no active feature; pass -Feature <slug>'
    exit 2
  }
  $Feature = Get-FeatureOf $tasksFile
}
Write-Output "run-phases: feature $Feature ($tasksFile)"

# 2. Open phases.
$tasksPath = Join-Path $repoRoot $tasksFile
$phases = @(Get-OpenPhases $tasksPath)
# An id lands in a regex, a log file name and the claude prompt, so it is a
# plain token, never dots only or with a `..` in it, or the run stops before
# any session starts.
foreach ($id in $phases) {
  if ($id -notmatch '^[A-Za-z0-9._-]+$' -or $id -match '^\.+$|\.\.') {
    Write-Usage "run-phases: invalid phase id '$id' in $tasksFile"
    exit 1
  }
}
if ($phases.Count -eq 0) {
  Write-Output "run-phases: no open phase in $tasksFile"
  exit 0
}
Write-Output "run-phases: open phases: $($phases -join ' ')"

$phaseFlags = @('--max-turns', "$MaxTurns", '--max-budget-usd', "$Budget", '--output-format', 'json', '--permission-mode', 'bypassPermissions')
if ($Model) { $phaseFlags += @('--model', $Model) }

if ($DryRun) {
  foreach ($id in $phases) {
    Write-Output "claude -p `"/phase $id`" $($phaseFlags -join ' ')"
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 3. Smoke check: the CLI answers and the key is valid.
$smoke = Join-Path $logDir 'smoke.json'
$smokeErr = Join-Path $logDir 'smoke.stderr'
& claude -p 'Reply with the single word READY.' --bare --output-format json --max-turns 1 > $smoke 2> $smokeErr
if ($LASTEXITCODE -ne 0) {
  if (Test-Path -LiteralPath $smokeErr) { Get-Content -LiteralPath $smokeErr | Write-Output }
  Write-Output "run-phases: stopped before the first phase: the smoke check failed (see $smoke)"
  exit 1
}
$smokeSubtype = Read-ResultField $smoke 'subtype'
if ($smokeSubtype -ne 'success') {
  Write-Output "run-phases: stopped before the first phase: the smoke check ended with subtype $smokeSubtype (see $smoke)"
  exit 1
}

# 4. The loop.
$spent = 0.0
$count = 0
foreach ($id in $phases) {
  $out = Join-Path $logDir "$id.json"
  $err = Join-Path $logDir "$id.stderr"
  Write-Output "run-phases: phase $id started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  & claude -p "/phase $id" @phaseFlags > $out 2> $err
  $rc = $LASTEXITCODE
  if ((Test-Path -LiteralPath $err) -and (Get-Item -LiteralPath $err).Length -gt 0) { Get-Content -LiteralPath $err | Write-Output }
  if ($rc -ne 0) {
    Stop-Loop $id "the session exited with code $rc (see $out and $err)"
  }

  $subtype = Read-ResultField $out 'subtype'
  $result = [string](Read-ResultField $out 'result')
  $cost = Read-ResultField $out 'total_cost_usd'
  # A result without a cost cannot be added to the total. Under a cap that is
  # a stop, not a free phase; without a cap it counts as zero.
  if ($null -eq $cost -and $Total -ne 0) {
    Stop-Loop $id "the result carries no total_cost_usd, so the -Total cap cannot be checked (see $out)"
  }
  if ($null -eq $cost) { $cost = 0 }
  $cost = [double]$cost
  $spent += $cost
  $count += 1
  Write-Output "run-phases: phase $id finished $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), subtype $subtype, cost $cost, spent $spent"

  if ($subtype -ne 'success' -or [string](Read-ResultField $out 'is_error') -eq 'True') {
    Stop-Loop $id "the session ended with subtype $subtype (see $out)"
  }
  if ($result -match "Phase $([regex]::Escape($id)) - BLOCKED") {
    Stop-Loop $id "the phase reported BLOCKED (see $out)"
  }
  $stillOpen = @(Get-OpenPhases $tasksPath) | Where-Object { $_.ToLowerInvariant() -eq $id.ToLowerInvariant() }
  if ($stillOpen) {
    Stop-Loop $id "the phase ended but left tasks open in $tasksFile"
  }
  if ($Total -ne 0 -and ($spent -ge $Total -or ($spent + $cost) -gt $Total)) {
    Stop-Loop $id "spent $spent of the total $Total, no room for another phase"
  }
}

Write-Output "run-phases: done, $count phases"
