$cf = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.openclaw\openclaw.json'
$lines = Get-Content $cf -Encoding UTF8
$total = $lines.Count
Write-Output "Total lines: $total"

# Find gateway section
$gatewayStart = -1
for ($i = 0; $i -lt $total; $i++) {
    if ($lines[$i] -match '"gateway"') {
        $gatewayStart = $i
        break
    }
}

if ($gatewayStart -ge 0) {
    Write-Output "Gateway section found at line $gatewayStart"
    $end = [Math]::Min($gatewayStart + 20, $total - 1)
    for ($j = $gatewayStart; $j -le $end; $j++) {
        Write-Output $lines[$j]
    }
} else {
    Write-Output "No gateway section found!"
}
