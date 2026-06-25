#!/usr/bin/env node
/**
 * ImageToolForLLM — MCP server (skeleton)
 *
 * Communicates over stdio. IMPORTANT: stdout is the MCP protocol channel —
 * never console.log here. Use console.error (stderr) for diagnostics only.
 *
 * Current tools (step 2 skeleton):
 *   - list_monitors    : enumerate monitors
 *   - list_windows     : enumerate capturable windows
 *   - capture_monitor  : capture a monitor to PNG (raw; annotation flow added later)
 *   - capture_window   : capture a specific window to PNG (raw)
 *
 * The browser annotation handoff (annotated.png + regions.json) is wired in a
 * later step; for now these tools just save the raw capture and return its path.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import {
  listMonitors,
  capturePrimaryMonitor,
  captureMonitorLayers,
  captureMonitorById,
} from "./capture/screen.js";
import { listWindows, captureWindowById, captureWindowImage } from "./capture/window.js";
import type { AnnotationInput } from "./annotate/webserver.js";
import { runAnnotationSession } from "./annotate/session.js";
import { ensureSession, nextShot } from "./annotate/sessionServer.js";
import { saveAnnotationResult } from "./export/saveResult.js";

const config = loadConfig();

function timestampName(prefix: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${prefix}-${stamp}`;
}

async function ensureOutDir(): Promise<string> {
  await mkdir(config.outDir, { recursive: true });
  return config.outDir;
}

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Build the tool result: the annotated preview as an inline IMAGE block (so it
 * lands directly in the agent's context — the "paste into Claude" behavior),
 * plus a text block with the [ITFL: <title>] tag, saved paths, and region legend.
 */
function annotationToolResult(
  title: string,
  captureDesc: string,
  paths: { annotated: string; sidecar: string },
  result: { regions: Array<{ id: number; label: string; note: string }>; previewPng: Buffer | null },
): { content: ToolContent[] } {
  const legend =
    result.regions.map((r) => `  [${r.id}] ${r.label}${r.note ? " — " + r.note : ""}`).join("\n") ||
    "  (no regions)";
  const text =
    `[ITFL: ${title}]  ${captureDesc}\n` +
    `Saved:\n  ${paths.annotated}\n  ${paths.sidecar}\n\nRegions:\n${legend}` +
    (result.previewPng
      ? "\n\n(The image above is a downscaled preview; full resolution is at the saved path.)"
      : "");
  const content: ToolContent[] = [];
  if (result.previewPng) {
    content.push({ type: "image", data: result.previewPng.toString("base64"), mimeType: "image/png" });
  }
  content.push({ type: "text", text });
  return { content };
}

const server = new McpServer({
  name: "imagetoolforllm",
  version: "0.1.0",
});

server.registerTool(
  "list_monitors",
  {
    title: "List monitors",
    description: "List all monitors with id, name, geometry, scale factor, and primary flag.",
    inputSchema: {},
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(listMonitors(), null, 2) }],
  }),
);

server.registerTool(
  "list_windows",
  {
    title: "List windows",
    description:
      "List capturable windows (id, app, title, geometry). By default hides empty-title and minimized windows.",
    inputSchema: {
      includeAll: z
        .boolean()
        .optional()
        .describe("Include empty-title and minimized windows (default false)"),
    },
  },
  async ({ includeAll }) => ({
    content: [{ type: "text", text: JSON.stringify(listWindows({ includeAll }), null, 2) }],
  }),
);

server.registerTool(
  "capture_monitor",
  {
    title: "Capture monitor",
    description:
      "Capture a monitor to a PNG file and return its path. Omit id for the primary monitor. (Raw capture; annotation flow is added in a later step.)",
    inputSchema: {
      id: z.number().int().optional().describe("Monitor id from list_monitors; omit for primary"),
    },
  },
  async ({ id }) => {
    const outDir = await ensureOutDir();
    const png = id == null ? await capturePrimaryMonitor() : await captureMonitorById(id);
    const file = path.join(outDir, `${timestampName("monitor")}.png`);
    await writeFile(file, png);
    return { content: [{ type: "text", text: `Saved monitor capture: ${file}` }] };
  },
);

server.registerTool(
  "capture_window",
  {
    title: "Capture window",
    description: "Capture a specific window by id to a PNG file and return its path.",
    inputSchema: {
      id: z.number().int().describe("Window id from list_windows"),
    },
  },
  async ({ id }) => {
    const outDir = await ensureOutDir();
    const png = await captureWindowById(id);
    const file = path.join(outDir, `${timestampName("window")}.png`);
    await writeFile(file, png);
    return { content: [{ type: "text", text: `Saved window capture: ${file}` }] };
  },
);

server.registerTool(
  "capture_and_annotate",
  {
    title: "Capture & annotate",
    description:
      "Capture monitor(s) or a specific window, open a browser annotator to draw labeled regions, then save an annotated PNG + a regions.json legend and return their paths. Defaults to ALL monitors stitched; pass monitor='primary'/an id, or window=<id from list_windows> to annotate one window. This is the main handoff tool.",
    inputSchema: {
      name: z
        .string()
        .optional()
        .describe("Base filename without extension (default: shot-<timestamp>)"),
      monitor: z
        .union([z.literal("all"), z.literal("primary"), z.number().int()])
        .optional()
        .describe("Which monitor(s): 'all' (default, stitched), 'primary', or a monitor id"),
      window: z
        .number()
        .int()
        .optional()
        .describe("Window id from list_windows — annotate this specific window instead of monitors"),
    },
  },
  async ({ name, monitor, window }) => {
    let input: AnnotationInput;
    let source: "region" | "window";
    let width: number;
    let height: number;
    let windowMeta: { title: string; app: string } | undefined;
    let captureDesc: string;

    if (window != null) {
      const w = await captureWindowImage(window);
      source = "window";
      width = w.width;
      height = w.height;
      windowMeta = { title: w.title, app: w.app };
      captureDesc = `window: ${w.app} — ${w.title}`;
      input = {
        layers: [{ png: w.png, x: 0, y: 0, width: w.width, height: w.height }],
        source,
        width,
        height,
        window: windowMeta,
      };
    } else {
      const cap = await captureMonitorLayers(monitor ?? "all");
      source = "region";
      width = cap.width;
      height = cap.height;
      captureDesc = `${cap.layers.length} monitor(s) [${cap.layers.map((l) => l.name).join(", ")}]`;
      input = {
        layers: cap.layers.map((l) => ({ png: l.png, x: l.x, y: l.y, width: l.width, height: l.height })),
        source,
        width,
        height,
      };
    }

    input.defaultTitle = name?.trim() || undefined;
    input.defaultOutDir = config.outDir;
    const result = await runAnnotationSession(input, config.host);
    if (!result) {
      return { content: [{ type: "text", text: "Annotation cancelled — nothing saved." }] };
    }
    const title = result.title || name?.trim() || "";
    const paths = await saveAnnotationResult({
      outDir: result.outDir ? path.resolve(result.outDir) : config.outDir,
      name: title,
      title,
      originalPng: result.originalPng ?? undefined,
      annotatedPng: result.annotatedPng,
      regions: result.regions,
      source,
      width,
      height,
      window: windowMeta,
    });
    return annotationToolResult(title, `${captureDesc}, ${width}x${height}`, paths, result);
  },
);

server.registerTool(
  "reopen_annotation",
  {
    title: "Reopen annotation",
    description:
      "Reopen an existing capture (its *.annotated.png or *.regions.json) in the browser annotator to add/edit/remove labeled regions, then save back to the same files. Existing regions are restored for editing.",
    inputSchema: {
      path: z
        .string()
        .describe("Path to a *.annotated.png, a *.regions.json, or the base name of a saved capture"),
    },
  },
  async ({ path: inPath }) => {
    const dir = path.dirname(inPath);
    const b = path.basename(inPath);
    let base: string;
    if (b.endsWith(".regions.json")) base = b.slice(0, -".regions.json".length);
    else if (b.endsWith(".annotated.png")) base = b.slice(0, -".annotated.png".length);
    else if (b.endsWith(".png")) base = b.slice(0, -".png".length);
    else base = b;

    const regionsPath = path.join(dir, `${base}.regions.json`);
    let sidecar: any;
    try {
      sidecar = JSON.parse(await readFile(regionsPath, "utf8"));
    } catch {
      return { content: [{ type: "text", text: `Could not read sidecar: ${regionsPath}` }] };
    }
    const width: number = sidecar.image?.width;
    const height: number = sidecar.image?.height;
    const originalName: string | null = sidecar.image?.original ?? null;
    if (!originalName) {
      return {
        content: [
          {
            type: "text",
            text: "This capture has no saved clean original (older capture) — cannot reopen without baking boxes in twice. Recapture instead.",
          },
        ],
      };
    }
    // basename() so a crafted sidecar can't point image.original outside `dir`
    const originalPng = await readFile(path.join(dir, path.basename(originalName)));
    const windowMeta = sidecar.window ?? undefined;
    const input: AnnotationInput = {
      layers: [{ png: originalPng, x: 0, y: 0, width, height }],
      source: sidecar.source ?? "region",
      width,
      height,
      window: windowMeta,
      existingRegions: Array.isArray(sidecar.regions) ? sidecar.regions : [],
      defaultTitle: sidecar.title ?? base,
      defaultOutDir: dir,
    };

    const result = await runAnnotationSession(input, config.host);
    if (!result) {
      return { content: [{ type: "text", text: "Reopen cancelled — no changes saved." }] };
    }
    const title = result.title || sidecar.title || base;
    const paths = await saveAnnotationResult({
      outDir: result.outDir ? path.resolve(result.outDir) : dir,
      name: title,
      title,
      originalPng: result.originalPng ?? originalPng,
      annotatedPng: result.annotatedPng,
      regions: result.regions,
      source: sidecar.source ?? "region",
      width,
      height,
      window: windowMeta,
    });
    return annotationToolResult(title, `reopened (${width}x${height})`, paths, result);
  },
);

server.registerTool(
  "receive_shot",
  {
    title: "Receive next captured shot",
    description:
      "Open (if not already) the persistent capture browser and BLOCK until the user sends the next shot with a Send-to-LLM button — the whole annotated image, or a single cropped region. Returns that image inline (so it appears in the chat) plus saved paths and the region legend. Call it again after handling each shot to keep receiving; it returns a 'session ended' note when the user clicks End. Use this for the 'keep the browser open and send many screenshots' workflow.",
    inputSchema: {},
  },
  async () => {
    await ensureSession(config.host, config.outDir);
    const shot = await nextShot();
    if (!shot) {
      return { content: [{ type: "text", text: "Capture session ended — no more shots." }] };
    }
    return annotationToolResult(
      shot.title,
      `${shot.source} (${shot.width}x${shot.height})`,
      shot.paths,
      { regions: shot.regions, previewPng: shot.previewPng },
    );
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[imagetoolforllm] MCP server running on stdio (out: ${config.outDir})`);
}

main().catch((err) => {
  console.error("[imagetoolforllm] fatal:", err);
  process.exit(1);
});
