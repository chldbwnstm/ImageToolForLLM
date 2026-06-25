# ImageToolForLLM

> Capture a screenshot, label regions on it, and hand the image + structured
> references to your LLM coding agent.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
![Status: early / work in progress](https://img.shields.io/badge/status-early%20%7C%20WIP-orange)

**Created by Humblebee — THE BETTER COMPANY AI.**

---

## The problem

Getting a screenshot into an LLM coding agent (Claude Code, Cursor, Copilot, …)
today means: capture → save → find the file → drag it in or paste a path. And
once it's in, the agent only sees pixels — it has no idea that *that box* is the
"Menu" button and *this one* is "Exit".

**ImageToolForLLM** adds the missing layer: **persistent, labeled region
references on top of a screenshot**, so the agent gets visual *and* structured
context in one shot — and you don't have to re-explain what each part of the UI
is every time you reopen the image.

## What makes it different

Existing tools (see [Acknowledgements](#acknowledgements--prior-art)) solve the
*capture → paste* side. ImageToolForLLM adds the **labeled-region reference
layer** on top:

- You draw boxes on the capture and label each one (`1 = Menu`, `2 = Exit`, …).
- It saves a numbered, annotated image **plus** a structured sidecar.
- The sidecar is editable and persistent — it's a shared memory for both you and
  the agent. Reopen the image later and every region comes back.

## Status

🚧 **Early, but the core loop works end-to-end.** Honest state (verified on
real hardware, Windows):

- ✅ **Capture** — monitor, specific window, and **multi-monitor stitched into one
  image**, via a small prebuilt native module, exposed as MCP tools.
- ✅ **Annotate** — browser canvas: draw region boxes, number + label + note each,
  **zoom (Ctrl+wheel) and scroll/pan** for large/multi-monitor captures.
- ✅ **Handoff** — saves `<name>.annotated.png` (numbered boxes burned in) +
  `<name>.regions.json` legend; the `capture_and_annotate` tool returns the paths.
- ✅ **Claude Code integration** — bundled as a plugin (skill + MCP server).
- 🔜 **Planned** — macOS/Linux support, in-image window picker / `/annotate`
  reopen, one-command install, optional global-hotkey helper.

## How it works

The whole thing ships as a single integration (no heavyweight desktop app). The
**capture** is done natively by a small MCP server; the **annotation UI** is a
local web page rendered in your existing browser.

```
  In your LLM coding agent
    │  /capture-region  ·  /capture-window  ·  /annotate <file>
    ▼
  MCP server (Node)
    │  1. native screen / window capture  (node-screenshots)
    │  2. starts a local web server  →  opens the annotator in your browser
    ▼
  Browser canvas
    │  draw region boxes · number + label + note each one · crop
    │  "Send"  →  exports the annotated PNG + region data
    ▼
  MCP server
    │  3. writes  <name>.annotated.png  +  <name>.regions.json
    │  4. returns the paths to the agent
    ▼
  Your agent reads both — visual anchor + structured legend, together.
```

### Handoff format

Two co-located artifacts:

- `<name>.annotated.png` — numbered boxes burned onto the image (the visual anchor)
- `<name>.regions.json` — the legend: coordinates + labels + notes (editable, persistent)

Example sidecar:

```json
{
  "schema": "imagetoolforllm/regions@1",
  "source": "window",
  "image": { "annotated": "login.annotated.png", "width": 960, "height": 600 },
  "bboxFormat": "xywh",
  "regions": [
    { "id": 1, "label": "Menu button", "note": "top-left hamburger", "bbox": [12, 8, 44, 44] },
    { "id": 2, "label": "Exit button", "note": "top-right X",        "bbox": [904, 8, 44, 44] }
  ]
}
```

> `bbox` is `[x, y, width, height]` in pixels, origin top-left (`bboxFormat: "xywh"`).

## Quick start (developer / early)

There's no one-command published install yet. From source:

```bash
git clone https://github.com/chldbwnstm/ImageToolForLLM.git
cd ImageToolForLLM
npm install
npm run build -w server

# sanity checks
npm run poc           -w server   # captures your primary monitor + a window to ./shots
npm run smoke         -w server   # spins up the MCP server and lists/calls tools
npm run smoke:annotate -w server  # headless test of the capture→annotate→save cycle

# manual end-to-end: captures your screen(s), opens the browser annotator
npm run try           -w server
```

### Install from the marketplace

This repo doubles as a Claude Code plugin marketplace:

```bash
/plugin marketplace add chldbwnstm/ImageToolForLLM
/plugin install imagetoolforllm@the-better-company-ai
```

> ⚠️ **Build step required (for now).** Claude Code does not run `npm install`/build on
> plugin install, and the MCP server needs its dependencies (incl. the native
> `node-screenshots`) + a built `server/dist`. After installing, run `npm install` and
> `npm run build -w server` inside the installed plugin directory
> (`~/.claude/plugins/...`). A self-contained, one-command install is on the roadmap.

Or load it straight from a local clone (also needs the build above):

```bash
claude --plugin-dir /abs/path/to/ImageToolForLLM
```

…or register just the MCP server with any MCP-capable agent:

```json
{
  "mcpServers": {
    "imagetoolforllm": {
      "command": "node",
      "args": ["/absolute/path/to/ImageToolForLLM/server/dist/index.js"]
    }
  }
}
```

Tools:
- **`capture_and_annotate`** — the main one. `monitor: "all" | "primary" | <id>`,
  or `window: <id>` to annotate a specific window (pick it from `list_windows`).
- **`reopen_annotation`** — reopen a saved `*.annotated.png` / `*.regions.json` to
  edit its regions, saving back to the same files.
- `list_monitors`, `list_windows`, `capture_monitor`, `capture_window` — building blocks.

The bundled `imagetool-format` skill teaches the agent to read the
`annotated.png` + `regions.json` pair.

## Supported platforms

| Platform        | Region capture | Window capture | Notes |
|-----------------|:--------------:|:--------------:|-------|
| Windows         | ✅ | ✅ | Primary target |
| macOS           | ✅ | ✅ | Needs Screen Recording permission; signing for distribution |
| Linux (X11)     | ✅ | ✅ | |
| Linux (Wayland) | 🟡 | 🔴 | Capture goes through the desktop portal; per-window capture is restricted |

## Roadmap

- [x] Native screen + window capture (MCP tools)
- [x] Multi-monitor capture (stitched)
- [x] Browser region annotator + `annotated.png` / `regions.json` handoff
- [x] Zoom + scroll/pan in the annotator
- [x] Reopen & edit a saved annotation
- [x] Skill that teaches the agent to read the format
- [x] Plugin manifest (skill + MCP server)
- [ ] One-command published install
- [ ] In-browser window-thumbnail picker
- [ ] macOS / Linux (X11) support
- [ ] Optional global-hotkey helper
- [ ] Tool-agnostic export (Cursor / Copilot / any LLM)

---

## Project status & expectations

This is a **personal, best-effort open-source project**, provided as-is, with
**no SLA, no guaranteed support, and no commitment to respond to issues or PRs on
any timeline.** I work on it when I can. Please set expectations accordingly —
and feel free to fork if you need something I'm not building.

## Contributing

Contributions are welcome, with one important note:

> **Contributor License Agreement (CLA):** by submitting a contribution, you
> agree to the terms in [`CLA.md`](./CLA.md), which grant the maintainer the
> rights needed to keep the project's licensing options open (including offering
> the code under other licenses in the future). This is standard for projects
> that may offer a commercial edition later. If you're not comfortable with the
> CLA, you're still very welcome to open issues and discussions.

## Free core vs. Pro (open-core)

The capture + annotation + LLM handoff described above is **free and open
source, forever, under Apache-2.0.** That's the whole product for an individual
working locally.

A separate, **optional** Pro edition may exist later for things whose value
scales with *teams* or removes *workflow friction at scale* — e.g. cross-device
sync, shared team annotation libraries, OCR auto-labeling, annotation history.
Pro (if it ships) would live in a separate repository. **None of it gates the
core.**

> Status: Pro is **not available** and may never ship. Listed here only so the
> boundary is clear from day one.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).

## Acknowledgements / prior art

Earlier tools that tackle the capture→paste side of this workflow (worth a look
if labeled region references aren't what you need):

- [Invoke](https://getinvoke.dev) — screenshot-to-path for terminals
- `ruslanlap/WSL-Screenshot-Paster-for-Claude-Code`
- `BensonLaur/claude-image-paste`

ImageToolForLLM differs by adding the **labeled-region reference layer** on top
of the capture.
