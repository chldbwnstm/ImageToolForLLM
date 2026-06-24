import path from "node:path";

export interface Config {
  /** Directory where captured/annotated artifacts are written. */
  outDir: string;
  /** Loopback host for the local annotation web server (added in a later step). */
  host: string;
  /** Port for the local annotation web server. 0 = ephemeral (OS-assigned). */
  port: number;
}

/**
 * Resolve runtime config from env, with sensible defaults.
 *   IMAGETOOLFORLLM_OUT  - output dir   (default: <cwd>/shots)
 *   IMAGETOOLFORLLM_PORT - web ui port  (default: 0 / ephemeral)
 */
export function loadConfig(): Config {
  const outDir = process.env.IMAGETOOLFORLLM_OUT
    ? path.resolve(process.env.IMAGETOOLFORLLM_OUT)
    : path.resolve(process.cwd(), "shots");

  return {
    outDir,
    host: "127.0.0.1",
    port: Number(process.env.IMAGETOOLFORLLM_PORT ?? 0),
  };
}
