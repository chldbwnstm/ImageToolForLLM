param([Parameter(Mandatory = $true)][string]$Out, [string]$Mode = "all")

# Capture the desktop, temporarily minimizing the ImageToolForLLM annotator window
# (if it is the foreground window) so the browser itself isn't in the screenshot.

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ITFLWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
}
"@

$h = [ITFLWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][ITFLWin]::GetWindowText($h, $sb, 512)
$title = $sb.ToString()

$minimized = $false
if ($title -like "*Annotator*") {
  [void][ITFLWin]::ShowWindow($h, 6)   # SW_MINIMIZE
  Start-Sleep -Milliseconds 300
  $minimized = $true
}

if ($Mode -eq "primary") {
  $r = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
} else {
  $r = [System.Windows.Forms.SystemInformation]::VirtualScreen
}

$bmp = New-Object System.Drawing.Bitmap $r.Width, $r.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.X, $r.Y, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

if ($minimized) {
  [void][ITFLWin]::ShowWindow($h, 9)   # SW_RESTORE
  [void][ITFLWin]::SetForegroundWindow($h)
}

Write-Output ("{0}x{1}" -f $r.Width, $r.Height)
