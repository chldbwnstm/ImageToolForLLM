import { openBrowser } from "./openBrowser.js";
import { startAnnotationServer } from "./webserver.js";
import type { AnnotationInput, SubmitResult } from "./webserver.js";

/**
 * Run one annotation session: serve the annotator, open the browser, and wait for
 * the user to submit or cancel. There is NO auto-close timeout — it waits as long
 * as the user needs (the caller can still be interrupted/cancelled). Always tears
 * the server down. Returns the submitted result, or null if the user cancelled.
 */
export async function runAnnotationSession(
  input: AnnotationInput,
  host: string,
): Promise<SubmitResult | null> {
  const server = await startAnnotationServer(input, host);
  console.error(`[imagetoolforllm] annotator ready: ${server.url}`);
  openBrowser(server.url);

  try {
    return await server.result;
  } finally {
    server.close();
  }
}
