Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Force DPI awareness to PerMonitorV2 at the START of this script.
# Screen.Bounds with PER_MONITOR_AWARE_V2 returns true physical pixels
# for each monitor, regardless of its individual scaling factor.
Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class DPI {
        [DllImport("user32.dll")]
        public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr context);
        static DPI() {
            _PerMonitorV2 = new IntPtr(-4);
        }
        public static IntPtr _PerMonitorV2;
        public static void Enable() {
            SetProcessDpiAwarenessContext(_PerMonitorV2);
        }
    }
"@
# Suppress errors if DPI awareness was already set by a previous call
[DPI]::Enable() 2>$null | Out-Null

# Use Screen.Bounds (physical pixels) directly - no dynamic calculation
# This gets the TRUE physical resolution of the primary monitor
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds

$width = $bounds.Width
$height = $bounds.Height

$b = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($b)
$g.Clear([System.Drawing.Color]::Black)

$sz = New-Object System.Drawing.Size($width, $height)
$loc = $bounds.Location
$g.CopyFromScreen($loc.X, $loc.Y, 0, 0, $sz)

$outPath = "$env:TEMP/openclaw-screenshot.png"
$b.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$b.Dispose()

Write-Output $outPath