# vMix PIP Builder

- Single-page app built into one HTML file by `node build.mjs` (no deps). Source in `src/`.
- `index.test.html` is the test build and `index.html` is production; both are committed on `main`.
  Every change to `src/` must run `npm run build` and commit the new `index.test.html` with it
  (CI fails otherwise). Never edit or rebuild `index.html` as part of a change.
- **"Promote to production"** (Bryan's phrase, same as Wall Mapper): on an up-to-date `main`, run
  `npm run promote`. It runs the full suite on `index.test.html` (browser checks required) and copies
  it over `index.html` only if everything passes. Commit only `index.html` straight to `main`
  ("Promote test build to production"), push, and confirm the "Check test build" run is green.
  If any check fails, do not promote: report the failing checks instead.
- `npm test` runs static checks, the render engine in Node (exports decoded and checked pixel by
  pixel, vMix values round-tripped) and the page in Chromium via Playwright. Run it after every
  change; new behaviour gets a check in `tests/run.mjs`.
- `src/js/engine.js` runs in the page, in the render worker (from the `#engine-src` block's text) and
  in the tests: keep it free of DOM access. The other `src/js/` files are concatenated, in include
  order, inside one function scope that `src/index.html` opens and closes.
- vMix layer conventions come from the vMix Shortcut Function Reference: Pan -2..2 where 2 = one
  frame (PanY + = up), Zoom 1 = 100%, Crop X1/Y1 0 = none and X2/Y2 1 = none, Rectangle in preset
  pixels. Don't change them without a source.
- PNGs are written by the app's own encoder as straight alpha; never switch exports to
  `canvas.toBlob()` (it premultiplies and shifts faint shadow colours).
- Match the existing style: `var`/function declarations, two-space indent, `/* ... */` section comments.
