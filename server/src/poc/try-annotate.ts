/**
 * Manual end-to-end test of the capture → annotate → save cycle.
 * Captures your PRIMARY monitor, opens the annotator in your browser, waits for
 * you to draw/label regions and click "Send to LLM", then saves the artifacts.
 *
 *   npm run try -w server
 *
 * Output goes to ./shots (or $IMAGETOOLFORLLM_OUT).
 */
import path from "node:path";
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
      defaultOutDir: config.outDir,
    },
    config.host,
  );
  if (!result) {
    console.log("Cancelled — nothing saved.");
    return;
  }

  const title = result.title || "try-untitled";
  const paths = await saveAnnotationResult({
    outDir: result.outDir ? path.resolve(result.outDir) : config.outDir,
    name: title,
    title,
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
