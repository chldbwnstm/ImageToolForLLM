/**
 * Manual end-to-end test of the capture → annotate → save cycle.
 * Captures your PRIMARY monitor, opens the annotator in your browser, waits for
 * you to draw/label regions and click "Send to LLM", then saves the artifacts.
 *
 *   npm run try -w server
 *
 * Output goes to ./shots (or $IMAGETOOLFORLLM_OUT).
 */
import { captureMonitorLayers } from "../capture/screen.js";
import { runAnnotationSession } from "../annotate/session.js";
import { saveAnnotationResult } from "../export/saveResult.js";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const cap = await captureMonitorLayers("all");
  console.log(
    `Captured ${cap.layers.length} monitor(s) [${cap.layers.map((l) => l.name).join(", ")}], ` +
      `combined ${cap.width}x${cap.height}. Opening the annotator in your browser…`,
  );
  console.log('Draw a few boxes, label them, then click "Send to LLM".');

  const result = await runAnnotationSession(
    {
      layers: cap.layers.map((l) => ({ png: l.png, x: l.x, y: l.y, width: l.width, height: l.height })),
      source: "region",
      width: cap.width,
      height: cap.height,
    },
    config.host,
  );
  if (!result) {
    console.log("Cancelled or timed out — nothing saved.");
    return;
  }

  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `try-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const paths = await saveAnnotationResult({
    outDir: config.outDir,
    name,
    originalPng: result.originalPng ?? undefined, // clean composite from the browser
    annotatedPng: result.annotatedPng,
    regions: result.regions,
    source: "region",
    width: cap.width,
    height: cap.height,
  });
  console.log("\nSaved:");
  console.log("  " + paths.annotated);
  console.log("  " + paths.sidecar);
  console.log(`Regions: ${result.regions.length}`);
}

main().catch((err) => {
  console.error("try-annotate failed:", err);
  process.exit(1);
});
