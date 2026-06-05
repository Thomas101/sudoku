// Round-trip tests for the SDP minifier. We can't exercise a real WebRTC
// handshake in Node, but we can prove the minify→expand step preserves every
// field the remote peer relies on (ufrag, pwd, fingerprint, candidates, setup)
// and that the encoded blob is small enough for a QR / audio chirp.
import { minify, expand } from '../js/sdp.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}`); failures++; }
}

const FP = '8F:5E:1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8:09:1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7';

// A Chrome-style data-channel offer with an mDNS host candidate.
const chromeOffer = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1853887674 1 udp 2113937151 b8f1e2c3-1234-4abc-89de-0123456789ab.local 54321 typ host generation 0 network-cost 999',
  'a=ice-ufrag:Xk4Z',
  'a=ice-pwd:by8wT6jL0pQr3sV9mNcF7xAz',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

// An answer (setup:active) with a raw IPv4 host candidate + a second candidate.
const ip4Answer = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:9aBc',
  'a=ice-pwd:QwErTyUiOpAsDfGhem1234567',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=candidate:1 1 udp 2113937151 192.168.1.42 50000 typ host generation 0',
  'a=candidate:2 1 udp 2113937151 fe80abcd-0000-4000-8000-aabbccddeeff.local 50001 typ host generation 0',
  '',
].join('\r\n');

function fields(sdp) {
  return {
    ufrag: (sdp.match(/a=ice-ufrag:(\S+)/) || [])[1],
    pwd: (sdp.match(/a=ice-pwd:(\S+)/) || [])[1],
    fp: (sdp.match(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/) || [])[1].toUpperCase(),
    setup: (sdp.match(/a=setup:(\w+)/) || [])[1],
    cands: [...sdp.matchAll(/a=candidate:\S+ \d+ udp \d+ (\S+) (\d+) typ host/gi)].map(m => `${m[1]}:${m[2]}`),
  };
}

console.log('chrome offer (mDNS candidate):');
{
  const bytes = minify(chromeOffer, 'offer');
  const { type, sdp } = expand(bytes);
  const a = fields(chromeOffer), b = fields(sdp);
  check('type preserved', type === 'offer');
  check('ufrag preserved', a.ufrag === b.ufrag);
  check('pwd preserved', a.pwd === b.pwd);
  check('fingerprint preserved', a.fp === b.fp);
  check('setup preserved', a.setup === b.setup);
  check('mDNS candidate preserved', b.cands.includes('b8f1e2c3-1234-4abc-89de-0123456789ab.local:54321'));
  check(`compact size (${bytes.length}B ≤ 110)`, bytes.length <= 110);
}

console.log('ipv4 answer (two candidates):');
{
  const bytes = minify(ip4Answer, 'answer');
  const { type, sdp } = expand(bytes);
  const a = fields(ip4Answer), b = fields(sdp);
  check('type preserved', type === 'answer');
  check('ufrag preserved', a.ufrag === b.ufrag);
  check('pwd preserved', a.pwd === b.pwd);
  check('fingerprint preserved', a.fp === b.fp);
  check('setup preserved (active)', b.setup === 'active');
  check('ipv4 candidate preserved', b.cands.includes('192.168.1.42:50000'));
  check('second candidate preserved', b.cands.includes('fe80abcd-0000-4000-8000-aabbccddeeff.local:50001'));
  check(`compact size (${bytes.length}B ≤ 130)`, bytes.length <= 130);
}

console.log('rejects incomplete sdp:');
{
  let threw = false;
  try { minify('v=0\r\na=setup:actpass\r\n', 'offer'); } catch { threw = true; }
  check('throws when ice/fingerprint missing', threw);
}

if (failures) { console.log(`\n${failures} check(s) failed ✗`); process.exit(1); }
console.log('\nAll SDP checks passed ✓');
