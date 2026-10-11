param(
    [ValidateSet('small', 'big', 'major')]
    [string]$VersionType
)

$ErrorActionPreference = 'Stop'
if (-not $VersionType) { $VersionType = Read-Host 'Version bump (small/big/major)' }
if ($VersionType -notin @('small', 'big', 'major')) { throw 'Expected small, big, or major.' }

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}

Push-Location $PSScriptRoot
try {
    Invoke-Checked 'git' @('checkout', 'main')
    Invoke-Checked 'git' @('pull', '--ff-only')

    $currentVersion = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
    if ($currentVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric major.minor.patch package version.' }
    $parts = [version]$currentVersion
    $releaseVersion = switch ($VersionType) {
        'small' { "$($parts.Major).$($parts.Minor).$($parts.Build + 1)" }
        'big' { "$($parts.Major).$($parts.Minor + 1).0" }
        'major' { "$($parts.Major + 1).0.0" }
    }
    Write-Host "Building runway version $releaseVersion ($VersionType bump from $currentVersion)"

    Invoke-Checked 'docker' @('build', '-t', "paw2fajardo/runway:$releaseVersion", '-t', 'paw2fajardo/runway:latest', '.')
    Invoke-Checked 'docker' @('build', '--target', 'payday-worker', '-t', "paw2fajardo/runway-worker:$releaseVersion", '-t', 'paw2fajardo/runway-worker:latest', '.')
    foreach ($imageName in @('runway', 'runway-worker')) {
        Invoke-Checked 'docker' @('push', "paw2fajardo/${imageName}:$releaseVersion")
        Invoke-Checked 'docker' @('push', "paw2fajardo/${imageName}:latest")
    }
} finally {
    Pop-Location
}
