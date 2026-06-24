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

    const result = await runAnnotationSession(input, config.host);
    if (!result) {
      return {
        content: [{ type: "text", text: "Annotation cancelled or timed out — nothing saved." }],
      };
    }
    const base = name?.trim() ? name.trim() : timestampName("shot");
    const paths = await saveAnnotationResult({
      outDir: config.outDir,
      name: base,
      originalPng: result.originalPng ?? undefined,
      annotatedPng: result.annotatedPng,
      regions: result.regions,
      source,
      width,
      height,
      window: windowMeta,
    });
    const legend =
      result.regions.map((r) => `  [${r.id}] ${r.label}${r.note ? " — " + r.note : ""}`).join("\n") ||
      "  (no regions drawn)";
    return {
      content: [
        {
          type: "text",
          text: `Captured ${captureDesc}, ${width}x${height}.\nSaved:\n  ${paths.annotated}\n  ${paths.sidecar}\n\nRegions:\n${legend}`,
        },
      ],
    };
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
    const originalPng = await readFile(path.join(dir, originalName));
    const windowMeta = sidecar.window ?? undefined;
    const input: AnnotationInput = {
      layers: [{ png: originalPng, x: 0, y: 0, width, height }],
      source: sidecar.source ?? "region",
      width,
      height,
      window: windowMeta,
      existingRegions: Array.isArray(sidecar.regions) ? sidecar.regions : [],
    };

    const result = await runAnnotationSession(input, config.host);
    if (!result) {
      return { content: [{ type: "text", text: "Reopen cancelled — no changes saved." }] };
    }
    const paths = await saveAnnotationResult({
      outDir: dir,
      name: base,
      originalPng: result.originalPng ?? originalPng,
      annotatedPng: result.annotatedPng,
      regions: result.regions,
      source: sidecar.source ?? "region",
      width,
      height,
      window: windowMeta,
    });
    const legend =
      result.regions.map((r) => `  [${r.id}] ${r.label}${r.note ? " — " + r.note : ""}`).join("\n") ||
      "  (no regions)";
    return {
      content: [
        {
          type: "text",
          text: `Reopened & saved:\n  ${paths.annotated}\n  ${paths.sidecar}\n\nRegions:\n${legend}`,
        },
      ],
    };
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
