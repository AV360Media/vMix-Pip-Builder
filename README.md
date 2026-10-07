# vMix PIP Builder

Design the art that sits behind and in front of vMix source layers, export pixel-exact transparent PNGs, and get the vMix layer values and API commands for every slot.

- **Production:** https://bryanchorton.github.io/vMix-Pip-Builder/
- **Test build:** https://bryanchorton.github.io/vMix-Pip-Builder/index.test.html

(Both work once GitHub Pages is on: Settings > Pages > Source: GitHub Actions.) You can also download `index.html` and open it in Chrome or Edge; it is one file, works offline and has no dependencies.

| File | What it is |
|---|---|
| `index.html` | Production app. Changes only when the test build is promoted. |
| `index.test.html` | Test build of `src/`. Every edit lands here first. Shows a red TEST BUILD tag and keeps its own autosave and presets. |
| `src/` | Source: `index.html` (markup and CSS) and `js/*.js`. |
| `vmix-relay.js` | Optional Node helper (no packages). Needed only for confirmed sends, a vMix password, or reading values back. |

## Test and production

1. Edit files in `src/`, then run `npm run build`. That rewrites `index.test.html`. Commit both.
2. `npm test` checks the test build: render engine, exported PNGs and ZIPs pixel by pixel, vMix values, and the page itself in Chromium (needs `npm install --no-save playwright` once). GitHub runs the same checks on every push.
3. When the test build is right, say **"Promote to production"** to Claude. It runs `npm run promote`, which re-runs every check and copies `index.test.html` over `index.html` only if all pass, then commits and pushes to `main`. If anything fails, nothing is promoted and you get the list of failures.

`npm run dev` rebuilds on every save.

## Quick start


1. Open `index.html`. Pick a canvas size at the top. The exact pixel size is always shown next to it.
2. Click **Layouts…** (or press **T**) for a layout preset, or draw with the shape tools on the left. Background, sample frame, grid and safe areas are under **View**.
3. Name each slot and set its source on the **vMix** tab: source input, source aspect, and Fit or Fill.
4. Click **Export Pack**. You get a ZIP with:
   - `*_backplate.png`
   - `*_frontmask.png`
   - `*_preview.png`
   - `*_project.json`
   - `vMix_setup.txt`
   - `alpha_test.png`

**New** in the top bar starts a blank project at the same canvas size, keeping your vMix connection settings. Undo brings the previous project back.

Everything autosaves in the browser after each change. Use **Save** (Ctrl+S) for anything you want to keep.

## Build the input in vMix

`vMix_setup.txt` in each pack has these steps filled in with your names and values.

1. Copy the PNGs to a fixed folder on the vMix machine.
2. Check **Settings > Display**. The preset resolution must match the **Output W/H** on the vMix tab, which defaults to the canvas size.
3. **Add Input > Image >** `*_backplate.png`. Rename it to match the app's "Back plate input" name (default `PIP Back Plate`).
4. **Add Input > Image >** `*_frontmask.png`. Rename it to match "Front mask input" (default `PIP Front Mask`).
5. On both image inputs, leave **Colour Adjust > Premultiplied Alpha** unticked.
6. Open the back plate input's settings and go to **Layers**:
   - Slots go on layers 1..N, in slot-number order unless you set a layer per slot.
   - The front mask goes on the highest layer used, which is N+1 unless you set it.
7. Position the layers:
   - Run the commands with **Send all** in the app, or paste them into a browser or Companion.
   - Or type each layer's Zoom, Pan and Crop into its **Edit > Position** tab.
   - Leave the front mask layer at Zoom 1, Pan 0 and no crop.

Layer order in vMix: layer 10 draws over layer 9, and so on. The input's own image, the back plate, is under every layer. A single input holds at most 10 layers, so the limit is 9 sources plus the front mask. The app flags anything over that.

## Cropping a source

Select a slot and press **C** (or **Crop on canvas** in the Crop section of the Object tab).
- Drag the orange edges to trim the picture. The whole source shows faintly around the box so you can see what you're cutting.
- Drag inside the box to slide the picture under it.
- Press Enter or Esc when done.

The picture keeps its size and position while you crop, so the box shrinks to what's left. You can also type Left / Right / Top / Bottom percentages of the whole source. **Remove crop** grows the box back to the whole picture. The crop goes to vMix in the layer's Crop values, so nothing else changes on the vMix side.

## The three exports

- **Back plate** sits under the sources. It holds fills, drop shadows, outer glow and decorations on the back plane.
  - **Knockout** cuts a clean, fully transparent hole where the source sits.
  - **Shadow only** keeps just the shadows and glow.
- **Front mask** sits over the sources.
  - Each slot gets a transparent window in its exact shape.
  - The area around the window can be:
    - **Back plate art** (default): copies the back plate into the video area outside each window. This is what rounds the video's square corners.
    - **Solid colour**: covers only the video areas, or the whole canvas.
    - **None**: no surround.
  - Slot borders, slot inner shadows, the optional inner edge highlight, and decorations on the front plane are drawn here, over the video.
  - Anything moved into the mask is left out of the back plate, so nothing is drawn twice.
- **Preview** is a flattened reference only. It shows the back plate, then test cards (or your sample frame or camera) placed at the exact vMix positions the app calculated, then the front mask.

## What a PNG can and can't do

- **Rounded video corners need opaque art behind the corners.** The front mask can only hide a corner by painting over it.
  - If the PIP floats over live program with nothing behind it, a PNG can't round it. Use vMix's own layer **Border** with a radius for that case.
  - The app checks every slot and warns when the back plate is transparent behind its corners. The "Single PIP corner" template is that case.
- **A shadow can't fall across another source.** The back plate is under all of them. The app warns when slots overlap.
- **Inner shadows and edge highlights on the video** only work from the front mask. Keep "Slot inner shadows in the front mask" on.
- **Feathering a video edge** only works into an opaque surround. vMix layers can't use a PNG as an alpha matte.

## vMix values: conventions and assumptions

These come from the vMix Shortcut Function Reference and the Layer Designer help:

| Function | Value | Meaning |
|---|---|---|
| `SetLayer` | `Index,Input` | Puts an input on a layer |
| `SetLayerNZoom` | 0 to 5 | 1 = 100% |
| `SetLayerNPanX` | -2 to 2 | 0 = centred, 2 = one full frame width to the right |
| `SetLayerNPanY` | -2 to 2 | 0 = centred, **+2 = one full frame height up** |
| `SetLayerNCrop` | `X1,Y1,X2,Y2`, each 0 to 1 | X1/Y1: 0 = no crop. **X2/Y2: 1 = no crop** (they are edge positions, not amounts) |
| `SetLayerNRectangle` | `X,Y,W,H` | Pixels in the vMix preset resolution |
| `LayerOn` | `Value=Index` | Turns the layer on |

From those, the app calculates each slot like this:
- **Zoom** = slot width ÷ fitted source width.
- **PanX** = (2 × centre x − output width) ÷ output width.
- **PanY** = (output height − 2 × centre y) ÷ output height.
- **Fill mode** crops the overflow evenly on both sides.
- **Fit mode** never crops and letterboxes inside the slot.

Zoom, pan and crop don't depend on the output resolution. The Rectangle values are in output pixels, so set Output W/H to the vMix preset resolution even when the canvas is bigger, for example designing at 4K for a 1080p show.

Three behaviours aren't fully pinned down in the docs. The app assumes:
1. Cropping hides part of the source without re-centring it. The help says crop adjusts "the visible area of the input within its borders".
2. A source that isn't 16:9 is fitted inside the frame at Zoom 1, not stretched.
3. Rectangle describes the uncropped layer, with X/Y as the top-left corner.

To confirm all three on your machine in under a minute, run the relay, **Send all**, then **Read back**. The app shows ✓ or ✗ for each value vMix reports. The default method is Zoom + Pan + Crop, which doesn't depend on assumption 3.

## PNG alpha: what was tested

- **The browser's own canvas export isn't safe for soft shadows.** I drew a 120 px #3d9bff glow on a transparent canvas and exported it with Chrome's `canvas.toBlob()`. Pixels with alpha 1–16 came out with an average colour error of 47/255 and a maximum of 100/255. This is the fringe and colour-shift problem.
- **This app's encoder:** the same glow came out with **0** error on every pixel.
  - It renders in 32-bit float, converts to straight alpha at the end, and writes the PNG itself.
  - The files are 8-bit RGBA with no gamma, sRGB or ICC chunks, so nothing reinterprets the values.
- **Dithering** uses stochastic rounding. Gradients and shadow falloff don't band, exact colours stay exact, and flat areas get no noise.
- **Edge padding:** fully transparent pixels carry the colour of the nearest visible pixel, not black. If vMix scales the image, filtering can't pull in a dark edge.
- **vMix itself:** vMix image inputs expect straight-alpha PNGs, and **Premultiplied Alpha** in Colour Adjust must stay off.
  - With it on, soft edges brighten and halo.
  - I couldn't run vMix here or open its forum threads, so this is the setting to check, not a measured result.
  - To check it yourself, load `alpha_test.png` from any pack over a mid-grey colour input. The white ramp should fade smoothly to nothing, with no bright or dark lip at the faint end.

Automated checks run on every test pack (1280×720, 1920×1080 and 3840×2160, plus a 4K canvas with 1080p output). All passed:
- Each PNG is the exact canvas size.
- Back plate pixels just inside each slot edge are alpha 0.
- Border pixels start at the first pixel outside the slot edge, in the exact border colour.
- Front mask corner pixels match the back plate exactly.
- Shadow-only pixels have zero RGB error, including about 230,000 pixels at alpha 1–8.
- The Zoom, Pan and Crop numbers printed in `vMix_setup.txt` land on the slot rectangle to within 0.001 px. Tested for 16:9, 4:3, 9:16 and 2.39:1 sources, in both Fill and Fit.

## Send to vMix

- **Direct** (default) fires the GET commands straight from the page. Tested working from a file against localhost.
  - vMix sends no CORS headers, so the page can't see whether a command worked.
  - Chrome may block calls to LAN addresses from a file.
  - It can't send a Web Controller password.
- **Relay helper** (`node vmix-relay.js`, then vMix tab > Send via > Relay helper):
  - confirms each command
  - supports the Web Controller user and password (the password is never saved to the project)
  - enables **Read back**
  - Listens on 127.0.0.1:8089. It forwards only to `/api/` on 127.0.0.1/localhost unless you add `--allow-host 10.0.0.20` for a remote vMix machine. It refuses requests from web pages other than local files and localhost.

**Companion / Stream Deck:** add a Generic HTTP module **GET** action for each URL from **Copy all**, in order, on one button. That fires the whole layout from a single press.

## Shortcuts

| Keys | Action |
|---|---|
| V / H, or hold Space | Select / pan |
| R, Q, E, M, L | Rounded rect, squircle, ellipse, rectangle, line |
| Arrows / Shift+Arrows | Nudge 1 px / 10 px |
| Ctrl+D, or Alt+drag | Duplicate |
| Del | Delete |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo (120 steps) |
| Ctrl+] / Ctrl+[ | Forward / backward (add Shift for front / back) |
| Ctrl+L / Ctrl+H | Lock / hide |
| 1, 2, 3 | Back plate / front mask / combined view |
| K | Lock / unlock box proportions |
| C | Crop the selected slot (Enter or Esc when done) |
| G / T / ? | Grid / layout presets / all shortcuts |
| Ctrl+0 / Ctrl+1 | Fit / 100% |
| Ctrl+S / Ctrl+O / Ctrl+E | Save / open / Export Pack |

Drag behaviour:
- **Ratio locked** (top bar, on by default): resizing a box keeps its shape, from a corner or a side, and new boxes are drawn 16:9. Click it, the lock between Width and Height, or press **K** to unlock. Hold Shift while dragging to do the opposite for one drag.
- Alt-drag a handle resizes from the centre.
- Snapping uses the pixel grid (1 to 40 px), the canvas centre and edges, safe areas, and the edges and centres of other objects.

## Other notes

- **Style presets** live in this browser. Use Export / Import on the Style tab to move them between machines. Presets carry corner radii too.
- **Paste CSS box-shadow** on the Style tab accepts CSS values directly, and **Copy as CSS** goes the other way. Blur maps to Gaussian σ = blur ÷ 2, the same as CSS.
- **Changing canvas size** between presets with the same aspect ratio scales positions, sizes, radii, borders and shadows together. Designing at 1080p and exporting at 4K keeps the look.
- **Performance:** a 4K Export Pack with several large shadows renders in about 10 s on a laptop-class CPU. Editing renders at reduced resolution in a background worker, then at full resolution when you stop.

## Not built

- **vMix GT title (.gtzip) export:** I couldn't verify the GT file format offline. A XAML title wouldn't give live editable colour and shadow in vMix, so I left it out rather than ship something unverified.
- **Animated in/out presets:** vMix's layer functions have no duration or easing, so slot animation would come from vMix transitions on the whole input. That isn't something this app can control or preview faithfully.
