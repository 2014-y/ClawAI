# OpenClaw Gateway Launcher with nvm node switching
$node = 'C:\Users\Yuan\AppData\Roaming\nvm\v24.13.0\node.exe'
$modDir = 'C:\Users\Yuan\AppData\Roaming\nvm\v24.13.0\node_modules'
$indexJs = Join-Path $modDir 'openclaw\dist\index.js'

Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ' OpenClaw Gateway Launcher' -ForegroundColor DarkGray
Write-Host ' Node: v24.13.0 (via nvm)' -ForegroundColor DarkGray
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path $node)) {
    Write-Host 'ERROR: Node.js v24.13.0 not found!' -ForegroundColor Red
    Write-Host 'Try running: nvm install 24.13.0' -ForegroundColor Yellow
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

function Test-SkipLine {
    param([string]$Line)
    # System/config warnings
    $Line -match 'plugins\.allow is empty' -or
         $Line -match 'bonjour.*conflict' -or
         $Line -match 'State dir migration skipped' -or
         $Line -match 'Config observe anomaly' -or
         $Line -match 'Config warnings' -or
         $Line -match 'Doctor warnings' -or
         $Line -match 'Set plugins\.allow to explicit trusted ids' -or
         # Command failures
         $Line -match 'Get-NetAdapter' -or
         $Line -match 'wmic cpu' -or
         $Line -match 'netsh ' -or
         $Line -match 'console\.level' -or
         $Line -match 'redactSensitive' -or
         $Line -match 'browser\.ssrfPolicy' -or
         $Line -match 'audio_check' -or
         $Line -match 'audio\.ps1' -or
         $Line -match 'temp_hw' -or
         $Line -match 'status_check' -or
         # Error patterns
         ($Line -match 'failed' -and $Line -match 'Command') -or
         ($Line -match 'ERROR:' -and $Line -match 'at ') -or
         $Line -match 'startup_failed' -or
         $Line -match 'fetch failed' -or
         $Line -match 'getUpdates' -or
         $Line -match 'sendTyping' -or
         $Line -match 'POST fetch failed' -or
         $Line -match 'ilinkai\.weixin' -or
         $Line -match 'Monitor ended' -or
         $Line -match 'notifyStart failed' -or
         $Line -match 'failed to load bundled channel' -or
         $Line -match 'missing generated module' -or
         $Line -match 'Could not determine host' -or
         # Generic noise
         $Line -match 'inbound:' -or
         $Line -match 'outbound:' -or
         $Line -match 'debug-check' -or
         $Line -match 'Monitor started' -or
         $Line -match 'starting weixin' -or
         # Emoji notifications
         $Line -match '⚠️' -or
         $Line -match '🛠️' -or
         $Line -match '❌'
}

while (-not $proc.StandardOutput.EndOfStream) {
    $line = $proc.StandardOutput.ReadLine()
    if ($line -and -not (Test-SkipLine $line)) { Write-Host $line }
}
while (-not $proc.StandardError.EndOfStream) {
    $line = $proc.StandardError.ReadLine()
    if ($line -and -not (Test-SkipLine $line)) { Write-Host $line }
}

$proc.WaitForExit()
