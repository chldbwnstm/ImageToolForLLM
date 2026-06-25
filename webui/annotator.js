// ImageToolForLLM — browser annotator
// Loads the captured image, lets the user draw + label regions, then POSTs an
// annotated PNG (numbered boxes burned in) + region legend back to the MCP server.

const PALETTE = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa",
                 "#00acc1", "#fdd835", "#d81b60", "#3949ab", "#7cb342"];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const canvasWrap = document.getElementById("canvasWrap");
const titleInput = document.getElementById("titleInput");
const folderInput = document.getElementById("folderInput");

let layers = [];           // { img, x, y, w, h } — one per captured monitor
let regions = [];          // { id, label, note, bbox:[x,y,w,h], color }
let nextId = 1;
let dragging = null;       // { x0, y0, x1, y1 } in image px
let editingId = null;
let submitted = false;
let zoom = 1;              // display scale (image px -> CSS px)
let multi = false;         // session mode: keep open, capture + send repeatedly
const selected = new Set(); // region ids checked for "Save & copy paths"
// single source of truth for what Capture will grab (replaces the two old dropdowns)
let captureSource = { kind: "screen", mode: "all" };

init();

async function init() {
  const meta = await fetch("/meta").then((r) => r.json()).catch(() => ({}));
  multi = !!meta.multi;
  titleInput.value = meta.defaultTitle || defaultDateTitle();
  folderInput.value = meta.defaultOutDir || "";
  if (Array.isArray(meta.regions) && meta.regions.length) {
    regions = meta.regions;
    nextId = Math.max(...regions.map((r) => r.id)) + 1;
  }
  await loadLayers(meta.layers, meta.width, meta.height);
  document.getElementById("cancelBtn").classList.toggle("hidden", multi); // Cancel = one-shot only
  if (multi) {
    document.getElementById("captureControls").classList.remove("hidden");
    renderSourceFace();
  }
}

// Fill the Windows group of the source popover from /windows, preserving selection.
async function populateWindows() {
  const box = document.getElementById("winItems");
  try {
    const wins = await fetch("/windows").then((r) => r.json());
    box.innerHTML = "";
    if (!wins.length) {
      const m = document.createElement("div");
      m.className = "pop-item muted-row";
      m.textContent = "(no other windows open)";
      box.appendChild(m);
      return;
    }
    for (const w of wins) {
      const app = String(w.appName || "").split(/[\\/]/).pop();
      const b = document.createElement("button");
      b.className = "pop-item";
      b.setAttribute("role", "menuitemradio");
      b.dataset.kind = "window";
      b.dataset.id = String(w.id);
      b.title = w.title;
      const dot = document.createElement("span"); dot.className = "dot";
      const t = document.createElement("span"); t.className = "pi-title"; t.textContent = w.title;
      const a = document.createElement("span"); a.className = "pi-app"; a.textContent = app;
      b.append(dot, document.createTextNode("🪟 "), t, document.createTextNode(" · "), a);
      b.onclick = () =>
        selectSource({
          kind: "window", id: w.id, title: w.title, app,
          titleBar: captureSource.kind === "window" ? captureSource.titleBar : false,
        });
      box.appendChild(b);
    }
  } catch {
    box.innerHTML = '<div class="pop-item muted-row">(window list unavailable)</div>';
  }
}

// (Re)load the monitor/window layers onto the canvas and fit.
async function loadLayers(layersMeta, w, h) {
  canvas.width = w || 0;
  canvas.height = h || 0;
  const arr = Array.isArray(layersMeta) ? layersMeta : [];
  layers = await Promise.all(
    arr.map(
      (L) =>
        new Promise((resolve) => {
          const im = new Image();
          const done = () => resolve({ img: im, x: L.x, y: L.y, w: L.width, h: L.height });
          im.onload = done;
          im.onerror = done;
          im.src = L.src;
        }),
    ),
  );
  draw();
  renderList();
  fitZoom();
}

// --- zoom & pan ---
// toImg() already divides by the on-screen size, so it stays correct at any zoom.
function applyZoom() {
  canvas.style.width = Math.round(canvas.width * zoom) + "px";
  canvas.style.height = Math.round(canvas.height * zoom) + "px";
  document.getElementById("zoomLevel").textContent = Math.round(zoom * 100) + "%";
}
function clampZoom(z) { return Math.max(0.05, Math.min(z, 8)); }
// Zoom keeping the point under `anchor` (client coords) fixed; centered if omitted.
function setZoom(z, anchor) {
  z = clampZoom(z);
  const ax = anchor ? anchor.x : canvasWrap.getBoundingClientRect().left + canvasWrap.clientWidth / 2;
  const ay = anchor ? anchor.y : canvasWrap.getBoundingClientRect().top + canvasWrap.clientHeight / 2;
  const before = canvas.getBoundingClientRect();
  const imgX = (ax - before.left) / zoom;
  const imgY = (ay - before.top) / zoom;
  zoom = z;
  applyZoom();
  const after = canvas.getBoundingClientRect();
  canvasWrap.scrollLeft += after.left + imgX * zoom - ax;
  canvasWrap.scrollTop += after.top + imgY * zoom - ay;
}
function fitZoom() {
  const pad = 32; // matches #canvasWrap padding * 2
  const zw = (canvasWrap.clientWidth - pad) / canvas.width;
  const zh = (canvasWrap.clientHeight - pad) / canvas.height;
  zoom = clampZoom(Math.min(zw, zh, 1) || 1);
  applyZoom();
}
document.getElementById("zoomIn").onclick = () => setZoom(zoom * 1.2);
document.getElementById("zoomOut").onclick = () => setZoom(zoom / 1.2);
document.getElementById("zoomFit").onclick = fitZoom;
document.getElementById("zoomLevel").onclick = () => setZoom(1);
canvasWrap.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return; // plain wheel = native scroll/pan
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX, y: e.clientY });
  },
  { passive: false },
);
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey) return;
  if (e.key === "=" || e.key === "+") { e.preventDefault(); setZoom(zoom * 1.2); }
  else if (e.key === "-") { e.preventDefault(); setZoom(zoom / 1.2); }
  else if (e.key === "0") { e.preventDefault(); setZoom(1); }
});

// --- coordinate mapping (CSS-scaled canvas -> image pixels) ---
function toImg(e) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return {
    x: Math.round((e.clientX - r.left) * sx),
    y: Math.round((e.clientY - r.top) * sy),
  };
}

// --- drawing ---
function badgeRadius() { return Math.max(13, Math.round(canvas.width / 110)); }

function draw() {
  // dark backdrop so gaps between differently-sized monitors are clean
  ctx.fillStyle = "#0b0c0e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const L of layers) {
    if (L.img && L.img.complete && L.img.naturalWidth) ctx.drawImage(L.img, L.x, L.y, L.w, L.h);
  }
  const lw = Math.max(2, Math.round(canvas.width / 640));
  for (const reg of regions) drawRegion(reg, lw);
  if (dragging) {
    const [x, y, w, h] = normRect(dragging);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lw;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

function drawRegion(reg, lw) {
  const [x, y, w, h] = reg.bbox;
  ctx.strokeStyle = reg.color;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
  // numbered badge at top-left corner
  const rad = badgeRadius();
  ctx.beginPath();
  ctx.arc(x + rad, y + rad, rad, 0, Math.PI * 2);
  ctx.fillStyle = reg.color;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(rad * 1.3)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(reg.id), x + rad, y + rad + 1);
}

function normRect(d) {
  const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
  return [x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)];
}

// Render layers WITHOUT boxes → a clean composite, saved as the original so the
// capture can be reopened later without boxes being baked in twice.
function renderCleanDataURL() {
  ctx.fillStyle = "#0b0c0e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const L of layers) {
    if (L.img && L.img.complete && L.img.naturalWidth) ctx.drawImage(L.img, L.x, L.y, L.w, L.h);
  }
  const url = canvas.toDataURL("image/png");
  draw(); // restore boxes
  return url;
}

// Default title = today's date/time, YYMMDD_H_M_S (2-digit padded).
function defaultDateTitle() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
}

// Downscale any canvas to a PNG data URL (long edge <= maxEdge) — used for the
// inline LLM preview so large captures don't blow image-size limits.
function downscaleCanvasToDataURL(srcCanvas, maxEdge) {
  const longEdge = Math.max(srcCanvas.width, srcCanvas.height);
  if (longEdge <= maxEdge) return srcCanvas.toDataURL("image/png");
  const s = maxEdge / longEdge;
  const o = document.createElement("canvas");
  o.width = Math.max(1, Math.round(srcCanvas.width * s));
  o.height = Math.max(1, Math.round(srcCanvas.height * s));
  o.getContext("2d").drawImage(srcCanvas, 0, 0, o.width, o.height);
  return o.toDataURL("image/png");
}
function makePreviewDataURL(maxEdge = 1568) {
  return downscaleCanvasToDataURL(canvas, maxEdge);
}

// Crop just one region's pixels (clean, no box) into a fresh canvas.
function cropRegionCanvas(reg) {
  const [bx, by, bw, bh] = reg.bbox;
  const off = document.createElement("canvas");
  off.width = Math.max(1, bw);
  off.height = Math.max(1, bh);
  const octx = off.getContext("2d");
  octx.fillStyle = "#0b0c0e";
  octx.fillRect(0, 0, off.width, off.height);
  for (const L of layers) {
    if (L.img && L.img.complete && L.img.naturalWidth) octx.drawImage(L.img, L.x - bx, L.y - by, L.w, L.h);
  }
  return off;
}

// --- mouse: drag to create, click to edit ---
canvas.addEventListener("mousedown", (e) => {
  const p = toImg(e);
  const hit = regions.find((r) => inside(p, r.bbox));
  if (hit) { openEditor(hit.id); return; }
  dragging = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
});
canvas.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const p = toImg(e);
  dragging.x1 = p.x; dragging.y1 = p.y;
  draw();
});
window.addEventListener("mouseup", () => {
  if (!dragging) return;
  const [x, y, w, h] = normRect(dragging);
  dragging = null;
  if (w < 6 || h < 6) { draw(); return; }   // ignore tiny drags
  const reg = { id: nextId++, label: "", note: "", bbox: [x, y, w, h], color: PALETTE[(nextId - 2) % PALETTE.length] };
  regions.push(reg);
  draw(); renderList();
  openEditor(reg.id);
});

function inside(p, [x, y, w, h]) { return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; }

// --- sidebar list ---
function renderList() {
  const ol = document.getElementById("regionList");
  ol.innerHTML = "";
  for (const id of [...selected]) if (!regions.some((r) => r.id === id)) selected.delete(id);
  document.getElementById("empty").classList.toggle("hidden", regions.length > 0);
  for (const reg of regions) {
    const li = document.createElement("li");
    if (selected.has(reg.id)) li.classList.add("selected");
    li.onclick = () => openEditor(reg.id);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "region-cb";
    cb.checked = selected.has(reg.id);
    cb.title = "Select this region for Copy";
    cb.onclick = (e) => {
      e.stopPropagation();
      if (cb.checked) selected.add(reg.id);
      else selected.delete(reg.id);
      li.classList.toggle("selected", cb.checked);
    };
    const badge = document.createElement("span");
    badge.className = "badge"; badge.style.background = reg.color; badge.textContent = reg.id;
    const meta = document.createElement("div"); meta.className = "meta";
    const lbl = document.createElement("div"); lbl.className = "lbl";
    lbl.textContent = reg.label || "(unlabeled)";
    meta.appendChild(lbl);
    if (reg.note) { const n = document.createElement("div"); n.className = "note"; n.textContent = reg.note; meta.appendChild(n); }
    const send = document.createElement("button");
    send.className = "btn ghost region-send";
    send.textContent = "Send";
    send.title = "Crop & send only this region to the LLM";
    send.onclick = (e) => { e.stopPropagation(); sendRegion(reg); };
    li.append(cb, badge, meta, send);
    ol.appendChild(li);
  }
  // header count + selection bar + select-all state
  document.getElementById("regionCount").textContent = `(${regions.length})`;
  const n = selected.size;
  document.getElementById("selectionBar").classList.toggle("hidden", n === 0);
  document.getElementById("selCount").textContent = `${n} selected`;
  const sa = document.getElementById("selectAll");
  sa.checked = n > 0 && n === regions.length;
  sa.indeterminate = n > 0 && n < regions.length;
}

// --- editor modal ---
function openEditor(id) {
  editingId = id;
  const reg = regions.find((r) => r.id === id);
  document.getElementById("editId").textContent = id;
  document.getElementById("editLabel").value = reg.label;
  document.getElementById("editNote").value = reg.note;
  document.getElementById("editor").classList.remove("hidden");
  document.getElementById("editLabel").focus();
}
function closeEditor() { editingId = null; document.getElementById("editor").classList.add("hidden"); }

document.getElementById("editSave").onclick = () => {
  const reg = regions.find((r) => r.id === editingId);
  reg.label = document.getElementById("editLabel").value.trim();
  reg.note = document.getElementById("editNote").value.trim();
  closeEditor(); draw(); renderList();
};
document.getElementById("editCancel").onclick = closeEditor;
document.getElementById("editDelete").onclick = () => {
  regions = regions.filter((r) => r.id !== editingId);
  closeEditor(); draw(); renderList();
};
document.getElementById("editLabel").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("editSave").click();
});

// --- send / cancel ---
// One submission ends the session (the server returns to the agent and closes).
async function submit(payload, successMsg) {
  if (!multi && submitted) return; // one-shot: lock after first send
  if (!multi) submitted = true;
  payload.outDir = (folderInput.value || "").trim();
  try {
    await fetch("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    toast(successMsg + (multi ? "  Capture or send more." : "  You can close this tab."));
  } catch (e) {
    if (!multi) submitted = false;
    toast("Failed to send: " + e);
  }
}

function baseTitle() {
  return (titleInput.value || "").trim() || defaultDateTitle();
}

// Whole annotated image + all regions.
document.getElementById("sendBtn").onclick = () => {
  draw(); // ensure boxes are on the canvas before exporting the annotated image
  submit(
    {
      title: baseTitle(),
      annotatedPng: canvas.toDataURL("image/png"),
      previewPng: makePreviewDataURL(1568),
      originalPng: renderCleanDataURL(),
      regions,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
    },
    "Sent to LLM ✓",
  );
};

// Crop just this region's pixels and send only that.
function sendRegion(reg) {
  const off = cropRegionCanvas(reg);
  const cropUrl = off.toDataURL("image/png"); // clean crop = annotated = original (no box)
  submit(
    {
      title: `${baseTitle()}_${reg.label || "region-" + reg.id}`,
      annotatedPng: cropUrl,
      previewPng: downscaleCanvasToDataURL(off, 1568),
      originalPng: cropUrl,
      regions: [{ id: reg.id, label: reg.label, note: reg.note, bbox: [0, 0, off.width, off.height], color: reg.color }],
      imageWidth: off.width,
      imageHeight: off.height,
    },
    `Sent region [${reg.id}] ${reg.label || ""} ✓`,
  );
}

// --- Copy paths: save selected region(s) (or whole image) and copy their file paths ---
async function saveOne(payload) {
  payload.outDir = (folderInput.value || "").trim();
  const r = await fetch("/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => res.json());
  return r.path;
}

function wholeSavePayload() {
  draw();
  return {
    title: baseTitle(),
    annotatedPng: canvas.toDataURL("image/png"),
    originalPng: renderCleanDataURL(),
    regions,
    imageWidth: canvas.width,
    imageHeight: canvas.height,
  };
}

function regionSavePayload(reg) {
  const off = cropRegionCanvas(reg);
  const url = off.toDataURL("image/png");
  return {
    title: `${baseTitle()}_${reg.label || "region-" + reg.id}`,
    annotatedPng: url,
    originalPng: url,
    regions: [{ id: reg.id, label: reg.label, note: reg.note, bbox: [0, 0, off.width, off.height], color: reg.color }],
    imageWidth: off.width,
    imageHeight: off.height,
  };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
  }
}

// whole=true → always the whole image (the red COPY button); else → checked regions.
async function copyPaths(whole) {
  try {
    const chosen = whole ? [] : regions.filter((r) => selected.has(r.id));
    const payloads = chosen.length ? chosen.map(regionSavePayload) : [wholeSavePayload()];
    const paths = [];
    for (const pl of payloads) paths.push(await saveOne(pl));
    await copyToClipboard(paths.join("\n"));
    toast(`Copied ${paths.length} path(s) to clipboard.${chosen.length ? "" : " (whole image)"}`);
  } catch (e) {
    toast("Copy failed: " + e);
  }
}
document.getElementById("copyBtn").onclick = () => copyPaths(false);
document.getElementById("cancelBtn").onclick = async () => {
  await fetch("/cancel", { method: "POST" }).catch(() => {});
  toast("Cancelled. You can close this tab.");
};

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.remove("hidden");
}

// --- capture source picker (ONE control: screens + windows + title bar) ---
const sourceBtn = document.getElementById("sourceBtn");
const sourceMenu = document.getElementById("sourceMenu");

function renderSourceFace() {
  const icon = sourceBtn.querySelector(".source-icon");
  const face = sourceBtn.querySelector(".source-face");
  if (captureSource.kind === "window") {
    icon.textContent = "🪟";
    face.textContent = `${captureSource.title} — ${captureSource.app}`;
    sourceBtn.title = captureSource.title;
  } else {
    icon.textContent = "🖥";
    face.textContent = captureSource.mode === "primary" ? "Primary only" : "All monitors";
    sourceBtn.removeAttribute("title");
  }
}
function markSelectedRows() {
  for (const el of sourceMenu.querySelectorAll(".pop-item")) {
    let on = false;
    if (el.dataset.kind === "screen") on = captureSource.kind === "screen" && captureSource.mode === el.dataset.mode;
    else if (el.dataset.kind === "window") on = captureSource.kind === "window" && captureSource.id === Number(el.dataset.id);
    el.classList.toggle("is-selected", on);
    if (el.getAttribute("role")) el.setAttribute("aria-checked", on ? "true" : "false");
  }
}
function updateTitleBarRow() {
  const row = document.getElementById("titleBarRow");
  row.classList.toggle("hidden", captureSource.kind !== "window");
  if (captureSource.kind === "window") document.getElementById("titleBarChk").checked = !!captureSource.titleBar;
}
function openSourceMenu() {
  sourceMenu.classList.remove("hidden");
  sourceBtn.setAttribute("aria-expanded", "true");
  updateTitleBarRow();
  markSelectedRows();
  populateWindows().then(markSelectedRows);
}
function closeSourceMenu() {
  sourceMenu.classList.add("hidden");
  sourceBtn.setAttribute("aria-expanded", "false");
}
function selectSource(src) {
  captureSource = src;
  renderSourceFace();
  updateTitleBarRow();
  markSelectedRows();
  closeSourceMenu();
}
sourceBtn.onclick = (e) => {
  e.stopPropagation();
  if (sourceMenu.classList.contains("hidden")) openSourceMenu();
  else closeSourceMenu();
};
for (const el of sourceMenu.querySelectorAll('.pop-item[data-kind="screen"]')) {
  el.onclick = () => selectSource({ kind: "screen", mode: el.dataset.mode });
}
document.getElementById("winRefresh").onclick = (e) => { e.stopPropagation(); populateWindows().then(markSelectedRows); };
document.getElementById("titleBarChk").onchange = (e) => {
  if (captureSource.kind === "window") captureSource.titleBar = e.target.checked;
};
sourceMenu.addEventListener("click", (e) => e.stopPropagation()); // clicks inside don't dismiss
document.addEventListener("click", closeSourceMenu);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSourceMenu(); });

// --- capture / end (session only) ---
document.getElementById("captureBtn").onclick = async () => {
  const body = captureSource.kind === "window"
    ? { window: captureSource.id, includeTitleBar: !!captureSource.titleBar }
    : { mode: captureSource.mode };
  try {
    const resp = await fetch("/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (!resp || !Array.isArray(resp.layers) || !resp.layers.length) throw new Error("empty capture");
    regions = []; nextId = 1; submitted = false; selected.clear();
    titleInput.value = defaultDateTitle();
    await loadLayers(resp.layers, resp.width, resp.height);
    toast(captureSource.kind === "window"
      ? `Captured ${captureSource.title} — annotate, then Send.`
      : "Captured — annotate, then Send.");
  } catch {
    toast("Capture failed — the window may have closed. Pick a source again.");
    openSourceMenu();
  }
};
document.getElementById("endBtn").onclick = async () => {
  await fetch("/end", { method: "POST" }).catch(() => {});
  toast("Session ended. You can close this tab.");
};

// --- sidebar: select-all, clear selection, output toggle, whole-image copy ---
document.getElementById("selectAll").onclick = (e) => {
  selected.clear();
  if (e.target.checked) for (const r of regions) selected.add(r.id);
  renderList();
};
document.getElementById("selClear").onclick = () => { selected.clear(); renderList(); };
document.getElementById("copyWholeBtn").onclick = () => copyPaths(true);
