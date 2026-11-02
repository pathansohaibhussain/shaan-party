// Loads the real core/content-core.js into a sandbox with a fake <video>, fake clock and fake sidebar.
// Run with:  node --test extension/tests/content-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function setup(opts) {
  opts = opts || {};
  let now = 1_000_000;
  const sent = [];                       // everything the core posts to the sidebar iframe
  const listeners = {};                  // window listeners by event name
  const ctl = { ad: false, hasVideo: opts.hasVideo !== false };
  const intervals = [];
  let onChromeMsg = null;

  const video = {
    paused: false, currentTime: 100, playbackRate: 1, duration: 7200, readyState: 4, _l: {},
    addEventListener(ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn); },
    fire(ev) { (this._l[ev] || []).forEach(f => f()); },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
  const el = tag => ({ tag, style: { setProperty() {}, removeProperty() {} }, appendChild() {}, append() {}, remove() {}, addEventListener() {}, contentWindow: { postMessage: m => sent.push(m) }, childNodes: [] });
  const win = {
    ShaanPlatform: { id: 'test', isHost: () => true, getVideo: () => (ctl.hasVideo ? video : null), isAdPlaying: () => ctl.ad, pageKey: () => 'k' },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatchEvent() {}
  };
  win.window = win; win.top = win;
  const frameEl = el('iframe');
  const ctx = vm.createContext({
    window: win, URL, Promise, JSON, Math, console, setTimeout: () => 0, setInterval: fn => { intervals.push(fn); return 1; },
    Date: { now: () => now },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'https://x.test/watch?v=1', hostname: 'x.test' },
    history: { replaceState() {} },
    document: { readyState: 'complete', documentElement: Object.assign(el('html'), { style: { setProperty() {}, removeProperty() {} } }), fullscreenElement: null, createElement: t => (t === 'iframe' ? frameEl : el(t)), addEventListener() {} },
    chrome: { runtime: { getURL: p => 'chrome-extension://x/' + p, sendMessage() {}, lastError: null, onMessage: { addListener: fn => { onChromeMsg = fn; } } } }
  });
  vm.runInContext(read('core/sync-math.js'), ctx);
  vm.runInContext(read('core/content-core.js'), ctx);
  onChromeMsg({ type: 'sp-join', room: 'room123' }, null, () => {});          // join a party
  const tick = () => intervals.forEach(f => f());
  const remote = (data, from) => listeners.message.forEach(f => f({ source: frameEl.contentWindow, data: { sp: 'remote', data, from: from || '2' } }));
  const fromSidebar = m => listeners.message.forEach(f => f({ source: frameEl.contentWindow, data: m }));
  const sends = () => sent.filter(m => m.sp === 'send').map(m => m.data);
  return { video, ctl, sent, sends, tick, remote, fromSidebar, advance: ms => { now += ms; }, clear: () => { sent.length = 0; } };
}

test('a play event jumps to the sender position plus the time the message spent travelling', () => {
  const t = setup(); t.tick();
  t.video.paused = true; t.video.currentTime = 10;
  t.remote({ kind: 'sync', ev: 'play', playing: true, time: 100, rate: 1, lat: 0.5 });
  assert.equal(t.video.currentTime, 100.5);
  assert.equal(t.video.paused, false);
});

test('a paused sender is not extrapolated', () => {
  const t = setup(); t.tick();
  t.remote({ kind: 'sync', ev: 'pause', playing: false, time: 55, rate: 1, lat: 2 });
  assert.equal(t.video.currentTime, 55);
  assert.equal(t.video.paused, true);
});

test('our own changes are not echoed back to the party', () => {
  const t = setup(); t.tick(); t.clear();
  t.video.paused = true;
  t.remote({ kind: 'sync', ev: 'play', playing: true, time: 100, rate: 1, lat: 0 });
  t.video.fire('play'); t.video.fire('seeked');
  assert.equal(t.sends().length, 0);
});

test('a heartbeat never flips play/pause on its own, but two in a row do', () => {
  const t = setup(); t.tick();
  t.video.paused = true; t.video.currentTime = 100;                     // we just paused locally
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1, lat: 0 });
  assert.equal(t.video.paused, true, 'one stale beat must not resume playback');
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1, lat: 0 });
  assert.equal(t.video.paused, false, 'still disagreeing on the next beat: follow the party');
});

test('a heartbeat with small drift changes speed instead of seeking, and restores it', () => {
  const t = setup(); t.tick();
  t.video.currentTime = 101;                                            // we are 1 s ahead
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1, lat: 0 });
  assert.equal(t.video.currentTime, 101, 'no jump');
  assert.ok(t.video.playbackRate < 1 && t.video.playbackRate >= 0.95, 'slowed down: ' + t.video.playbackRate);
  t.advance(2000); t.video.currentTime = 100.05;                        // caught up
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100.1, rate: 1, lat: 0 });
  assert.equal(t.video.playbackRate, 1);
});

test('a heartbeat with big drift seeks and clears any speed nudge', () => {
  const t = setup(); t.tick();
  t.video.currentTime = 101;
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1, lat: 0 });
  assert.ok(t.video.playbackRate < 1);
  t.advance(2000); t.video.currentTime = 120;
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1, lat: 0 });
  assert.equal(t.video.currentTime, 100);
  assert.equal(t.video.playbackRate, 1);
});

test('while catching up we report the real speed, not the nudged one', () => {
  const t = setup(); t.tick();
  t.video.currentTime = 101;
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1, lat: 0 });
  assert.notEqual(t.video.playbackRate, 1);
  t.advance(3000); t.clear();
  t.video.paused = true; t.video.fire('pause');                         // the person pauses
  const s = t.sends();
  assert.equal(s.length, 1);
  assert.equal(s[0].ev, 'pause');
  assert.equal(s[0].rate, 1);
});

test('a heartbeat that changes nothing does not block the next local action', () => {
  const t = setup(); t.tick(); t.clear();
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1, lat: 0 });   // perfectly in sync
  t.video.paused = true; t.video.fire('pause');
  assert.equal(t.sends().length, 1, 'the pause must still be sent');
});

test('the leader sends a heartbeat every ~4 s while playing, others do not', () => {
  const t = setup(); t.tick(); t.clear();
  t.tick();
  assert.equal(t.sends().filter(d => d.ev === 'beat').length, 0, 'not the leader');
  t.fromSidebar({ sp: 'leader', leader: true });
  t.tick();
  assert.equal(t.sends().filter(d => d.ev === 'beat').length, 1);
  t.advance(1000); t.tick();
  assert.equal(t.sends().filter(d => d.ev === 'beat').length, 1, 'too soon for another');
  t.advance(3500); t.tick();
  assert.equal(t.sends().filter(d => d.ev === 'beat').length, 2);
  t.video.paused = true; t.advance(5000); t.clear(); t.tick();
  assert.equal(t.sends().filter(d => d.ev === 'beat').length, 0, 'no heartbeat while paused');
});

test('no heartbeat is sent while an ad is playing', () => {
  const t = setup(); t.tick(); t.clear();
  t.fromSidebar({ sp: 'leader', leader: true });
  t.ctl.ad = true; t.tick();
  assert.equal(t.sends().length, 0);
});

test('when an ad ends the core asks the party where everyone is', () => {
  const t = setup(); t.tick();
  t.ctl.ad = true; t.tick(); t.clear();
  t.ctl.ad = false; t.tick();
  assert.ok(t.sent.some(m => m.sp === 'reqstate'));
});

test('a state that arrives before the player exists is applied later, with the waiting time added', () => {
  const t = setup({ hasVideo: false }); t.tick();
  t.remote({ kind: 'sync', ev: 'state', playing: true, time: 50, rate: 1, lat: 0.2 });
  t.advance(2000);
  t.ctl.hasVideo = true; t.video.currentTime = 0; t.tick();
  assert.ok(Math.abs(t.video.currentTime - 52.2) < 1e-9, 'got ' + t.video.currentTime);
});

test('a leader speed change reaches followers even without a separate event', () => {
  const t = setup(); t.tick();
  t.remote({ kind: 'sync', ev: 'beat', playing: true, time: 100, rate: 1.5, lat: 0 });
  assert.equal(t.video.playbackRate, 1.5);
});
