// Run with:  node --test extension/tests/hotstar-adapter.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function setup() {
  const st = { dur: 7200, href: 'https://www.hotstar.com/in/movies/some-film/1234/watch', buttons: [], now: 1_000_000 };
  const video = { get duration() { return st.dur; } };
  const win = {};
  win.window = win;
  const ctx = vm.createContext({
    window: win, URL, Date: { now: () => st.now },
    location: { get href() { return st.href; } },
    document: { querySelector: () => video, querySelectorAll: () => st.buttons }
  });
  vm.runInContext(read('core/sync-math.js'), ctx);
  vm.runInContext(read('platforms/hotstar/adapter.js'), ctx);
  const btn = (text, visible = true) => ({ getClientRects: () => (visible ? [{}] : []), getAttribute: () => null, textContent: text });
  return { st, P: win.ShaanPlatform, btn, tick: () => { st.now += 1000; } };
}

test('normal playback is not an ad', () => {
  const { P } = setup();
  assert.equal(P.isAdPlaying(), false);
});

test('a short clip swapped into the player is an ad, and the movie afterwards is not', () => {
  const { st, P, tick } = setup();
  assert.equal(P.isAdPlaying(), false);
  st.dur = 30; tick(); assert.equal(P.isAdPlaying(), true);
  st.dur = 7200; tick(); assert.equal(P.isAdPlaying(), false);
});

test('a pre-roll ad is recognised from the on-screen "Skip Ad" control even before the movie length is known', () => {
  const { st, P, btn, tick } = setup();
  st.dur = 30; st.buttons = [btn('Skip Ad')];
  assert.equal(P.isAdPlaying(), true);
  assert.equal(P.diagnose().mainDur, 0, 'an ad must not become the title length');
  st.dur = 7200; st.buttons = []; tick();
  assert.equal(P.isAdPlaying(), false);
  assert.equal(P.diagnose().mainDur, 7200);
});

test('hidden or unrelated buttons are ignored', () => {
  const { st, P, btn } = setup();
  st.dur = 30;
  st.buttons = [btn('Skip Ad', false), btn('Add to Watchlist'), btn('Adventure')];
  assert.equal(P.isAdPlaying(), false);
});

test('a new title starts with a clean slate', () => {
  const { st, P, tick } = setup();
  P.isAdPlaying();
  st.href = 'https://www.hotstar.com/in/shows/other/99/watch'; st.dur = 1500; tick();
  assert.equal(P.isAdPlaying(), false);
  assert.equal(P.diagnose().mainDur, 1500);
});

test('loading / live streams never count as ads', () => {
  const { st, P } = setup();
  st.dur = NaN; assert.equal(P.isAdPlaying(), false);
  st.dur = Infinity; assert.equal(P.isAdPlaying(), false);
});
