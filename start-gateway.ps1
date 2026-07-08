# Hard sandbox - completely isolate node
$env:PATH = "C:\WINDOWS\system32;C:\WINDOWS;C:\WINDOWS\System32\Wbem;C:\WINDOWS\System32\WindowsPowerShell\v1.0\"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeHome = Join-Path $scriptDir ".node-sandbox"
$node = Join-Path $nodeHome "node.exe"
$modDir = Join-Path $nodeHome "node_modules"
$indexJs = Join-Path $modDir "openclaw\dist\index.js"

Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ' OpenClaw Gateway (Hard Sandbox)' -ForegroundColor DarkGray
Write-Host ' Node: .node-sandbox (local, portable)' -ForegroundColor DarkGray
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path $node)) {
    Write-Host 'ERROR: Node sandbox not found at .node-sandbox\' -ForegroundColor Red
    Write-Host 'Please copy your node installation into .node-sandbox' -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host 'Node version: ' -NoNewline -ForegroundColor Gray
& $node --version
Write-Host ''
Write-Host 'Starting Gateway...' -ForegroundColor Gray
Write-Host ''

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node
$psi.Arguments = "`"$indexJs`" gateway run"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::Start($psi)

while (-not $proc.StandardOutput.EndOfStream) {
    $line = $proc.StandardOutput.ReadLine()
    if ($line) { Write-Host $line }
}
while (-not $proc.StandardError.EndOfStream) {
    $line = $proc.StandardError.ReadLine()
    if ($line) { Write-Host $line }
}

$proc.WaitForExit()
