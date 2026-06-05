// multiplayer.js — serverless, local-network 1:1 connection over WebRTC.
//
// No signaling server and no STUN: with an empty ICE config the browser only
// gathers local host / mDNS (.local) candidates, so the two devices connect
// directly across the same Wi-Fi / LAN and nothing leaves the network. The SDP
// offer/answer (candidates bundled in once gathering completes) is deflated and
// base64url-encoded into a compact "code" the players exchange via QR or paste.

const ICE = { iceServers: [] };

// ---- compact code <-> session description ----
function b64urlEncode(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(str);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
async function deflate(text) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(text)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

// Encode a session description to a code. 'D' prefix = deflated, 'P' = plain
// base64 (fallback for browsers without CompressionStream).
async function encode(desc) {
  const json = JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', s: desc.sdp });
  if (typeof CompressionStream !== 'undefined') return 'D' + b64urlEncode(await deflate(json));
  return 'P' + b64urlEncode(new TextEncoder().encode(json));
}
async function decode(code) {
  code = code.trim();
  const tag = code[0], body = code.slice(1);
  let json;
  if (tag === 'D') json = await inflate(b64urlDecode(body));
  else if (tag === 'P') json = new TextDecoder().decode(b64urlDecode(body));
  else json = code; // tolerate a raw JSON paste
  const o = JSON.parse(json);
  return { type: o.t === 'o' ? 'offer' : 'answer', sdp: o.s };
}

// Resolve once ICE gathering finishes so the localDescription carries every
// candidate — that lets us ship a single code instead of trickling.
function waitForIce(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    // Safety timeout — some browsers stall on the final candidate.
    setTimeout(resolve, 2500);
  });
}

export class Peer {
  constructor() {
    this.pc = new RTCPeerConnection(ICE);
    this.channel = null;
    this.handlers = { open: [], message: [], close: [] };
    this.pc.addEventListener('connectionstatechange', () => {
      const st = this.pc.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') this.emit('close', st);
    });
  }

  on(evt, fn) { this.handlers[evt].push(fn); return this; }
  emit(evt, data) { this.handlers[evt].forEach(fn => fn(data)); }

  _bindChannel(ch) {
    this.channel = ch;
    ch.addEventListener('open', () => this.emit('open'));
    ch.addEventListener('close', () => this.emit('close', 'channel'));
    ch.addEventListener('message', e => {
      try { this.emit('message', JSON.parse(e.data)); } catch {}
    });
  }

  send(obj) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(obj));
    }
  }

  // Host: create the data channel and produce an invite code.
  async createOffer() {
    const ch = this.pc.createDataChannel('sudoku', { ordered: true });
    this._bindChannel(ch);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIce(this.pc);
    return encode({ type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp });
  }

  // Host: finish the handshake with the guest's reply code.
  async acceptAnswer(code) {
    await this.pc.setRemoteDescription(await decode(code));
  }

  // Guest: consume an invite code and produce a reply code.
  async acceptOffer(code) {
    this.pc.addEventListener('datachannel', e => this._bindChannel(e.channel));
    await this.pc.setRemoteDescription(await decode(code));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIce(this.pc);
    return encode({ type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp });
  }

  close() {
    try { this.channel && this.channel.close(); } catch {}
    try { this.pc.close(); } catch {}
  }
}
