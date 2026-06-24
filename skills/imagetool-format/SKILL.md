---
name: imagetool-format
description: Read ImageToolForLLM handoffs — an annotated screenshot plus a region legend. Use whenever you are given or you find a "*.annotated.png" paired with a "*.regions.json", when a regions.json (schema "imagetoolforllm/regions@1") appears, or when the user refers to numbered regions/boxes or labeled UI elements on a screenshot. Explains how to map the numbered boxes drawn on the image to the legend (id, label, note, bbox).
---

# ImageToolForLLM handoff format

ImageToolForLLM lets a user capture a screenshot, draw boxes on regions of
interest, and label each one. It saves a **pair of co-located files** that you
should always read together:

- `<name>.annotated.png` — the screenshot with **numbered, colored boxes burned
  into the image** (the visual anchor).
- `<name>.regions.json` — the **legend**: each box's id, label, note, and
  coordinates. This is the source of truth for what each region means.
- (optional) `<name>.png` — the original, un-annotated capture.

## When you receive one of these

1. If you are given an `*.annotated.png`, **look for the sibling
   `*.regions.json`** (same directory, same base name) and read it too. Reading
   only the image loses the labels; reading only the JSON loses the visual.
2. If you are given a `*.regions.json`, also view the `image.annotated` file it
   points to.

## Legend schema (`imagetoolforllm/regions@1`)

```json
{
  "schema": "imagetoolforllm/regions@1",
  "createdAt": "2026-06-24T10:00:00.000Z",
  "source": "region | window | clipboard",
  "window": { "title": "...", "app": "..." },   // present when source = window, else null
  "image": {
    "annotated": "login.annotated.png",
    "original": "login.png",
    "width": 960,
    "height": 600
  },
  "bboxFormat": "xywh",
  "regions": [
    { "id": 1, "label": "Menu button", "note": "top-left hamburger", "bbox": [12, 8, 44, 44], "color": "#e53935" },
    { "id": 2, "label": "Exit button", "note": "top-right X",        "bbox": [904, 8, 44, 44], "color": "#1e88e5" }
  ]
}
```

## How to interpret it

- Each entry in `regions` corresponds to **one numbered box** in the annotated
  image. The badge number drawn on the image **equals `regions[].id`**, and the
  box color equals `regions[].color`.
- `label` = what that UI element / area **is** (e.g. "Menu button"). This is the
  user's authoritative naming — use it when referring to the element.
- `note` = extra context the user added (optional, may be empty).
- `bbox` = `[x, y, width, height]` in **pixels**, origin **top-left**, in the
  coordinate space of the image (`image.width` × `image.height`). The format is
  always confirmed by `bboxFormat` ("xywh").

## Working guidance

- **Trust the numbered visual anchor + label first.** When you look at the
  image, find box `N`, then read `regions` where `id == N` for its meaning. Use
  `bbox` when you need a precise location (e.g. to describe coordinates or
  relative layout), but the number↔label mapping is the primary signal.
- When the user says **"region 2"**, **"box 3"**, or **"the Exit button"**,
  resolve it through the legend (`id` or `label`) and act on that element.
- When implementing or fixing UI based on the screenshot, refer to elements by
  their `label` so you and the user share the same vocabulary.
- The `*.regions.json` is **human-editable and persistent** — the user may add
  or refine labels/notes over time. Re-read it if it may have changed.
