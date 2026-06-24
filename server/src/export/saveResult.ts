import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Region } from "../annotate/webserver.js";

export interface SaveOptions {
  outDir: string;
  name: string; // base name, no extension
  /** The clean original capture. Omitted for multi-monitor (composite is browser-only). */
  originalPng?: Buffer;
  annotatedPng: Buffer;
  regions: Region[];
  source: string;
  width: number;
  height: number;
  window?: { title: string; app: string };
}

export interface SaveResultPaths {
  annotated: string;
  sidecar: string;
  original: string | null;
}

/**
 * Write the handoff artifacts:
 *   <name>.annotated.png   numbered boxes burned in (from the browser canvas)
 *   <name>.png             the original capture
 *   <name>.regions.json    the legend (imagetoolforllm/regions@1)
 */
export async function saveAnnotationResult(o: SaveOptions): Promise<SaveResultPaths> {
  await mkdir(o.outDir, { recursive: true });
  const annotated = path.join(o.outDir, `${o.name}.annotated.png`);
  const sidecar = path.join(o.outDir, `${o.name}.regions.json`);
  let original: string | null = null;

  await writeFile(annotated, o.annotatedPng);
  if (o.originalPng) {
    original = path.join(o.outDir, `${o.name}.png`);
    await writeFile(original, o.originalPng);
  }

  const json = {
    schema: "imagetoolforllm/regions@1",
    createdAt: new Date().toISOString(),
    source: o.source,
    window: o.window ?? null,
    image: {
      annotated: path.basename(annotated),
      original: original ? path.basename(original) : null,
      width: o.width,
      height: o.height,
    },
    bboxFormat: "xywh",
    regions: o.regions,
  };
  await writeFile(sidecar, JSON.stringify(json, null, 2), "utf8");

  return { annotated, sidecar, original };
}
