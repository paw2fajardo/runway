$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
Copy-Item (Join-Path $repoRoot 'docker_deploy.ps1') $tempRoot
$packageFixture = @'
{
  "name": "fixture",
  "version": "1.2.3"
}
'@
$lockFixture = @'
{
  "name": "fixture",
  "version": "1.2.3",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "fixture",
      "version": "1.2.3"
    },
    "node_modules/dep": {
      "version": "9.9.9"
    }
  }
}
'@
Set-Content -Path (Join-Path $tempRoot 'package.json') -Value $packageFixture
Set-Content -Path (Join-Path $tempRoot 'package-lock.json') -Value $lockFixture
$global:deployTestCalls = [System.Collections.Generic.List[string]]::new()
$global:deployTestFailPush = $false
$global:deployTestFailBuild = $false

function git { $global:deployTestCalls.Add("git $($args -join ' ')"); $global:LASTEXITCODE = 0 }
function docker {
    $global:deployTestCalls.Add("docker $($args -join ' ')")
    $global:LASTEXITCODE = if (($global:deployTestFailPush -and $args[0] -eq 'push') -or ($global:deployTestFailBuild -and $args[0] -eq 'build')) { 1 } else { 0 }
}

try {
    foreach ($case in @(@{ Option = '1'; Version = '1.2.4' }, @{ Option = '2'; Version = '1.3.0' }, @{ Option = '3'; Version = '2.0.0' })) {
        Set-Content -Path (Join-Path $tempRoot 'package.json') -Value $packageFixture
        Set-Content -Path (Join-Path $tempRoot 'package-lock.json') -Value $lockFixture
        $global:deployTestCalls.Clear()
        & (Join-Path $tempRoot 'docker_deploy.ps1') $case.Option
        if ($global:deployTestCalls[-4] -ne "docker push paw2fajardo/runway:$($case.Version)") { throw "Wrong image version for option $($case.Option)." }
        $package = Get-Content (Join-Path $tempRoot 'package.json') -Raw | ConvertFrom-Json
        $lock = Get-Content (Join-Path $tempRoot 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
        if ($package.version -ne $case.Version -or $lock.version -ne $case.Version -or $lock.packages[''].version -ne $case.Version) { throw "Version files not updated for option $($case.Option)." }
        if ($lock.packages['node_modules/dep'].version -ne '9.9.9') { throw "Dependency version in package-lock.json was erroneously modified." }
    }

    Set-Content -Path (Join-Path $tempRoot 'package.json') -Value $packageFixture
    Set-Content -Path (Join-Path $tempRoot 'package-lock.json') -Value $lockFixture
    $global:deployTestFailPush = $true
    $failed = $false
    try { & (Join-Path $tempRoot 'docker_deploy.ps1') 1 } catch { $failed = $true }
    if (-not $failed) { throw 'Push failure must fail the deploy.' }
    if ((Get-Content (Join-Path $tempRoot 'package.json') -Raw | ConvertFrom-Json).version -ne '1.2.3') { throw 'Push failure must not update package.json.' }
    if ((Get-Content (Join-Path $tempRoot 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable).version -ne '1.2.3') { throw 'Push failure must not update package-lock.json.' }

    $global:deployTestFailPush = $false
    $global:deployTestFailBuild = $true
    $global:deployTestCalls.Clear()
    $buildFailed = $false
    try { & (Join-Path $tempRoot 'docker_deploy.ps1') 1 } catch { $buildFailed = $true }
    if (-not $buildFailed -or @($global:deployTestCalls | Where-Object { $_ -like 'docker push *' }).Count -ne 0) { throw 'Build failure must stop before pushes.' }

    $global:deployTestFailBuild = $false
    & (Join-Path $tempRoot 'docker_deploy.ps1') 1
    if ((Get-Content (Join-Path $tempRoot 'package.json') -Raw | ConvertFrom-Json).version -ne '1.2.4') { throw 'Next small bump must increment from saved version.' }
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

Write-Host 'PASS: numeric bumps, package version persistence, failed push safety, and repeated patch bump.'
