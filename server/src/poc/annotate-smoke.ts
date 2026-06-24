/**
 * Annotation cycle smoke test — exercises the server + /submit + save path
 * without a real browser. Simulates the browser via fetch.
 *
 *   npm run smoke:annotate -w server
 */
import assert from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startAnnotationServer } from "../annotate/webserver.js";
import { saveAnnotationResult } from "../export/saveResult.js";

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function main(): Promise<void> {
  const server = await startAnnotationServer(
    { layers: [{ png: PNG, x: 0, y: 0, width: 1, height: 1 }], source: "region", width: 1, height: 1 },
    "127.0.0.1",
  );
  const base = server.url;
  console.log("server:", base);

  // --- GET endpoints (what the browser loads) ---
  const html = await fetch(base).then((r) => r.text());
  assert.ok(html.includes("ImageToolForLLM"), "index.html served");
  for (const f of ["annotator.js", "annotator.css"]) {
    assert.equal((await fetch(base + f)).status, 200, `${f} served`);
  }
  const img = await fetch(base + "layer/0.png");
  assert.equal(img.headers.get("content-type"), "image/png", "layer content-type");
  const meta = await fetch(base + "meta").then((r) => r.json());
  assert.equal(meta.width, 1);
  assert.equal(meta.source, "region");
  assert.equal(meta.layers.length, 1, "one layer in meta");
  console.log("GET / /annotator.* /layer/0.png /meta  OK");

  // --- simulate the browser submitting ---
  const regions = [{ id: 1, label: "Menu", note: "top-left", bbox: [0, 0, 1, 1], color: "#e53935" }];
  const submit = await fetch(base + "submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      annotatedPng: "data:image/png;base64," + PNG.toString("base64"),
      originalPng: "data:image/png;base64," + PNG.toString("base64"),
      regions,
      imageWidth: 1,
      imageHeight: 1,
    }),
  });
  assert.equal(submit.status, 200, "submit accepted");

  const result = await server.result;
  assert.ok(result, "result resolved");
  assert.equal(result.regions.length, 1);
  assert.ok(result.annotatedPng.length > 0, "annotated png decoded");
  assert.ok(result.originalPng && result.originalPng.length > 0, "clean original png decoded");
  server.close();
  console.log("POST /submit  OK  (regions:", result.regions.length + ")");

  // --- save + verify artifacts ---
  const out = await mkdtemp(path.join(tmpdir(), "itfllm-"));
  const paths = await saveAnnotationResult({
    outDir: out,
    name: "login",
    originalPng: PNG,
    annotatedPng: result.annotatedPng,
    regions: result.regions,
    source: "region",
    width: 1,
    height: 1,
  });
  const sidecar = JSON.parse(await readFile(paths.sidecar, "utf8"));
  assert.equal(sidecar.schema, "imagetoolforllm/regions@1");
  assert.equal(sidecar.bboxFormat, "xywh");
  assert.equal(sidecar.regions[0].label, "Menu");
  assert.equal(sidecar.image.annotated, "login.annotated.png");
  console.log("saved:", path.basename(paths.annotated), "+", path.basename(paths.sidecar));
  await rm(out, { recursive: true, force: true });

  console.log("\n✓ Annotation cycle smoke test passed.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
