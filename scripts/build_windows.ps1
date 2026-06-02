$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$VenvDir = Join-Path $RepoRoot ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

Set-Location $RepoRoot

if (-not (Test-Path $PythonExe)) {
    python -m venv $VenvDir
}

& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r requirements-app.txt
& $PythonExe -m PyInstaller .\GroundControlSystem.spec --noconfirm

$AppExe = Join-Path $RepoRoot "dist\GroundControlSystem\GroundControlSystem.exe"
Write-Host "Built app: $AppExe"

$Inno = Get-Command iscc -ErrorAction SilentlyContinue
$InnoPath = if ($Inno) { $Inno.Source } else { $null }
if (-not $InnoPath) {
    $KnownInnoPaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
    )
    $InnoPath = $KnownInnoPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ($InnoPath) {
    & $InnoPath .\installer\GroundControlSystem.iss
    $InstallerExe = Join-Path $RepoRoot "dist\installer\GroundControlSystemSetup.exe"
    Write-Host "Built installer: $InstallerExe"
} else {
    Write-Host "Inno Setup was not found. Skipped installer build."
    Write-Host "Install Inno Setup and rerun this script to create dist\installer\GroundControlSystemSetup.exe."
}
