// qr.js — render and scan QR codes for the connection handshake.
// Relies on vendored globals: window.qrcode (encoder) and window.jsQR (decoder),
// loaded as classic scripts in index.html. Uses the native BarcodeDetector when
// available (faster) and falls back to jsQR otherwise.

// Draw `text` as a crisp, responsive QR into `el`.
export function renderQR(el, text) {
  const qr = window.qrcode(0, 'L'); // type 0 = auto-fit, error correction L = max capacity
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
  const svg = el.querySelector('svg');
  if (svg) {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%';
    svg.style.height = '100%';
  }
}

// Start the rear camera and scan for a QR code. Calls onResult(text) once,
// then stops. Returns a stop() function. Throws if the camera is unavailable
// (e.g. insecure context) — callers should fall back to a pasted code.
export async function startScanner(video, onResult) {
  const detector = ('BarcodeDetector' in window)
    ? new window.BarcodeDetector({ formats: ['qr_code'] })
    : null;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });

  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false, raf = 0;

  const stop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };

  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let text = null;
      if (detector) {
        try { const codes = await detector.detect(canvas); if (codes.length) text = codes[0].rawValue; } catch {}
      }
      if (!text && window.jsQR) {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (res) text = res.data;
      }
      if (text) { stop(); onResult(text); return; }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}
