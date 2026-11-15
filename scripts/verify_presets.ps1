# Check that the API is up and that preset slugs match what is on disk.
# -Probe never POSTs /api/jobs and never calls IRSA. There is no other mode.
#
#   powershell -File scripts\verify_presets.ps1 -Probe

param(
    [switch] $Probe,
    [string] $Base = "http://localhost:8000"
)

if (-not $Probe) {
    Write-Output "Pass -Probe. This script only checks the server and the slugs. It does not POST /api/jobs and it does not call IRSA."
    exit 2
}

$presets = @(
    @{ Name = "WISE 0855 coord"; Slug = "c-a55d19970b4b8fd7"; Safe = $true },
    @{ Name = "Proxima Centauri"; Slug = "c-843ee254e3d6b9be"; Safe = $false },
    @{ Name = "Epsilon Eridani"; Slug = "c-c8a384476c0ae479"; Safe = $false }
)

$health = (curl.exe -s -m 5 -w "`n%{http_code}" "$Base/api/health" | Out-String).Trim()
if ($health -notmatch '"status":"ok"' -or $health -notmatch '200\s*$') {
    Write-Output "server not ready at $Base ($($health -replace '\s+', ' '))"
    exit 5
}
Write-Output "server ok $Base"

$bad = 0
foreach ($preset in $presets) {
    $code = curl.exe -s -o NUL -m 5 -w "%{http_code}" "$Base/data/$($preset.Slug)/meta.json"
    $expect = if ($preset.Safe) { "200" } else { "404" }
    $mark = if ($preset.Safe) { "safe for demo" } else { "may fail while IRSA is unstable" }
    if ($code -eq $expect) {
        Write-Output "$($preset.Slug) $($preset.Name) HTTP $code ($mark)"
    } else {
        Write-Output "$($preset.Slug) $($preset.Name) HTTP $code expected $expect ($mark)"
        $bad++
    }
}

if ($bad -gt 0) { exit 3 }
exit 0
