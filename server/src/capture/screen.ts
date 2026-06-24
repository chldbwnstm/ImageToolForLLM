import { Monitor } from "node-screenshots";

export interface MonitorInfo {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

function toMonitorInfo(m: Monitor): MonitorInfo {
  return {
    id: m.id(),
    name: m.name(),
    x: m.x(),
    y: m.y(),
    width: m.width(),
    height: m.height(),
    scaleFactor: m.scaleFactor(),
    isPrimary: m.isPrimary(),
  };
}

/** List all monitors (geometry, scale, primary flag). */
export function listMonitors(): MonitorInfo[] {
  return Monitor.all().map(toMonitorInfo);
}

/** Capture the primary monitor (or the first one) as a PNG buffer. */
export async function capturePrimaryMonitor(): Promise<Buffer> {
  const monitors = Monitor.all();
  const primary = monitors.find((m) => m.isPrimary()) ?? monitors[0];
  if (!primary) throw new Error("No monitor found");
  const image = await primary.captureImage();
  return image.toPng();
}

/** Capture the primary monitor as a PNG plus its pixel dimensions. */
export async function capturePrimaryMonitorImage(): Promise<{ png: Buffer; width: number; height: number }> {
  const monitors = Monitor.all();
  const primary = monitors.find((m) => m.isPrimary()) ?? monitors[0];
  if (!primary) throw new Error("No monitor found");
  const image = await primary.captureImage();
  return { png: await image.toPng(), width: image.width, height: image.height };
}

export interface MonitorLayer {
  id: number;
  name: string;
  png: Buffer;
  x: number; // offset within the combined virtual-desktop image (px)
  y: number;
  width: number;
  height: number;
}

export interface CombinedCapture {
  layers: MonitorLayer[];
  width: number; // combined bounding-box width
  height: number; // combined bounding-box height
}

/** "all" = every monitor stitched; "primary" = primary only; number = a monitor id. */
export type MonitorSelection = "all" | "primary" | number;

/**
 * Capture one or more monitors as layers positioned within a combined
 * virtual-desktop image. The browser composites the layers onto one canvas, so
 * no server-side image library is needed.
 */
export async function captureMonitorLayers(
  selection: MonitorSelection = "all",
): Promise<CombinedCapture> {
  const all = Monitor.all();
  if (all.length === 0) throw new Error("No monitor found");

  let chosen: Monitor[];
  if (selection === "all") {
    chosen = all;
  } else if (selection === "primary") {
    chosen = [all.find((m) => m.isPrimary()) ?? all[0]];
  } else {
    const m = all.find((mm) => mm.id() === selection);
    if (!m) throw new Error(`Monitor not found: ${selection}`);
    chosen = [m];
  }

  const geos = chosen.map((m) => ({ m, x: m.x(), y: m.y(), w: m.width(), h: m.height() }));
  const minX = Math.min(...geos.map((g) => g.x));
  const minY = Math.min(...geos.map((g) => g.y));
  const width = Math.max(...geos.map((g) => g.x + g.w)) - minX;
  const height = Math.max(...geos.map((g) => g.y + g.h)) - minY;

  const layers: MonitorLayer[] = [];
  for (const g of geos) {
    const image = await g.m.captureImage();
    layers.push({
      id: g.m.id(),
      name: g.m.name(),
      png: await image.toPng(),
      x: g.x - minX,
      y: g.y - minY,
      width: g.w,
      height: g.h,
    });
  }
  return { layers, width, height };
}

/** Capture a specific monitor by id as a PNG buffer. */
export async function captureMonitorById(id: number): Promise<Buffer> {
  const monitor = Monitor.all().find((m) => m.id() === id);
  if (!monitor) throw new Error(`Monitor not found: ${id}`);
  const image = await monitor.captureImage();
  return image.toPng();
}
