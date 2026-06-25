import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { WEBUI_DIR } from "../paths.js";
import path from "node:path";
import { openBrowser } from "./openBrowser.js";
import { captureMonitorLayers } from "../capture/screen.js";
import { listWindows, captureWindowImage } from "../capture/window.js";
import { captureDesktopMinimizingAnnotator } from "../capture/desktop.js";
import { capturePrintWindow } from "../capture/printwindow.js";
import { saveAnnotationResult, saveFromPayload } from "../export/saveResult.js";
import type { Region } from "./webserver.js";

// A persistent annotator session: one server + one browser tab that the user
// keeps open, re-capturing with the [Capture] button and sending (whole image
// or a single region) as many times as they like. Each Send saves to disk AND
// is delivered to a waiting `receive_shot` MCP call so it lands in the chat.

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
};

interface Layer {
  png: Buffer;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Shot {
  title: string;
  regions: Region[];
  previewPng: Buffer | null;
  width: number;
  height: number;
  source: string;
  paths: { annotated: string; sidecar: string; original: string | null };
}

interface Session {
  server: http.Server;
  url: string;
  layers: Layer[];
  width: number;
  height: number;
  source: string;
  window?: { title: string; app: string };
  queue: Shot[];
  waiters: Array<() => void>; // notify-only; each re-reads the queue (no shot lost on cancel)
  ended: boolean;
  defaultOutDir: string;
  captureSeq: number; // bumped each /capture so the browser never caches a stale layer
}

let session: Session | null = null;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
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

async function doCapture(
  body: { mode?: "all" | "primary" | number; window?: number; includeTitleBar?: boolean } | null,
): Promise<{ layers: Layer[]; width: number; height: number; source: string; window?: { title: string; app: string } }> {
  if (body && body.window != null) {
    const hwnd = Number(body.window);
    // Windows: PrintWindow (ImageTool replica) — gets the window even if occluded.
    // macOS/Linux: fall back to node-screenshots (CGWindowListCreateImage on macOS is
    // likewise occlusion-capable) so this never crashes off-Windows.
    let cap: { png: Buffer; width: number; height: number };
    if (process.platform === "win32") {
      cap = await capturePrintWindow(hwnd, !!body.includeTitleBar);
    } else {
      const w = await captureWindowImage(hwnd);
      cap = { png: w.png, width: w.width, height: w.height };
    }
    const info = listWindows({ includeAll: true }).find((w) => w.id === hwnd);
    return {
      layers: [{ png: cap.png, x: 0, y: 0, width: cap.width, height: cap.height }],
      width: cap.width,
      height: cap.height,
      source: "window",
      window: info ? { title: info.title, app: info.appName } : undefined,
    };
  }
  const sel = body && body.mode != null ? body.mode : "all";
  // Windows: minimize the annotator browser (if foreground) so it isn't in the shot.
  if (process.platform === "win32" && (sel === "all" || sel === "primary")) {
    const d = await captureDesktopMinimizingAnnotator(sel);
    return {
      layers: [{ png: d.png, x: 0, y: 0, width: d.width, height: d.height }],
      width: d.width,
      height: d.height,
      source: "region",
    };
  }
  const cap = await captureMonitorLayers(sel);
  return {
    layers: cap.layers.map((l) => ({ png: l.png, x: l.x, y: l.y, width: l.width, height: l.height })),
    width: cap.width,
    height: cap.height,
    source: "region",
  };
}

function deliver(s: Session, shot: Shot): void {
  s.queue.push(shot); // queue first so a cancelled/interrupted receive_shot never drops it
  const w = s.waiters.shift();
  if (w) w();
}

function layersMeta(s: Session) {
  return s.layers.map((l, i) => ({ src: `/layer/${i}.png`, x: l.x, y: l.y, width: l.width, height: l.height }));
}

async function handle(req: IncomingMessage, res: ServerResponse, s: Session): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    return serveFile(res, path.join(WEBUI_DIR, "index.html"));
  }
  if (req.method === "GET" && (p === "/annotator.js" || p === "/annotator.css")) {
    return serveFile(res, path.join(WEBUI_DIR, p.slice(1)));
  }
  const lm = p.match(/^\/layer\/(\d+)\.png$/);
  if (req.method === "GET" && lm) {
    const L = s.layers[Number(lm[1])];
    if (!L) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(L.png);
    return;
  }
  if (req.method === "GET" && p === "/meta") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        mode: "session",
        multi: true,
        defaultOutDir: s.defaultOutDir,
        defaultTitle: null,
        source: s.source,
        window: s.window ?? null,
        width: s.width,
        height: s.height,
        regions: [],
        layers: layersMeta(s),
      }),
    );
    return;
  }
  if (req.method === "GET" && p === "/windows") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(listWindows()));
    return;
  }
  if (req.method === "POST" && p === "/capture") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cap = await doCapture(body);
    s.layers = cap.layers;
    s.width = cap.width;
    s.height = cap.height;
    s.source = cap.source;
    s.window = cap.window;
    s.captureSeq += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        source: cap.source,
        window: cap.window ?? null,
        width: cap.width,
        height: cap.height,
        // unique cache-bust per capture so the browser re-fetches the new layer images
        layers: cap.layers.map((l, i) => ({ src: `/layer/${i}.png?n=${s.captureSeq}-${i}`, x: l.x, y: l.y, width: l.width, height: l.height })),
      }),
    );
    return;
  }
  if (req.method === "POST" && p === "/submit") {
    const data = JSON.parse(await readBody(req));
    const strip = (x: unknown) => String(x ?? "").replace(/^data:image\/png;base64,/, "");
    const annotatedPng = Buffer.from(strip(data.annotatedPng), "base64");
    const ob = strip(data.originalPng);
    const originalPng = ob ? Buffer.from(ob, "base64") : null;
    const pb = strip(data.previewPng);
    const previewPng = pb ? Buffer.from(pb, "base64") : null;
    const title = String(data.title ?? "").trim();
    const outDir = String(data.outDir ?? "").trim();
    const regions: Region[] = Array.isArray(data.regions) ? data.regions : [];
    const width = Number(data.imageWidth) || s.width;
    const height = Number(data.imageHeight) || s.height;

    const paths = await saveAnnotationResult({
      outDir: outDir ? path.resolve(outDir) : s.defaultOutDir,
      name: title,
      title,
      originalPng: originalPng ?? undefined,
      annotatedPng,
      regions,
      source: s.source,
      width,
      height,
      window: s.window,
    });

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, annotated: paths.annotated }));
    deliver(s, {
      title: title || path.basename(paths.annotated),
      regions,
      previewPng,
      width,
      height,
      source: s.source,
      paths,
    });
    return;
  }
  if (req.method === "POST" && p === "/save") {
    const data = JSON.parse(await readBody(req));
    const { paths } = await saveFromPayload(data, {
      defaultOutDir: s.defaultOutDir,
      source: s.source,
      window: s.window,
      fallbackWidth: s.width,
      fallbackHeight: s.height,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: paths.annotated }));
    return;
  }
  if (req.method === "POST" && p === "/end") {
    res.writeHead(200);
    res.end();
    s.ended = true;
    const ws = s.waiters.splice(0);
    for (const w of ws) w();
    return;
  }

  res.writeHead(404);
  res.end("not found");
}

/** Ensure the persistent session server + browser are open; capture once initially. */
export async function ensureSession(host: string, defaultOutDir: string): Promise<{ url: string }> {
  if (session && !session.ended) return { url: session.url };

  const initial = await doCapture({ mode: "all" });
  const s: Session = {
    server: undefined as unknown as http.Server,
    url: "",
    layers: initial.layers,
    width: initial.width,
    height: initial.height,
    source: initial.source,
    window: initial.window,
    queue: [],
    waiters: [],
    ended: false,
    defaultOutDir,
    captureSeq: 0,
  };
  const server = http.createServer((req, res) => {
    handle(req, res, s).catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise<void>((r) => server.listen(0, host, r));
  s.server = server;
  const addr = server.address();
  s.url = `http://${host}:${typeof addr === "object" && addr ? addr.port : 0}/`;
  session = s;
  console.error(`[imagetoolforllm] capture session open: ${s.url}`);
  openBrowser(s.url);
  return { url: s.url };
}

/** Wait for the next shot the user sends, or null if the session ended. */
export function nextShot(): Promise<Shot | null> {
  const s = session;
  if (!s) return Promise.resolve(null);
  if (s.queue.length) return Promise.resolve(s.queue.shift()!);
  if (s.ended) return Promise.resolve(null);
  return new Promise((resolve) => {
    s.waiters.push(() => resolve(s.queue.length ? s.queue.shift()! : null));
  });
}

/** Tear the session down. */
export function endSession(): void {
  if (!session) return;
  session.ended = true;
  const ws = session.waiters.splice(0);
  for (const w of ws) w();
  try {
    session.server.close();
  } catch {
    /* ignore */
  }
  session = null;
}
