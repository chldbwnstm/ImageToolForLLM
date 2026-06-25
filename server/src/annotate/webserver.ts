import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { saveFromPayload } from "../export/saveResult.js";
import { WEBUI_DIR } from "../paths.js";


export interface Region {
  id: number;
  label: string;
  note: string;
  bbox: [number, number, number, number]; // xywh, image pixels
  color?: string;
}

export interface AnnotationLayer {
  png: Buffer;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationInput {
  /** One layer per captured monitor, positioned in the combined image. */
  layers: AnnotationLayer[];
  source: "region" | "window" | "clipboard";
  width: number; // combined canvas width
  height: number; // combined canvas height
  window?: { title: string; app: string };
  existingRegions?: Region[];
  /** Pre-fill for the title field (else the browser uses today's date). */
  defaultTitle?: string;
  /** Pre-fill for the save-folder field (the current output directory). */
  defaultOutDir?: string;
}

export interface SubmitResult {
  title: string;
  /** Folder the user chose in the browser, or null to use the server default. */
  outDir: string | null;
  annotatedPng: Buffer;
  /** Downscaled annotated PNG for inlining into the LLM context; null if absent. */
  previewPng: Buffer | null;
  /** Clean composite (no boxes) for reopen/edit; null if the browser didn't send one. */
  originalPng: Buffer | null;
  regions: Region[];
}

export interface AnnotationServer {
  url: string;
  port: number;
  /** Resolves with the submitted result, or null if the user cancelled. */
  result: Promise<SubmitResult | null>;
  close(): void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
};

/** Start a loopback web server hosting the annotator for a single capture. */
export async function startAnnotationServer(
  input: AnnotationInput,
  host: string,
): Promise<AnnotationServer> {
  let resolveResult!: (r: SubmitResult | null) => void;
  const result = new Promise<SubmitResult | null>((res) => {
    resolveResult = res;
  });

  const server = http.createServer((req, res) => {
    handle(req, res, input, resolveResult).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://${host}:${port}/`,
    port,
    result,
    close() {
      server.close();
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  input: AnnotationInput,
  resolveResult: (r: SubmitResult | null) => void,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    return serveFile(res, path.join(WEBUI_DIR, "index.html"));
  }
  if (req.method === "GET" && (p === "/annotator.js" || p === "/annotator.css")) {
    return serveFile(res, path.join(WEBUI_DIR, p.slice(1)));
  }
  const layerMatch = p.match(/^\/layer\/(\d+)\.png$/);
  if (req.method === "GET" && layerMatch) {
    const layer = input.layers[Number(layerMatch[1])];
    if (!layer) {
      res.writeHead(404);
      res.end("no such layer");
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(layer.png);
    return;
  }
  if (req.method === "GET" && p === "/meta") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        mode: "oneshot",
        multi: false,
        source: input.source,
        width: input.width,
        height: input.height,
        window: input.window ?? null,
        regions: input.existingRegions ?? [],
        defaultTitle: input.defaultTitle ?? null,
        defaultOutDir: input.defaultOutDir ?? null,
        layers: input.layers.map((l, i) => ({
          src: `/layer/${i}.png`,
          x: l.x,
          y: l.y,
          width: l.width,
          height: l.height,
        })),
      }),
    );
    return;
  }
  if (req.method === "POST" && p === "/submit") {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const strip = (s: unknown) => String(s ?? "").replace(/^data:image\/png;base64,/, "");
    const annotatedPng = Buffer.from(strip(data.annotatedPng), "base64");
    const ob64 = strip(data.originalPng);
    const originalPng = ob64 ? Buffer.from(ob64, "base64") : null;
    const pb64 = strip(data.previewPng);
    const previewPng = pb64 ? Buffer.from(pb64, "base64") : null;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    resolveResult({
      title: String(data.title ?? "").trim(),
      outDir: String(data.outDir ?? "").trim() || null,
      annotatedPng,
      previewPng,
      originalPng,
      regions: Array.isArray(data.regions) ? data.regions : [],
    });
    return;
  }
  if (req.method === "POST" && p === "/save") {
    const data = JSON.parse(await readBody(req));
    const { paths } = await saveFromPayload(data, {
      defaultOutDir: input.defaultOutDir ?? process.cwd(),
      source: input.source,
      window: input.window,
      fallbackWidth: input.width,
      fallbackHeight: input.height,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: paths.annotated }));
    return;
  }
  if (req.method === "POST" && p === "/cancel") {
    res.writeHead(200);
    res.end();
    resolveResult(null);
    return;
  }

  res.writeHead(404);
  res.end("not found");
}

async function serveFile(res: ServerResponse, file: string): Promise<void> {
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
