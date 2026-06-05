// sound.js — pair two devices over a short audio chirp, no server, no camera.
//
// Thin wrapper around ggwave (an acoustic FSK modem with error correction).
// ggwave ships as a global `ggwave_factory` loaded from js/vendor/ggwave.js; if
// that file is absent `available()` is false and the UI hides sound pairing.
//
// The public API speaks raw bytes — callers hand us a Uint8Array and get one
// back. Internally we base64url-wrap the payload so only printable ASCII rides
// the audio link (robust, and side-steps any binary/UTF-8 quirks in the modem).

// ---- base64url (binary-safe over the wire) ----
function b64encode(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(str);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

// Copy a typed array's bytes into a fresh, correctly-aligned view of another
// type (ggwave hands back/needs Float32 samples as a byte array).
function reinterpret(src, Type) {
  const buf = new ArrayBuffer(src.byteLength);
  new Uint8Array(buf).set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength));
  return new Type(buf);
}

export function available() { return typeof globalThis.ggwave_factory !== 'undefined'; }

let modulePromise = null;
let ctx = null, ggwave = null, instance = null;
let playing = null; // the AudioBufferSourceNode of the chirp currently playing

async function ensure() {
  if (!available()) throw new Error('ggwave library not loaded');
  if (!modulePromise) modulePromise = globalThis.ggwave_factory();
  ggwave = await modulePromise;
  ggwave.disableLog?.(); // silence ggwave's per-frame decode chatter in the console
  if (!ctx) ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)({ sampleRate: 48000 });
  if (ctx.state === 'suspended') await ctx.resume();
  if (!instance) {
    const p = ggwave.getDefaultParameters();
    p.sampleRateInp = ctx.sampleRate;
    p.sampleRateOut = ctx.sampleRate;
    instance = ggwave.init(p);
  }
}

// A middle-ground protocol: audible (works on any phone speaker/mic) and a good
// speed/robustness balance for short payloads at close range.
function protocol() { return ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST; }

// Play `bytes` as a chirp. Resolves when playback finishes.
export async function send(bytes) {
  await ensure();
  const waveform = ggwave.encode(instance, b64encode(bytes), protocol(), 10);
  const samples = reinterpret(waveform, Float32Array);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  // A chirp is several seconds long; track it so stopPlayback() can cut it short
  // (e.g. when the user closes the pairing sheet mid-transmission).
  playing = src;
  return new Promise(resolve => {
    src.onended = () => { if (playing === src) playing = null; resolve(); };
    src.start();
  });
}

// Immediately silence any chirp in progress. start()/onended still fires, so a
// pending send() promise resolves and its transmit loop can exit.
export function stopPlayback() {
  if (playing) { try { playing.stop(); } catch {} }
}

// Listen on the mic and call `onBytes(Uint8Array)` for each decoded payload.
// Returns a stop() function that releases the mic. Throws if mic is denied.
export async function listen(onBytes) {
  await ensure();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  let stopped = false;
  proc.onaudioprocess = e => {
    if (stopped) return;
    const chunk = reinterpret(new Float32Array(e.inputBuffer.getChannelData(0)), Int8Array);
    const res = ggwave.decode(instance, chunk);
    if (res && res.length > 0) {
      try { onBytes(b64decode(new TextDecoder('utf-8').decode(res))); } catch { /* garbled */ }
    }
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  return () => {
    stopped = true;
    try { proc.disconnect(); source.disconnect(); } catch {}
    stream.getTracks().forEach(t => t.stop());
  };
}
