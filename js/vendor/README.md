# Vendored libraries

These are bundled as plain `<script>` globals (no build step), matching the rest
of the app.

| File | Global | Used by | Purpose |
|------|--------|---------|---------|
| `qrcode.js` | `QRCode` | `js/qr.js` | Render pairing QR codes |
| `jsQR.js` | `jsQR` | `js/qr.js` | Decode QR codes from the camera |
| `ggwave.js` | `ggwave_factory` | `js/sound.js` | Acoustic modem for "Pair by sound" |

## ggwave (acoustic pairing)

`js/vendor/ggwave.js` is the upstream **0.4.0** web build, vendored verbatim
(MIT, © Georgi Gerganov — https://github.com/ggerganov/ggwave). It's the
single-file build with the WASM **inlined as base64**, so there is no separate
`.wasm` to locate (handy under a GitHub Pages subpath). It exposes the global
`ggwave_factory`.

The app talks to ggwave only through `js/sound.js`, which exchanges raw bytes
(base64-wrapped over the air). The payload is the minified WebRTC offer/answer
from `js/sdp.js` (~90 bytes), capped to fit ggwave's 140-byte limit in one chirp.

If this file is ever removed, `sound.available()` returns false, the "Pair by
sound" controls hide themselves, and QR pairing is completely unaffected.

To update: `npm pack ggwave` (or download the tarball from
`https://registry.npmjs.org/ggwave/-/ggwave-<version>.tgz`), then copy
`package/ggwave.js` here, keeping the license header.
