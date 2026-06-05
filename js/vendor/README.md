# Vendored libraries

These are bundled as plain `<script>` globals (no build step), matching the rest
of the app.

| File | Global | Used by | Purpose |
|------|--------|---------|---------|
| `qrcode.js` | `QRCode` | `js/qr.js` | Render pairing QR codes |
| `jsQR.js` | `jsQR` | `js/qr.js` | Decode QR codes from the camera |
| `ggwave.js` | `ggwave_factory` | `js/sound.js` | **Optional** acoustic modem for "Pair by sound" |

## Enabling "Pair by sound" (ggwave)

`ggwave.js` is **not** committed. When it's absent the app simply hides the
"Pair by sound" buttons and QR pairing works exactly as before. To enable
acoustic pairing, drop the ggwave web build into this folder:

```
js/vendor/ggwave.js     # emscripten module exposing window.ggwave_factory
js/vendor/ggwave.wasm   # (only if your build loads the .wasm separately)
```

Get it from the upstream project — https://github.com/ggerganov/ggwave — e.g.
the prebuilt files published on npm/CDN:

```
https://cdn.jsdelivr.net/npm/ggwave/ggwave.js
https://cdn.jsdelivr.net/npm/ggwave/ggwave.wasm
```

(Download with the network allowed, or copy from a local `npm i ggwave`.)
`index.html` already references `js/vendor/ggwave.js`; once the file is present,
the "Pair by sound" option appears automatically.

> The app talks to ggwave only through `js/sound.js`, which exchanges raw bytes
> (base64-wrapped over the air). The payload is the minified WebRTC offer/answer
> from `js/sdp.js` (~90 bytes), small enough for a single short chirp.
