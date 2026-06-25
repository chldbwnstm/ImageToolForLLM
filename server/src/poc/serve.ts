/**
 * Manual test of the PERSISTENT capture session (no Claude needed).
 * Opens one browser; use the [Capture] button to shoot repeatedly, annotate,
 * and Send (whole image or a region). Each Send saves to ./shots and is logged
 * here. Click "End" in the browser (or Ctrl+C) to stop.
 *
 *   npm run serve -w server
 */
import { ensureSession, nextShot } from "../annotate/sessionServer.js";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureSession(config.host, config.outDir);
  console.log(`Capture session open. Default save folder: ${config.outDir}`);
  console.log('Capture → annotate → Send, as many times as you like. "End" (or Ctrl+C) to stop.\n');

  // Drain shots as they arrive (this is what the receive_shot MCP tool returns one-at-a-time).
  for (let n = 1; ; n++) {
    const shot = await nextShot();
    if (!shot) {
      console.log("Session ended.");
      break;
    }
    console.log(
      `#${n}  "${shot.title}"  ${shot.width}x${shot.height}  ${shot.regions.length} region(s)\n` +
        `     -> ${shot.paths.annotated}`,
    );
  }
}

main().catch((err) => {
  console.error("serve failed:", err);
  process.exit(1);
});
