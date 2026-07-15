# Test gateway connectivity
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:18789/acp/' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    Write-Output "HTTP Status: $($r.StatusCode)"
    Write-Output "Content Length: $($r.Content.Length)"
} catch {
    Write-Output "HTTP Error: $($_.Exception.Message)"
}

# Test WebSocket connectivity info
Write-Output ""
Write-Output "=== Checking port 18789 ==="
try {
    $conn = Get-NetTCPConnection -LocalPort 18789 -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | Format-Table LocalAddress, LocalPort, State, OwningProcess -AutoSize
        foreach ($c in $conn) {
            $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Output "Process: $($proc.Name) (PID: $($proc.Id))"
            }
        }
    } else {
        Write-Output "No connections found on port 18789!"
    }
} catch {
    Write-Output "NetTCPConnection error: $($_.Exception.Message)"
}

# Check gateway log for the actual runtime token
Write-Output ""
Write-Output "=== Checking gateway log for token info ==="
$logPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.openclaw\gateway_stdout.log'
if (Test-Path $logPath) {
    $logLines = Get-Content $logPath -Tail 50 -Encoding UTF8 -ErrorAction SilentlyContinue
    $tokenLines = $logLines | Where-Object { $_ -match 'token|auth|listen' }
    foreach ($line in $tokenLines) {
        Write-Output $line
    }
} else {
    Write-Output "Gateway log not found at: $logPath"
}
