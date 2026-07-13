# Force DPI awareness to ensure physical screen pixels are captured across all Windows versions and scaling factors.
Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class WinApi {
        [DllImport("user32.dll", EntryPoint = "SetProcessDpiAwarenessContext")]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr context);

        [DllImport("shcore.dll", EntryPoint = "SetProcessDpiAwareness")]
        public static extern int SetProcessDpiAwareness(int value);

        [DllImport("user32.dll", EntryPoint = "SetProcessDPIAware")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
    }
"@

# Safely set DPI awareness with multiple fallbacks for maximum compatibility (Win7, Win8, Win8.1, Win10, Win11)
$dpiSuccess = $false
try {
    # Try Windows 10 1703+ PerMonitorV2 (-4 represents DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
    if ([WinApi]::SetProcessDpiAwarenessContext([IntPtr]-4)) {
        $dpiSuccess = $true
    }
} catch {}

if (-not $dpiSuccess) {
    try {
        # Try Windows 8.1+ PerMonitor (2 represents PROCESS_PER_MONITOR_DPI_AWARE)
        if ([WinApi]::SetProcessDpiAwareness(2) -eq 0) {
            $dpiSuccess = $true
        }
    } catch {}
}

if (-not $dpiSuccess) {
    try {
        # Try Windows Vista / Windows 7 SystemAware
        if ([WinApi]::SetProcessDPIAware()) {
            $dpiSuccess = $true
        }
    } catch {}
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Multi-monitor enhancement:
# 1. Get the handle of the current active foreground window.
$fgHwnd = [WinApi]::GetForegroundWindow()

# 2. Automatically locate the screen containing the active foreground window.
# If no active window exists or it is outside boundaries, Screen.FromHandle falls back to PrimaryScreen safely.
$screen = [System.Windows.Forms.Screen]::FromHandle($fgHwnd)
$bounds = $screen.Bounds

$width = $bounds.Width
$height = $bounds.Height

$b = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($b)
$g.Clear([System.Drawing.Color]::Black)

$sz = New-Object System.Drawing.Size($width, $height)
$loc = $bounds.Location

# Copy screen graphics using physical coordinates of the target monitor (loc.X, loc.Y)
$g.CopyFromScreen($loc.X, $loc.Y, 0, 0, $sz)

$outPath = "$env:TEMP/openclaw-screenshot.png"
$b.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$b.Dispose()

Write-Output $outPath