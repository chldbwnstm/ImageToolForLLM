import { openBrowser } from "./openBrowser.js";
import { startAnnotationServer } from "./webserver.js";
import type { AnnotationInput, SubmitResult } from "./webserver.js";

/**
 * Run one annotation session: serve the annotator, open the browser, and wait for
 * the user to submit (or cancel / time out). Always tears the server down.
 * Returns the submitted result, or null if cancelled/timed out.
 */
export async function runAnnotationSession(
  input: AnnotationInput,
  host: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<SubmitResult | null> {
  const server = await startAnnotationServer(input, host);
  console.error(`[imagetoolforllm] annotator ready: ${server.url}`);
  openBrowser(server.url);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([server.result, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    server.close();
  }
}
