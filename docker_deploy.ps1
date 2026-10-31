param(
    [ValidateSet('1', '2', '3')]
    [string]$VersionType
)

$ErrorActionPreference = 'Stop'
if (-not $VersionType) { $VersionType = Read-Host 'Version bump (1=small, 2=big, 3=major)' }
if ($VersionType -notin @('1', '2', '3')) { throw 'Expected 1, 2, or 3.' }

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
        '1' { "$($parts.Major).$($parts.Minor).$($parts.Build + 1)" }
        '2' { "$($parts.Major).$($parts.Minor + 1).0" }
        '3' { "$($parts.Major + 1).0.0" }
    }
    $bumpName = @{ '1' = 'small'; '2' = 'big'; '3' = 'major' }[$VersionType]
    Write-Host "Building runway version $releaseVersion ($bumpName bump from $currentVersion)"

    Invoke-Checked 'docker' @('build', '-t', "paw2fajardo/runway:$releaseVersion", '-t', 'paw2fajardo/runway:latest', '.')
    Invoke-Checked 'docker' @('build', '--target', 'payday-worker', '-t', "paw2fajardo/runway-worker:$releaseVersion", '-t', 'paw2fajardo/runway-worker:latest', '.')
    foreach ($imageName in @('runway', 'runway-worker')) {
        Invoke-Checked 'docker' @('push', "paw2fajardo/${imageName}:$releaseVersion")
        Invoke-Checked 'docker' @('push', "paw2fajardo/${imageName}:latest")
    }

    $versionPattern = '(?m)^([ \t]*"version"[ \t]*:[ \t]*")([^"]+)(")'
    $packagePath = Join-Path $PSScriptRoot 'package.json'
    $lockPath = Join-Path $PSScriptRoot 'package-lock.json'
    $packageJson = [System.IO.File]::ReadAllText($packagePath)
    $packageLock = [System.IO.File]::ReadAllText($lockPath)
    $packageVersions = [regex]::Matches($packageJson, $versionPattern)
    $lockVersions = [regex]::Matches($packageLock, $versionPattern)
    if ($packageVersions.Count -ne 1 -or $packageVersions[0].Groups[2].Value -ne $currentVersion) {
        throw 'Could not safely update the package.json version.'
    }
    if ($lockVersions.Count -lt 2 -or $lockVersions[0].Groups[2].Value -ne $currentVersion -or $lockVersions[1].Groups[2].Value -ne $currentVersion) {
        throw 'Could not safely update the package-lock.json versions.'
    }

    $replacement = '${1}' + $releaseVersion + '${3}'
    $packageRegex = [regex]$versionPattern
    $packageJson = $packageRegex.Replace($packageJson, $replacement, 1)
    $packageLock = $packageRegex.Replace($packageLock, $replacement, 2)
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($packagePath, $packageJson, $utf8NoBom)
    [System.IO.File]::WriteAllText($lockPath, $packageLock, $utf8NoBom)
    Write-Host "Saved release version $releaseVersion to package.json and package-lock.json."
} finally {
    Pop-Location
}
