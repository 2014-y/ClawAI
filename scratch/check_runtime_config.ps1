$cf = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.openclaw\openclaw.json'
if (Test-Path $cf) {
    $json = Get-Content $cf -Raw | ConvertFrom-Json
    Write-Output "=== plugins.allow ==="
    if ($json.plugins.allow) {
        $json.plugins.allow | ForEach-Object { Write-Output "  $_" }
    } else { Write-Output "  (empty)" }
    
    Write-Output ""
    Write-Output "=== plugins.load.paths ==="
    if ($json.plugins.load -and $json.plugins.load.paths) {
        $json.plugins.load.paths | ForEach-Object { 
            $exists = Test-Path $_
            Write-Output "  $_ (exists=$exists)" 
        }
    } else {
        Write-Output "  (no load.paths section)"
    }
    
    Write-Output ""
    Write-Output "=== plugins.installs ==="
    if ($json.plugins.installs) {
        $json.plugins.installs.PSObject.Properties | ForEach-Object {
            $ip = $_.Value.installPath
            $exists = if ($ip) { Test-Path $ip } else { 'N/A' }
            Write-Output "  $($_.Name): installPath=$ip (exists=$exists)"
        }
    } else { Write-Output "  (empty)" }
    
    Write-Output ""
    Write-Output "=== Enabled plugin entries ==="
    if ($json.plugins.entries) {
        $json.plugins.entries.PSObject.Properties | Where-Object { $_.Value.enabled -eq $true } | ForEach-Object {
            Write-Output "  $($_.Name)"
        }
    }

    Write-Output ""
    Write-Output "=== logging.level ==="
    Write-Output "  $($json.logging.level)"

    Write-Output ""
    Write-Output "=== gateway config ==="
    Write-Output "  port: $($json.gateway.port)"
    Write-Output "  auth.mode: $($json.gateway.auth.mode)"
} else {
    Write-Output "Config file not found: $cf"
}
