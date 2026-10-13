# Builds resources/bin/casparser.exe from cas_helper.py.
# Needed only on the developer/build machine; end users never need Python.
#
#   pwsh tools/casparser/build.ps1
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Resolve-Path (Join-Path $here '..\..')
$venv = Join-Path $here '.venv'
$py = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path $py)) {
    python -m venv $venv
    & $py -m pip install --upgrade pip
}
& $py -m pip install -r (Join-Path $here 'requirements.txt')

$work = Join-Path $here 'build'
$dist = Join-Path $root 'resources\bin'
& $py -m PyInstaller `
    --onefile --noconfirm --clean `
    --name casparser `
    --collect-all casparser `
    --collect-all pypdfium2 `
    --collect-all pypdfium2_raw `
    --collect-all casparser_isin `
    --workpath $work --specpath $work --distpath $dist `
    (Join-Path $here 'cas_helper.py')

Write-Host "Built $(Join-Path $dist 'casparser.exe')"
