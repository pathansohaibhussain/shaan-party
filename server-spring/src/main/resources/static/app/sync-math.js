// Pure helpers shared by the extension (content script + sidebar) and the web room.
// No DOM and no chrome.* in here, so everything can be unit-tested with plain node.
// NOTE: server-spring/src/main/resources/static/app/sync-math.js must stay an identical copy
// (extension/tests/sync-math.test.js fails if they differ).
(function (root) {
  'use strict';

  const CFG = {
    hardSeekEvent: 1.0,   // play / pause / seek events: jump if we are further off than this (s)
    hardSeekBeat: 1.5,    // heartbeat: jump if further off than this (s)
    nudgeMin: 0.3,        // heartbeat: start gently changing speed above this drift (s)
    nudgeOff: 0.15,       // heartbeat: back to normal speed below this drift (s)
    nudgeMax: 0.05,       // never speed up / slow down by more than 5%
    maxTransit: 15        // never extrapolate a message by more than this many seconds
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // diff = (where we should be) - (where we are), in seconds. Positive means we are behind.
  // opts: { beat: bool, playing: bool }  (playing = both sides are playing)
  // returns { action: 'seek' | 'nudge' | 'reset' | 'hold' | 'none', factor? }
  function driftAction(diff, opts) {
    const o = opts || {};
    const ad = Math.abs(diff);
    if (ad > (o.beat ? CFG.hardSeekBeat : CFG.hardSeekEvent)) return { action: 'seek' };
    if (!o.beat) return { action: 'none' };
    if (!o.playing) return { action: 'hold' };
    if (ad >= CFG.nudgeMin) return { action: 'nudge', factor: 1 + clamp(diff * 0.1, -CFG.nudgeMax, CFG.nudgeMax) };
    if (ad <= CFG.nudgeOff) return { action: 'reset' };
    return { action: 'hold' };
  }

  // seconds a message spent in transit. sentAt and srvNow are both in (estimated) server time, ms.
  function transit(sentAt, srvNow, max) {
    if (!(sentAt > 0) || !(srvNow > 0)) return 0;
    const s = (srvNow - sentAt) / 1000;
    return s <= 0 ? 0 : Math.min(s, max === undefined ? CFG.maxTransit : max);
  }

  // NTP-style estimate of (server clock - local clock) from ping/pong round trips.
  // Keeps the last few samples and trusts the one with the smallest round trip.
  class ClockSync {
    constructor(max) { this.samples = []; this.max = max || 8; this.offset = 0; this.rtt = 0; }
    // sentAt: local time the ping left, serverAt: server clock in the pong, recvAt: local time the pong arrived
    sample(sentAt, serverAt, recvAt) {
      const rtt = recvAt - sentAt;
      if (!(rtt >= 0) || rtt > 5000 || !(serverAt > 0)) return false;
      this.samples.push({ rtt, off: serverAt + rtt / 2 - recvAt });
      if (this.samples.length > this.max) this.samples.shift();
      const best = this.samples.reduce((b, x) => (x.rtt < b.rtt ? x : b));
      this.offset = best.off; this.rtt = best.rtt;
      return true;
    }
    get ready() { return this.samples.length > 0; }
    now(localNow) { return localNow + this.offset; }
  }

  // Ad heuristic for sites that swap a short ad into the same <video>.
  //   dur      current video duration (s)
  //   mainDur  longest non-ad duration seen on this page (s), 0 if unknown
  //   hint     true when the page shows something ad-like ("Skip Ad", "Ad 1 of 2")
  function looksLikeAd(o) {
    const dur = o && o.dur;
    if (!(dur > 0) || !isFinite(dur)) return false;
    if (o.mainDur >= 300 && dur < o.mainDur * 0.5) return true;
    if (o.hint && dur <= 180) return true;
    return false;
  }

  const api = { CFG, driftAction, transit, ClockSync, looksLikeAd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShaanMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
