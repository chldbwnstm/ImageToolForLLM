# ImageToolForLLM

## ⭐ TOP PRIORITY — above everything else

**CROSS-PLATFORM. NO CRASH. WORKING PERFECTLY.**

The single most important rule: the tool must run on **Windows, macOS, and Linux
without crashing**, and every feature must actually work — not just on the dev's
Windows machine.

Concrete rules that follow from this:
- **Every OS-specific code path MUST be guarded** with `process.platform` and have
  a fallback for the other platforms. Never let a Windows-only path (PowerShell,
  `user32.dll`, `PrintWindow`, `ShowWindow`) execute on macOS/Linux — it will crash.
  Same for any macOS-only (`screencapture`, CoreGraphics) or Linux-only path.
- **Prefer the cross-platform path** (`node-screenshots`) as the default/fallback.
  OS-native capture (win32 PrintWindow, mac CGWindowListCreateImage / `screencapture -l`)
  are *enhancements* layered on top, always guarded, with a working fallback.
- **A missing native tool must degrade gracefully**, never throw an unhandled error.
- **Verify before claiming "done"** — do not say it works until:
  - `npm run build -w server` is clean,
  - `npm run smoke:annotate -w server` passes,
  - `node --check webui/annotator.js` passes,
  - and, for capture changes, it was actually run (`npm run serve`/`try`) or smoke-tested headlessly.

If a change can't be made cross-platform safely, it must at minimum be guarded so
other platforms fall back and keep working.

---

## What it is
A Claude Code plugin: capture a screenshot (monitor / specific window / multi-monitor),
draw labeled regions in a browser annotator, and hand image + structured references
to the LLM. Handoff = `<name>.annotated.png` + `<name>.regions.json`
(schema `imagetoolforllm/regions@1`, bbox format **xywh**).

## Stack / layout
- `server/` — MCP server (Node + TypeScript). Ships as one self-contained esbuild
  bundle `dist/index.js` (MCP SDK + zod inlined; `node-screenshots` kept external).
- `webui/` — browser annotator (vanilla JS canvas), served live from disk.
- `skills/imagetool-format/SKILL.md`, `commands/`, `.claude-plugin/plugin.json` — plugin pieces.
- Capture: `node-screenshots` (cross-platform) is the base; native helpers in
  `server/scripts/*.ps1` + `server/src/capture/*.ts`.

## Commands (run from repo root)
- `npm run build -w server` — `tsc --noEmit` typecheck + esbuild bundle into
  `server/dist/index.js` (the committed artifact the plugin runs). `npm run typecheck -w server` for types only.
- `npm run smoke:annotate -w server` — headless cycle test (server + /submit + /save)
- `npm run serve -w server` — persistent capture session (test the browser flow)
- `npm run try -w server` — one-shot capture→annotate→save
- Plugin: `claude --plugin-dir <repo>` then `/image` (or `/imagetoolforllm:image`)

## Cross-platform status (keep this current)
- **Cross-platform (works everywhere):** annotator UI, zoom, regions, title/folder,
  Copy, Send, persistent session, `receive_shot`, `/submit` `/save` `/windows`,
  monitor + window capture via `node-screenshots`.
- **Packaging (one-click, zero build):** the plugin runs the committed esbuild bundle
  (`server/dist/index.js`). `node-screenshots` prebuilt `.node` binaries for Windows x64,
  macOS arm64/x64, and Linux x64-glibc are vendored under `node_modules/` and committed,
  so capture (incl. the Mac/Linux window dropdown) works on install with no `npm install`.
  Rebuild the bundle (`npm run build -w server`) and re-commit `dist/index.js` after server
  src changes. Unbundled arches (Win arm64, Linux musl/arm64) need a matching prebuilt to start.
- **Windows-only (MUST stay guarded, needs mac/linux fallback):**
  - PrintWindow window capture — `server/scripts/capture-window.ps1`, `server/src/capture/printwindow.ts`
    (32-bit, DPI-unaware, 32bpp top-down DIB section, PW_RENDERFULLCONTENT) — captures a
    window's true content even when occluded.
  - Minimize-browser-before-monitor-capture — `capture-desktop.ps1`, `src/capture/desktop.ts`.
  - mac equivalents to add: `screencapture -l <CGWindowID>` / `CGWindowListCreateImage`;
    minimize via AppleScript or window-exclusion.
  - The `/capture` window branch IS guarded: win32 -> PrintWindow, else -> node-screenshots
    window capture (occlusion-capable on macOS). Monitor minimize is win32-only and falls
    back to plain node-screenshots monitor capture off-Windows. Keep any new native path
    guarded the same way.

## Conventions
- macOS capture needs Screen Recording permission (TCC); document/handle it, don't crash.
- Don't commit secrets or screenshots (`shots/`). `node_modules`/`dist` are ignored
  **except** the committed bundle (`server/dist/index.js`) and the vendored
  `node-screenshots` prebuilt binaries — those are intentionally tracked (see `.gitignore`).
- License Apache-2.0; contributions under CLA. Design notes in `program_structure.txt`.
