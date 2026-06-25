import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCRIPTS_DIR } from "../paths.js";

const SCRIPT = path.join(SCRIPTS_DIR, "capture-window.ps1");
const PS32 = "C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe";

/**
 * Capture a specific window via PrintWindow (PW_RENDERFULLCONTENT) from a 32-bit,
 * DPI-unaware PowerShell — a faithful replica of the user's ImageTool. Captures
 * the window's own content even when occluded; GPU/DWM content reads back via a
 * 32bpp top-down DIB section. includeTitleBar=false captures the client area only.
 */
export async function capturePrintWindow(
  hwnd: number,
  includeTitleBar: boolean,
): Promise<{ png: Buffer; width: number; height: number }> {
  const out = path.join(tmpdir(), `itfl-pw-${process.pid}-${Date.now()}.png`);
  const exe = existsSync(PS32) ? PS32 : "powershell"; // prefer 32-bit, like ImageTool
  const client = includeTitleBar ? "0" : "1";

  const dims = await new Promise<string>((resolve, reject) => {
    const ps = spawn(
      exe,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT,
        "-Hwnd", String(hwnd), "-Out", out, "-Client", client],
      { windowsHide: true },
    );
    let o = "";
    let e = "";
    ps.stdout.on("data", (d) => (o += d));
    ps.stderr.on("data", (d) => (e += d));
    ps.on("error", reject);
    ps.on("close", (code) =>
      code === 0 ? resolve(o.trim()) : reject(new Error(`capture-window.ps1 exited ${code}: ${e.trim()}`)),
    );
  });

  const png = await readFile(out);
  await unlink(out).catch(() => {});
  const m = /(\d+)x(\d+)/.exec(dims);
  return { png, width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0 };
}
