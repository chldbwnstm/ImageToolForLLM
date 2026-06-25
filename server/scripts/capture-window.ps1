param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Client = 1  # 1 = client area only (exclude title bar), like ImageTool's default PrintWindow(3)
)

# Window capture replicating a proven Windows approach:
#   - DPI-Unaware (process + thread) so PrintWindow GPU readback works
#   - 32bpp top-down DIB section (NOT CreateCompatibleBitmap) or GPU content comes back black
#   - PrintWindow flags: 3 (PW_CLIENTONLY|PW_RENDERFULLCONTENT) for client, 2 for full window

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public class ITFLPW {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct BMIH {
    public int biSize; public int biWidth; public int biHeight; public short biPlanes; public short biBitCount;
    public int biCompression; public int biSizeImage; public int biXPPM; public int biYPPM; public int biClrUsed; public int biClrImportant;
  }
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] public static extern int FillRect(IntPtr hdc, ref RECT r, IntPtr brush);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr dc, ref BMIH bmi, uint usage, out IntPtr bits, IntPtr sect, uint off);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] public static extern IntPtr GetStockObject(int i);

  public static string Capture(long hwnd, string outPath, int client) {
    IntPtr hw = new IntPtr(hwnd);
    RECT rc; int w, h;
    if (client == 1) { GetClientRect(hw, out rc); w = rc.Right; h = rc.Bottom; }
    else { GetWindowRect(hw, out rc); w = rc.Right - rc.Left; h = rc.Bottom - rc.Top; }
    if (w <= 0 || h <= 0) return "0x0";

    IntPtr screen = GetDC(IntPtr.Zero);
    IntPtr memDC = CreateCompatibleDC(screen);
    BMIH bi = new BMIH();
    bi.biSize = Marshal.SizeOf(typeof(BMIH));
    bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32; bi.biCompression = 0; // BI_RGB, top-down
    IntPtr bits;
    IntPtr hBmp = CreateDIBSection(memDC, ref bi, 0, out bits, IntPtr.Zero, 0);
    IntPtr old = SelectObject(memDC, hBmp);

    RECT fill = new RECT(); fill.Left = 0; fill.Top = 0; fill.Right = w; fill.Bottom = h;
    FillRect(memDC, ref fill, GetStockObject(4)); // BLACK_BRUSH

    uint flags = (client == 1) ? 3u : 2u; // PW_RENDERFULLCONTENT(2) | PW_CLIENTONLY(1)
    IntPtr prev = SetThreadDpiAwarenessContext(new IntPtr(-1)); // DPI_AWARENESS_CONTEXT_UNAWARE
    PrintWindow(hw, memDC, flags);
    if (prev != IntPtr.Zero) SetThreadDpiAwarenessContext(prev);

    Bitmap bmp = new Bitmap(w, h, w * 4, PixelFormat.Format32bppRgb, bits); // ignore alpha (opaque), like BGRA->BGR
    bmp.Save(outPath, ImageFormat.Png);
    bmp.Dispose();

    SelectObject(memDC, old);
    DeleteObject(hBmp);
    DeleteDC(memDC);
    ReleaseDC(IntPtr.Zero, screen);
    return w + "x" + h;
  }
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr ctx);
}
"@

try { [void][ITFLPW]::SetProcessDpiAwarenessContext([IntPtr](-1)) } catch {}
Write-Output ([ITFLPW]::Capture([long]$Hwnd, $Out, [int]$Client))
