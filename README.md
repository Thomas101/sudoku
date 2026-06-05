# Sudoku

An ad-free, installable Sudoku PWA. 100% client-side — no server, no accounts, no
tracking. Generates puzzles on the fly, saves your game, and lets two people play
the same board together (co-op) or race each other (versus) over a direct
peer-to-peer link.

Built with vanilla HTML/CSS/JS and ES modules — **no build step**, so it drops
straight onto GitHub Pages.

> Shamelessly vibecoded. 🤙

## Features

- **Six difficulties** — Easy, Medium, Hard, Expert, Master, Extreme. Each puzzle
  is generated fresh, graded by the actual solving techniques it requires, and
  guaranteed to have a unique solution.
- **Save & resume** — your in-progress game and lifetime stats live in
  `localStorage`; close the tab and pick up where you left off.
- **The usual helpers** — pencil notes, undo, erase, hints, mistake counter
  (3 strikes optional), matching-number and row/col/box highlighting.
- **Touch-first, desktop-friendly** — big tap targets on mobile; full keyboard
  support on desktop (digits to fill, arrows to move, `N` notes, `H` hint,
  `U` undo, `Backspace` erase).
- **Play Together (no server)** — two devices on the same Wi-Fi connect directly
  via WebRTC. **Scan a QR** to pair, then play:
  - **Co-op** — one shared board, both of you filling it in together.
  - **Versus** — same puzzle, separate boards, race to finish.

  Nothing leaves your network: with no STUN/TURN configured, the browsers only
  use local (host / mDNS) candidates, so the link is strictly device-to-device
  over the LAN.
- **Installable & offline** — manifest + service worker, so it installs to your
  home screen and works with no connection.

## Running locally

It's just static files. Any static server works:

```bash
npm start          # python3 -m http.server 8000
# then open http://localhost:8000
```

(A server is needed rather than opening `index.html` directly, because ES modules
and the service worker require `http://`/`https://`.)

Run the engine sanity checks:

```bash
npm test
```

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. Your game appears at `https://<user>.github.io/<repo>/`.

All paths are relative and a `.nojekyll` file is included, so it works from a
project subpath without any configuration. The repo can stay private until you
flip it public to enable Pages.

### How "Play Together" pairs (and the camera caveat)

WebRTC needs the two devices to swap a one-time "offer" and "answer" before they
connect. This app carries that handshake in a QR code (deflated to ~0.5 KB):

1. One player taps **Host** → a QR appears.
2. The other taps **Join → Scan invite** and scans it; their phone shows a reply QR.
3. The host taps **Scan their reply** and scans that. Connected.

Pairing is QR + camera only. The camera (`getUserMedia`) works in a **secure
context** — i.e. over HTTPS (your `github.io` Pages URL) or the **installed PWA**.
Install the app once and the camera (and the whole game) works offline on your
local Wi-Fi. Over plain `http://` the browser blocks the camera, so use the HTTPS
URL or the installed app. Note: some guest/corporate Wi-Fi enables "client
isolation" which blocks device-to-device traffic — a normal home network won't.

## Project layout

```
index.html              app shell / all screens
css/styles.css          styling
js/sudoku.js            generator + solver + difficulty grader (pure, testable)
js/storage.js           localStorage: game state, settings, stats
js/multiplayer.js       serverless local-network WebRTC peer (no STUN/TURN)
js/qr.js                QR rendering + camera scanning for pairing
js/vendor/              qrcode-generator (encoder) + jsQR (decoder)
js/app.js               UI wiring, game flow, multiplayer glue
manifest.webmanifest    PWA manifest
service-worker.js       offline app-shell cache
icons/                  app icons (PNG + SVG)
test/engine.test.mjs    node sanity checks for the engine
```

## How difficulty works

`js/sudoku.js` generates a full solution, then carves cells away while keeping the
solution unique. Each candidate puzzle is run through a human-style logical solver
(naked/hidden singles, locked candidates, naked/hidden pairs, triples, X-Wing). The
hardest technique needed plus the clue count places it in a difficulty band, so
"Extreme" genuinely requires harder reasoning than "Easy" — not just fewer givens.

## License

Copyright (c) 2026 Thomas Beverley.

Licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE.md)** — you're
free to use, modify, and share it for any **noncommercial** purpose, but commercial
use is not permitted. See [LICENSE.md](LICENSE.md) for the full terms.

The bundled libraries under `js/vendor/` keep their own licenses:
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) and
[jsQR](https://github.com/cozmo/jsQR) (Apache-2.0).
