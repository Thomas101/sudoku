// sdp.js — minify a local-network WebRTC offer/answer to a tiny binary blob.
//
// On a single LAN almost all of an SDP is fixed boilerplate that can be rebuilt
// from a template. Only a handful of fields actually vary between connections:
//
//   • the ICE ufrag and password
//   • the DTLS fingerprint (SHA-256, 32 bytes)
//   • the setup role (actpass / active / passive)
//   • one or more host ICE candidates (mDNS UUID or raw IP + port)
//
// Capturing just those shrinks a ~500-byte deflated code to ~90 bytes — small
// enough to ride a QR code reliably *and* to travel over a short audio chirp.
// `minify` returns a Uint8Array; `expand` rebuilds an { type, sdp } pair that
// the browser accepts via setRemoteDescription.

// ---- binary writer / reader ------------------------------------------------
class Writer {
  constructor() { this.bytes = []; }
  u8(n) { this.bytes.push(n & 0xff); return this; }
  u16(n) { this.bytes.push((n >> 8) & 0xff, n & 0xff); return this; }
  bytesOf(arr) { for (const b of arr) this.bytes.push(b & 0xff); return this; }
  str(s) { const b = new TextEncoder().encode(s); this.u8(b.length).bytesOf(b); return this; }
  done() { return new Uint8Array(this.bytes); }
}
class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  u8() { return this.b[this.i++]; }
  u16() { const v = (this.b[this.i] << 8) | this.b[this.i + 1]; this.i += 2; return v; }
  take(n) { const s = this.b.slice(this.i, this.i + n); this.i += n; return s; }
  str() { return new TextDecoder().decode(this.take(this.u8())); }
}

const SETUP_CODE = { actpass: 0, active: 1, passive: 2, holdconn: 3 };
const SETUP_NAME = ['actpass', 'active', 'passive', 'holdconn'];

// Address kinds for a candidate.
const ADDR_MDNS = 0; // a "<uuid>.local" hostname → 16 raw UUID bytes
const ADDR_IP4 = 1;  // dotted IPv4 → 4 bytes
const ADDR_STR = 2;  // anything else (IPv6, raw hostname) → length-prefixed UTF-8

const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const IP4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}
function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Pull every `udp ... typ host` candidate out of an SDP, in order.
function parseCandidates(sdp) {
  const out = [];
  const re = /^a=candidate:(\S+) (\d+) (udp|UDP) (\d+) (\S+) (\d+) typ host/gim;
  let m;
  while ((m = re.exec(sdp))) out.push({ address: m[5], port: +m[6] });
  return out;
}

function packAddress(w, address) {
  let mm = address.match(UUID_LOCAL);
  if (mm) {
    w.u8(ADDR_MDNS).bytesOf(hexToBytes(mm.slice(1).join('')));
    return;
  }
  mm = address.match(IP4);
  if (mm && mm.slice(1).every(o => +o <= 255)) {
    w.u8(ADDR_IP4).u8(+mm[1]).u8(+mm[2]).u8(+mm[3]).u8(+mm[4]);
    return;
  }
  w.u8(ADDR_STR).str(address);
}

function unpackAddress(r) {
  const kind = r.u8();
  if (kind === ADDR_MDNS) {
    const h = bytesToHex(r.take(16));
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
  }
  if (kind === ADDR_IP4) { const a = r.take(4); return `${a[0]}.${a[1]}.${a[2]}.${a[3]}`; }
  return r.str();
}

// ---- public API ------------------------------------------------------------

// SDP string + "offer"/"answer" → compact Uint8Array. Throws if the SDP is
// missing anything essential (caller can then fall back to the full code).
export function minify(sdp, type) {
  const ufrag = (sdp.match(/a=ice-ufrag:(\S+)/) || [])[1];
  const pwd = (sdp.match(/a=ice-pwd:(\S+)/) || [])[1];
  const fp = (sdp.match(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/) || [])[1];
  const setup = (sdp.match(/a=setup:(\w+)/) || [])[1] || 'actpass';
  if (!ufrag || !pwd || !fp) throw new Error('SDP missing ice/fingerprint fields');

  const fpBytes = hexToBytes(fp.replace(/:/g, ''));
  if (fpBytes.length !== 32) throw new Error('unexpected fingerprint length');

  const cands = parseCandidates(sdp).slice(0, 4);

  const w = new Writer();
  const header = (type === 'answer' ? 1 : 0) | ((SETUP_CODE[setup] ?? 0) << 1);
  w.u8(header).str(ufrag).str(pwd).bytesOf(fpBytes).u8(cands.length);
  for (const c of cands) { packAddress(w, c.address); w.u16(c.port); }
  return w.done();
}

// Compact Uint8Array → { type, sdp } ready for setRemoteDescription.
export function expand(bytes) {
  const r = new Reader(bytes);
  const header = r.u8();
  const type = (header & 1) ? 'answer' : 'offer';
  const setup = SETUP_NAME[(header >> 1) & 3];
  const ufrag = r.str();
  const pwd = r.str();
  const fp = bytesToHex(r.take(32)).match(/../g).join(':').toUpperCase();
  const n = r.u8();
  const candLines = [];
  for (let k = 0; k < n; k++) {
    const address = unpackAddress(r);
    const port = r.u16();
    // Foundation/priority are cosmetic for a single host candidate; fixed values
    // keep the line valid without needing to transmit them.
    candLines.push(`a=candidate:1 1 udp 2113937151 ${address} ${port} typ host generation 0`);
  }

  const sdp = [
    'v=0',
    'o=- 0 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    ...candLines,
    'a=end-of-candidates',
    '',
  ].join('\r\n');

  return { type, sdp };
}
