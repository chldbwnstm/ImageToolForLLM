import { Window } from "node-screenshots";

export interface WindowInfo {
  id: number;
  pid: number;
  appName: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isFocused: boolean;
}

function toWindowInfo(w: Window): WindowInfo {
  return {
    id: w.id(),
    pid: w.pid(),
    appName: w.appName(),
    title: w.title(),
    x: w.x(),
    y: w.y(),
    width: w.width(),
    height: w.height(),
    isMinimized: w.isMinimized(),
    isFocused: w.isFocused(),
  };
}

export interface ListWindowsOptions {
  /** Include windows with empty titles and minimized windows. Default: false. */
  includeAll?: boolean;
}

/**
 * List capturable windows (sorted by z-order). By default filters out
 * empty-title and minimized windows, which are usually not user-meaningful.
 */
export function listWindows(opts: ListWindowsOptions = {}): WindowInfo[] {
  const includeAll = opts.includeAll ?? false;
  return Window.all()
    .map(toWindowInfo)
    .filter((w) => includeAll || (w.title.trim() !== "" && !w.isMinimized));
}

/** Capture a specific window by id as a PNG buffer. */
export async function captureWindowById(id: number): Promise<Buffer> {
  const win = Window.all().find((w) => w.id() === id);
  if (!win) throw new Error(`Window not found: ${id}`);
  const image = await win.captureImage();
  return image.toPng();
}

/** Capture a window by id with its dimensions and title/app metadata. */
export async function captureWindowImage(
  id: number,
): Promise<{ png: Buffer; width: number; height: number; title: string; app: string }> {
  const win = Window.all().find((w) => w.id() === id);
  if (!win) throw new Error(`Window not found: ${id}`);
  const image = await win.captureImage();
  return {
    png: await image.toPng(),
    width: image.width,
    height: image.height,
    title: win.title(),
    app: win.appName(),
  };
}
