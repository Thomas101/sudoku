// haptics.js — small vibration helper.
//
// Android Chrome supports navigator.vibrate with patterns. iOS Safari does not
// implement the Vibration API at all, so we fall back to a best-effort trick:
// toggling a hidden <input switch> (an iOS control) produces a light system
// haptic on iOS 17.4+. It's a single fixed buzz, not a pattern, and may do
// nothing on older iOS — hence "best effort".

let enabled = true;
export function setHaptics(on) { enabled = !!on; }

const PATTERNS = {
  tap: 8,
  error: [28, 40, 28],
  region: [14, 30, 14],
  win: [22, 40, 22, 40, 70],
};

let iosLabel = null;
function iosBuzz() {
  if (!iosLabel) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', ''); // iOS-only attribute; ignored elsewhere
    label.appendChild(input);
    document.body.appendChild(label);
    iosLabel = label;
  }
  try { iosLabel.click(); } catch {}
}

export function haptic(kind = 'tap') {
  if (!enabled) return;
  const pattern = PATTERNS[kind] ?? PATTERNS.tap;
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  } else {
    iosBuzz();
  }
}
