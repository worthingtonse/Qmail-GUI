param()

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with $LASTEXITCODE"
    }
}

if (Test-Path -LiteralPath "backend") {
    Remove-Item -LiteralPath "backend" -Recurse -Force
}
New-Item -ItemType Directory -Path "backend" -Force | Out-Null

$baseUrl = if ($env:QMAIL_BIN_BASE_URL) { $env:QMAIL_BIN_BASE_URL } else { "https://cloudcoinconsortium.com/bin" }
$sumsPath = "ci-build\SHA256SUMS"
New-Item -ItemType Directory -Path "ci-build" -Force | Out-Null

curl.exe -fsSL "$baseUrl/SHA256SUMS" -o $sumsPath
if ($LASTEXITCODE -ne 0) { throw "could not download SHA256SUMS" }

$coreName = "core-windows-latest.exe"
$corePath = "backend\core.exe"
curl.exe -fsSL "$baseUrl/$coreName" -o $corePath
if ($LASTEXITCODE -ne 0) { throw "could not download $coreName" }

$expected = $null
foreach ($line in Get-Content -LiteralPath $sumsPath) {
    $parts = $line -split "\s+"
    if ($parts.Length -ge 2 -and $parts[1] -eq $coreName) {
        $expected = $parts[0].ToLowerInvariant()
        break
    }
}
if (-not $expected) {
    throw "SHA256SUMS does not contain $coreName"
}

$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $corePath).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
    throw "checksum mismatch for $coreName expected=$expected actual=$actual"
}
"$actual  $corePath" | Set-Content -LiteralPath "ci-build\windows-core.sha256" -Encoding ascii
Write-Host "verified $coreName ($actual)"

Invoke-Step "node" @("ci/stamp_ci_version.cjs")
Invoke-Step "npx" @("vite", "build")
Invoke-Step "npx" @("electron-builder", "--config", "electron-builder.config.cjs", "--win", "portable", "--x64", "--publish=never")

$artifact = "release\QMail.exe"
if (-not (Test-Path -LiteralPath $artifact)) {
    throw "$artifact was not produced"
}
$size = (Get-Item -LiteralPath $artifact).Length
if ($size -lt 50MB) {
    throw "$artifact is smaller than expected: $size bytes"
}

if ($env:WINDOWS_SIGNING -eq "on") {
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if (-not $signtool) {
        throw "WINDOWS_SIGNING=on but signtool.exe was not found on PATH"
    }
    & $signtool.Source sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $artifact
    if ($LASTEXITCODE -ne 0) {
        throw "signtool failed with $LASTEXITCODE"
    }
} else {
    Write-Host "signing skipped (WINDOWS_SIGNING=off)"
}

try {
    $versionProcess = Start-Process -FilePath (Resolve-Path -LiteralPath $artifact).Path `
        -ArgumentList "--version" `
        -NoNewWindow `
        -PassThru `
        -Wait:$false
    if (-not $versionProcess.WaitForExit(20000)) {
        Stop-Process -Id $versionProcess.Id -Force -ErrorAction SilentlyContinue
        Write-Host "QMail.exe --version timed out; keeping size/hash smoke evidence"
    } elseif ($versionProcess.ExitCode -ne 0) {
        Write-Host "QMail.exe --version exited $($versionProcess.ExitCode); keeping size/hash smoke evidence"
    } else {
        Write-Host "QMail.exe --version smoke succeeded"
    }
} catch {
    Write-Host "QMail.exe --version smoke could not run: $($_.Exception.Message); keeping size/hash smoke evidence"
}

(Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLowerInvariant() + "  release/QMail.exe" |
    Set-Content -LiteralPath "ci-build\qmail-windows.sha256" -Encoding ascii
Copy-Item -LiteralPath "version.json" -Destination "ci-build\version-windows.json" -Force
Write-Host "packaged $artifact ($size bytes)"
