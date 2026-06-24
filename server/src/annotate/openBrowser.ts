import { spawn } from "node:child_process";

/** Open a URL in the user's default browser (Windows / macOS / Linux). */
export function openBrowser(url: string): void {
  let cmd: string;
  let args: string[];
  switch (process.platform) {
    case "win32":
      cmd = "cmd";
      args = ["/c", "start", "", url];
      break;
    case "darwin":
      cmd = "open";
      args = [url];
      break;
    default:
      cmd = "xdg-open";
      args = [url];
      break;
  }
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", (err) => console.error("[imagetoolforllm] openBrowser failed:", err));
  child.unref();
}
