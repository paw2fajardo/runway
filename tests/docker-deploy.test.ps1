$ErrorActionPreference = 'Stop'
$deployScript = Join-Path $PSScriptRoot '../docker_deploy.ps1'
$global:deployTestCalls = [System.Collections.Generic.List[string]]::new()
$global:deployTestFailBuild = $false

function git {
    $global:deployTestCalls.Add("git $($args -join ' ')")
    $global:LASTEXITCODE = 0
}
function docker {
    $global:deployTestCalls.Add("docker $($args -join ' ')")
    $global:LASTEXITCODE = if ($global:deployTestFailBuild -and $args[0] -eq 'build') { 1 } else { 0 }
}

$version = [version](Get-Content (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).version
$expectedVersions = @{
    small = "$($version.Major).$($version.Minor).$($version.Build + 1)"
    big = "$($version.Major).$($version.Minor + 1).0"
    major = "$($version.Major + 1).0.0"
}
$originalLocation = (Get-Location).Path
foreach ($bump in @('small', 'big', 'major')) {
    $global:deployTestCalls.Clear()
    & $deployScript $bump
    $release = $expectedVersions[$bump]
    $expected = @(
        'git checkout main', 'git pull --ff-only',
        "docker build -t paw2fajardo/runway:$release -t paw2fajardo/runway:latest .",
        "docker build --target payday-worker -t paw2fajardo/runway-worker:$release -t paw2fajardo/runway-worker:latest .",
        "docker push paw2fajardo/runway:$release", 'docker push paw2fajardo/runway:latest',
        "docker push paw2fajardo/runway-worker:$release", 'docker push paw2fajardo/runway-worker:latest'
    )
    if (($global:deployTestCalls -join "`n") -cne ($expected -join "`n")) { throw "Incorrect commands for $bump." }
}
$global:deployTestCalls.Clear()
$global:deployTestFailBuild = $true
$failed = $false
try { & $deployScript small } catch { $failed = $true }
if (-not $failed -or $global:deployTestCalls.Count -ne 3) { throw 'Build failure must stop before worker build and pushes.' }
if ((Get-Location).Path -ne $originalLocation) { throw 'Deploy must restore the working directory.' }
Write-Host 'PASS: all version bumps, image tags, fail-closed build, and working-directory restoration.'
