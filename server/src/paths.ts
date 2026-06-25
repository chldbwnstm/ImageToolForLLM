import { fileURLToPath } from "node:url";

// Resolve bundled assets relative to this module's location. Calibrated so it
// works for ALL of: tsx (this file at server/src/), tsc output (server/dist/),
// and the esbuild single-file bundle (server/dist/index.js) — every one of those
// is exactly TWO levels below the repo root, so `../../webui` and `../scripts`
// (server/scripts) resolve correctly in each case.
export const WEBUI_DIR = fileURLToPath(new URL("../../webui", import.meta.url));
export const SCRIPTS_DIR = fileURLToPath(new URL("../scripts", import.meta.url));
