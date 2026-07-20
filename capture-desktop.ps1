# Full-desktop screenshot with DPI-safe metrics.
# Compatible with home PCs, Wuying/cloud desktops, multi-monitor, 125%/150%/200% scaling.
param(
    [string]$OutPath = ""
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ScreenCapNative {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    public const int SM_CXSCREEN = 0;
    public const int SM_CYSCREEN = 1;
    public const int SM_XVIRTUALSCREEN = 76;
    public const int SM_YVIRTUALSCREEN = 77;
    public const int SM_CXVIRTUALSCREEN = 78;
    public const int SM_CYVIRTUALSCREEN = 79;
    public const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }
}
"@

# DPI awareness: Prefer PerMonitorV2 so Bounds/GetSystemMetrics are physical pixels.
$dpiOk = $false
try {
    if ([ScreenCapNative]::SetProcessDpiAwarenessContext([IntPtr]-4)) { $dpiOk = $true }
} catch {}
if (-not $dpiOk) {
    try { if ([ScreenCapNative]::SetProcessDpiAwareness(2) -eq 0) { $dpiOk = $true } } catch {}
}
if (-not $dpiOk) {
    try { if ([ScreenCapNative]::SetProcessDPIAware()) { $dpiOk = $true } } catch {}
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-VirtualDesktopRect {
    # Ground truth for "whole desktop" including multi-monitor.
    $x = [ScreenCapNative]::GetSystemMetrics(76)
    $y = [ScreenCapNative]::GetSystemMetrics(77)
    $w = [ScreenCapNative]::GetSystemMetrics(78)
    $h = [ScreenCapNative]::GetSystemMetrics(79)
    if ($w -gt 0 -and $h -gt 0) {
        return @{ X = $x; Y = $y; Width = $w; Height = $h; Source = 'GetSystemMetrics-Virtual' }
    }

    $vs = [System.Windows.Forms.Screen]::PrimaryScreen
    try {
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        if ($vs.Width -gt 0 -and $vs.Height -gt 0) {
            return @{ X = $vs.X; Y = $vs.Y; Width = $vs.Width; Height = $vs.Height; Source = 'SystemInformation.VirtualScreen' }
        }
    } catch {}

    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    return @{ X = $b.X; Y = $b.Y; Width = $b.Width; Height = $b.Height; Source = 'PrimaryScreen.Bounds' }
}

function Get-ActiveMonitorRect {
    $hwnd = [ScreenCapNative]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    $mon = [ScreenCapNative]::MonitorFromWindow($hwnd, 2)
    if ($mon -eq [IntPtr]::Zero) { return $null }
    $mi = New-Object ScreenCapNative+MONITORINFO
    $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
    if (-not [ScreenCapNative]::GetMonitorInfo($mon, [ref]$mi)) { return $null }
    $r = $mi.rcMonitor
    $w = $r.Right - $r.Left
    $h = $r.Bottom - $r.Top
    if ($w -le 0 -or $h -le 0) { return $null }
    return @{ X = $r.Left; Y = $r.Top; Width = $w; Height = $h; Source = 'MonitorFromWindow' }
}

# Default: full virtual desktop (all screens). Falls back to active monitor only if virtual metrics fail.
$rect = Get-VirtualDesktopRect

# Sanity: if virtual size is absurdly smaller than primary physical screen, prefer primary metrics.
$cx = [ScreenCapNative]::GetSystemMetrics(0)
$cy = [ScreenCapNative]::GetSystemMetrics(1)
if ($cx -gt 0 -and $cy -gt 0) {
    if ($rect.Width -lt [Math]::Floor($cx * 0.9) -or $rect.Height -lt [Math]::Floor($cy * 0.9)) {
        # Likely DPI-virtualized wrong bounds — rebuild from primary + active monitor max.
        $active = Get-ActiveMonitorRect
        $candidates = @(
            @{ X = 0; Y = 0; Width = $cx; Height = $cy; Source = 'SM_CXSCREEN' },
            $rect
        )
        if ($active) { $candidates += $active }
        try {
            $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
            $candidates += @{ X = $vs.X; Y = $vs.Y; Width = $vs.Width; Height = $vs.Height; Source = 'VirtualScreen-retry' }
        } catch {}
        $rect = $candidates | Sort-Object { $_.Width * $_.Height } -Descending | Select-Object -First 1
    }
}

if ($rect.Width -lt 64 -or $rect.Height -lt 64) {
    throw "Invalid capture rect: $($rect.Width)x$($rect.Height) via $($rect.Source)"
}

$bitmap = New-Object System.Drawing.Bitmap([int]$rect.Width, [int]$rect.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([System.Drawing.Color]::Black)
    $size = New-Object System.Drawing.Size([int]$rect.Width, [int]$rect.Height)
    # CopyFromScreen uses desktop coordinates (supports negative X/Y on left/above primary monitors).
    $graphics.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, $size)

    if ([string]::IsNullOrWhiteSpace($OutPath)) {
        $OutPath = Join-Path $env:TEMP 'openclaw-screenshot.png'
    }
    $dir = Split-Path -Parent $OutPath
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $OutPath
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
