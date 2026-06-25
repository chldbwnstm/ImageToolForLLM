import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCRIPTS_DIR } from "../paths.js";

const SCRIPT = path.join(SCRIPTS_DIR, "capture-desktop.ps1");

/**
 * Windows-only: capture the desktop, minimizing the annotator browser window
 * first (so the browser isn't in the shot), then restoring it. Uses user32.dll
 * (ShowWindow) + GDI CopyFromScreen via a bundled PowerShell script.
 */
export async function captureDesktopMinimizingAnnotator(
  mode: "all" | "primary",
): Promise<{ png: Buffer; width: number; height: number }> {
  const out = path.join(tmpdir(), `itfl-cap-${process.pid}-${Date.now()}.png`);
  const dims = await new Promise<string>((resolve, reject) => {
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Out", out, "-Mode", mode],
      { windowsHide: true },
    );
    let o = "";
    let e = "";
    ps.stdout.on("data", (d) => (o += d));
    ps.stderr.on("data", (d) => (e += d));
    ps.on("error", reject);
    ps.on("close", (code) =>
      code === 0 ? resolve(o.trim()) : reject(new Error(`capture-desktop.ps1 exited ${code}: ${e.trim()}`)),
    );
  });

  const png = await readFile(out);
  await unlink(out).catch(() => {});
  const m = /(\d+)x(\d+)/.exec(dims);
  return { png, width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0 };
}
