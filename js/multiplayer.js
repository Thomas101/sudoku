// multiplayer.js — serverless 1:1 connection over WebRTC.
//
// No signaling server: the SDP offer/answer (with ICE candidates bundled in
// once gathering completes) is encoded to a short base64 "code" that the two
// players copy/paste to each other. Public STUN helps NAT traversal; same
// Wi-Fi always works, most home networks work over the internet too.

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const encode = obj => btoa(JSON.stringify(obj));
const decode = str => JSON.parse(atob(str.trim()));

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
    await this.pc.setRemoteDescription(decode(code));
  }

  // Guest: consume an invite code and produce a reply code.
  async acceptOffer(code) {
    this.pc.addEventListener('datachannel', e => this._bindChannel(e.channel));
    await this.pc.setRemoteDescription(decode(code));
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
