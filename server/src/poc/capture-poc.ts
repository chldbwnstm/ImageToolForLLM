/**
 * Capture PoC — proves node-screenshots works on this machine.
 *
 *   npm run poc -w server      (or: npx tsx server/src/poc/capture-poc.ts)
 *
 * Captures the primary monitor and one real window, saving both PNGs to ./shots.
 * This is a standalone diagnostic script (NOT the MCP server), so console.log is fine here.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { listMonitors, capturePrimaryMonitor } from "../capture/screen.js";
import { listWindows, captureWindowById } from "../capture/window.js";

async function main(): Promise<void> {
  const outDir = path.resolve("shots");
  await mkdir(outDir, { recursive: true });
  console.log(`Output dir: ${outDir}\n`);

  // --- Monitors ---
  console.log("=== Monitors ===");
  const monitors = listMonitors();
  console.table(monitors);

  console.log("\nCapturing primary monitor...");
  const monitorPng = await capturePrimaryMonitor();
  const monitorPath = path.join(outDir, "poc-monitor.png");
  await writeFile(monitorPath, monitorPng);
  console.log(`  saved: ${monitorPath} (${monitorPng.length.toLocaleString()} bytes)`);

  // --- Windows ---
  console.log("\n=== Windows (top 15 by z-order) ===");
  const windows = listWindows();
  console.table(
    windows.slice(0, 15).map((w) => ({
      id: w.id,
      app: w.appName,
      title: w.title.length > 40 ? w.title.slice(0, 39) + "…" : w.title,
      w: w.width,
      h: w.height,
      focused: w.isFocused,
    })),
  );

  const target = windows.find((w) => w.width > 200 && w.height > 150);
  if (target) {
    console.log(`\nCapturing window: [${target.id}] ${target.appName} — ${target.title}`);
    const winPng = await captureWindowById(target.id);
    const winPath = path.join(outDir, "poc-window.png");
    await writeFile(winPath, winPng);
    console.log(`  saved: ${winPath} (${winPng.length.toLocaleString()} bytes)`);
  } else {
    console.log("\nNo suitable window found to capture (need one >200x150).");
  }

  console.log("\n✓ PoC done.");
}

main().catch((err) => {
  console.error("PoC failed:", err);
  process.exit(1);
});
