// ImageToolForLLM — browser annotator
// Loads the captured image, lets the user draw + label regions, then POSTs an
// annotated PNG (numbered boxes burned in) + region legend back to the MCP server.

const PALETTE = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa",
                 "#00acc1", "#fdd835", "#d81b60", "#3949ab", "#7cb342"];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const canvasWrap = document.getElementById("canvasWrap");

let layers = [];           // { img, x, y, w, h } — one per captured monitor
let regions = [];          // { id, label, note, bbox:[x,y,w,h], color }
let nextId = 1;
let dragging = null;       // { x0, y0, x1, y1 } in image px
let editingId = null;
let submitted = false;
let zoom = 1;              // display scale (image px -> CSS px)

init();

async function init() {
  const meta = await fetch("/meta").then((r) => r.json()).catch(() => ({}));
  canvas.width = meta.width || 0;
  canvas.height = meta.height || 0;
  if (Array.isArray(meta.regions) && meta.regions.length) {
    regions = meta.regions;
    nextId = Math.max(...regions.map((r) => r.id)) + 1;
  }
  const metaLayers = Array.isArray(meta.layers) ? meta.layers : [];
  layers = await Promise.all(
    metaLayers.map(
      (L) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve({ img: im, x: L.x, y: L.y, w: L.width, h: L.height });
          im.onerror = () => resolve({ img: im, x: L.x, y: L.y, w: L.width, h: L.height });
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
  document.getElementById("empty").classList.toggle("hidden", regions.length > 0);
  for (const reg of regions) {
    const li = document.createElement("li");
    li.onclick = () => openEditor(reg.id);
    const badge = document.createElement("span");
    badge.className = "badge"; badge.style.background = reg.color; badge.textContent = reg.id;
    const meta = document.createElement("div"); meta.className = "meta";
    const lbl = document.createElement("div"); lbl.className = "lbl";
    lbl.textContent = reg.label || "(unlabeled)";
    meta.appendChild(lbl);
    if (reg.note) { const n = document.createElement("div"); n.className = "note"; n.textContent = reg.note; meta.appendChild(n); }
    li.append(badge, meta);
    ol.appendChild(li);
  }
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
document.getElementById("sendBtn").onclick = async () => {
  if (submitted) return;
  submitted = true;
  draw(); // ensure boxes are on the canvas before exporting the annotated image
  const annotatedPng = canvas.toDataURL("image/png");
  const originalPng = renderCleanDataURL();
  try {
    await fetch("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotatedPng, originalPng, regions, imageWidth: canvas.width, imageHeight: canvas.height }),
    });
    toast("Sent to LLM ✓  You can close this tab.");
  } catch (e) {
    submitted = false;
    toast("Failed to send: " + e);
  }
};
document.getElementById("cancelBtn").onclick = async () => {
  await fetch("/cancel", { method: "POST" }).catch(() => {});
  toast("Cancelled. You can close this tab.");
};

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.remove("hidden");
}
