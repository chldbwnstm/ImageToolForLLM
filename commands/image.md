---
description: Open the ImageToolForLLM capture browser and AUTO-receive my screenshots — describe each as it arrives and wait, without acting, until I type an instruction.
allowed-tools: mcp__imagetoolforllm__receive_shot
---

Start an ImageToolForLLM capture session and AUTO-receive my screenshots — describe each,
but do NOT act on them.

Call the `receive_shot` tool now. It opens the capture browser and blocks until I send a
shot (the whole annotated image, or a single cropped region) with a Send-to-LLM button.

When `receive_shot` returns a shot:
1. In ONE short line, confirm what you received AND briefly describe what the image actually
   shows (its visible content), so I can tell which one it is — e.g.
   `Received [ITFL: das] — a chat panel with green Korean text (region 'das')`.
   (You can see the image in the tool result; terminals can't render the pixels, so your
   description is how I recognize it.)
2. Then **immediately call `receive_shot` again** to wait for the next one — AUTOMATICALLY,
   without me having to say "next". Keep auto-receiving and describing each shot in a loop.
3. Do NOT analyze, summarize, translate, write or change code, or take any other action on
   the images. Just keep receiving + describing.

When I want you to actually DO something, I will type an instruction (that interrupts the
wait). Only then act — on the image(s) received so far — and afterwards resume the
auto-receive loop. Stop the loop only when `receive_shot` returns a "session ended" message,
or when I tell you to stop.

**Never act on a received image unless I explicitly type an instruction.** Receiving an
image just means: describe it and immediately wait for the next.
