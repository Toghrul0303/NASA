# Pre-warm Tier 2 coordinates and validate each result.
# Never deletes anything and never passes --force, so an existing directory is left as-is.
#
# List file: one coordinate per line, "ra dec [name...]". Blank lines and lines
# starting with # are ignored. The name may contain spaces.
#
# Usage (from anywhere):
#   powershell -File scripts\prewarm.ps1 -File scripts\prewarm.txt
#   powershell -File scripts\prewarm.ps1 -File scripts\prewarm.txt -DryRun
#   powershell -File scripts\prewarm.ps1 -File scripts\prewarm.txt -FetchBudget 1200 -SkipProbe

param(
    [Parameter(Mandatory = $true)]
    [string] $File,
    [double] $FetchBudget = 1200,
    [switch] $SkipProbe,
    [switch] $DryRun
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Spherex = Join-Path $Root "backend\.venv\Scripts\spherex.exe"
if (-not (Test-Path -LiteralPath $Spherex)) {
    Write-Error "spherex not found: $Spherex"
    exit 2
}
if (-not (Test-Path -LiteralPath $File)) {
    Write-Error "list not found: $File"
    exit 2
}

$budget = "$FetchBudget"
if ($budget -match '\.0+$') { $budget = $budget -replace '\.0+$', '' }

$commands = @()
$buildFailed = 0
foreach ($raw in Get-Content -LiteralPath $File) {
    $line = $raw.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) { continue }
    $parts = $line -split "\s+", 3
    if ($parts.Count -lt 2) {
        Write-Output "FAILED line=$line (need ra dec [name])"
        $buildFailed++
        continue
    }
    $ra = $parts[0]
    $dec = $parts[1]
    $name = if ($parts.Count -ge 3) { $parts[2].Trim() } else { "" }
    # "--dec=<value>" so a negative declination is not read as another flag.
    $argv = @("build-coord", "--ra", $ra, "--dec=$dec", "--fetch-budget", $budget)
    if ($name.Length -gt 0) { $argv += @("--name", $name) }
    $shown = "spherex build-coord --ra $ra --dec=$dec"
    if ($name.Length -gt 0) { $shown += " --name `"$name`"" }
    $shown += " --fetch-budget $budget"
    $commands += [pscustomobject]@{ Argv = $argv; Shown = $shown; Ra = $ra; Dec = $dec; Name = $name }
}

if ($DryRun) {
    foreach ($command in $commands) { Write-Output $command.Shown }
    exit 0
}

Set-Location -LiteralPath $Root
if (-not $SkipProbe) {
    $probe = & $Spherex probe irsa 2>&1 | ForEach-Object { $_.ToString() }
    $probeText = ($probe | Out-String)
    if ($LASTEXITCODE -ne 0 -or $probeText -match '(?i)(\berror\b|not implemented|traceback)') {
        Write-Output "IRSA unhealthy: skip pre-warm and retry later"
        exit 5
    }
}

$validateFailed = 0
foreach ($command in $commands) {
    $output = & $Spherex @($command.Argv) 2>&1 | ForEach-Object { $_.ToString() }
    $slug = $null
    $frames = $null
    $epochs = $null
    $seconds = $null
    foreach ($row in $output) {
        if ($row -match '^(c-[0-9a-f]{16}):\s+\S+\s+frames=(\d+)\s+epochs=(\d+)\s+failed=\d+\s+seconds=([0-9.]+)') {
            $slug = $Matches[1]; $frames = $Matches[2]; $epochs = $Matches[3]; $seconds = $Matches[4]
        } elseif ($row -match '^(c-[0-9a-f]{16}): exists, skipped') {
            $slug = $Matches[1]; $seconds = "skipped"
        }
    }
    if ($slug -and $seconds -eq "skipped") {
        $metaPath = Join-Path $Root "data\$slug\meta.json"
        if (Test-Path -LiteralPath $metaPath) {
            $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
            $frames = $meta.observations.n_frames
            $epochs = $meta.observations.n_epochs
        }
    }
    if (-not $slug -or $null -eq $frames) {
        $detail = ($output | Where-Object { $_ -match 'FAILED|Error|error' } | Select-Object -Last 1)
        if (-not $detail) { $detail = ($output | Select-Object -Last 1) }
        Write-Output "FAILED ra=$($command.Ra) dec=$($command.Dec) $detail"
        $buildFailed++
        continue
    }

    & $Spherex validate --slug $slug | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Output "$slug frames=$frames epochs=$epochs seconds=$seconds validate=FAIL"
        $validateFailed++
    } else {
        Write-Output "$slug frames=$frames epochs=$epochs seconds=$seconds"
    }
}

if ($buildFailed -gt 0) { exit 4 }
if ($validateFailed -gt 0) { exit 3 }
exit 0
