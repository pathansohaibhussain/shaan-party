// Run with:  node --test extension/tests/sync-math.test.js     (needs Node 18+)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../core/sync-math.js');

test('driftAction: small drift on an event does nothing, large drift seeks', () => {
  assert.equal(M.driftAction(0.4, { beat: false }).action, 'none');
  assert.equal(M.driftAction(-0.9, { beat: false }).action, 'none');
  assert.equal(M.driftAction(1.2, { beat: false }).action, 'seek');
  assert.equal(M.driftAction(-3, { beat: false }).action, 'seek');
});

test('driftAction: heartbeat nudges speed instead of jumping for medium drift', () => {
  const behind = M.driftAction(1.0, { beat: true, playing: true });
  assert.equal(behind.action, 'nudge');
  assert.ok(behind.factor > 1 && behind.factor <= 1.05 + 1e-9);
  const ahead = M.driftAction(-1.0, { beat: true, playing: true });
  assert.equal(ahead.action, 'nudge');
  assert.ok(ahead.factor < 1 && ahead.factor >= 0.95 - 1e-9);
});

test('driftAction: heartbeat thresholds (seek / nudge / hold / reset)', () => {
  assert.equal(M.driftAction(1.6, { beat: true, playing: true }).action, 'seek');
  assert.equal(M.driftAction(0.31, { beat: true, playing: true }).action, 'nudge');
  assert.equal(M.driftAction(0.2, { beat: true, playing: true }).action, 'hold');
  assert.equal(M.driftAction(0.1, { beat: true, playing: true }).action, 'reset');
  assert.equal(M.driftAction(0.8, { beat: true, playing: false }).action, 'hold');   // paused: never nudge
});

test('driftAction: the nudge is capped at 5% however far behind we are', () => {
  assert.equal(M.driftAction(1.4, { beat: true, playing: true }).factor, 1.05);
  assert.equal(M.driftAction(-1.4, { beat: true, playing: true }).factor, 0.95);
});

test('transit: elapsed seconds, never negative, capped', () => {
  assert.equal(M.transit(1000, 1250), 0.25);
  assert.equal(M.transit(2000, 1000), 0);            // sender clock ahead of ours: no negative lag
  assert.equal(M.transit(0, 5000), 0);               // no stamp (old client): no correction
  assert.equal(M.transit(1000, 1000 + 60000), M.CFG.maxTransit);
  assert.equal(M.transit(1000, 1000 + 60000, 30), 30);
});

test('ClockSync: finds the server offset and prefers the lowest round trip', () => {
  const c = new M.ClockSync();
  assert.equal(c.ready, false);
  // our clock is 5000 ms behind the server. Symmetric 100 ms round trip.
  assert.ok(c.sample(1000, 6050, 1100));
  assert.equal(c.ready, true);
  assert.equal(Math.round(c.offset), 5000);
  assert.equal(c.now(2000), 7000);
  // a noisy, slow sample must not replace the good one
  c.sample(3000, 8900, 3800);
  assert.equal(Math.round(c.offset), 5000);
  assert.equal(c.rtt, 100);
  // a better sample wins
  c.sample(4000, 9020, 4040);
  assert.equal(Math.round(c.offset), 5000);
  assert.equal(c.rtt, 40);
});

test('ClockSync: rejects nonsense samples', () => {
  const c = new M.ClockSync();
  assert.equal(c.sample(2000, 5000, 1000), false);   // pong before ping
  assert.equal(c.sample(1000, 5000, 9000), false);   // 8 s round trip
  assert.equal(c.sample(1000, 0, 1100), false);      // no server time
  assert.equal(c.ready, false);
});

test('end to end: two clocks that disagree still agree on message lag', () => {
  // A's clock is +3000 ms vs the server, B's is -2000 ms. Both measured with 60 ms round trips.
  const a = new M.ClockSync(), b = new M.ClockSync();
  const server = 1_000_000;
  a.sample(server + 3000 - 30, server, server + 3000 + 30);
  b.sample(server - 2000 - 30, server, server - 2000 + 30);
  // A sends at server time 1_100_000 (A's local clock reads 1_103_000)
  const sentAt = a.now(1_103_000);
  // 250 ms later (server time 1_100_250) B receives it; B's local clock reads 1_098_250
  const lag = M.transit(sentAt, b.now(1_098_250));
  assert.ok(Math.abs(lag - 0.25) < 0.001, 'lag was ' + lag);
});

test('looksLikeAd', () => {
  assert.equal(M.looksLikeAd({ dur: 30, mainDur: 7200 }), true);            // 30 s clip inside a 2 h title
  assert.equal(M.looksLikeAd({ dur: 7200, mainDur: 7200 }), false);
  assert.equal(M.looksLikeAd({ dur: 4000, mainDur: 7200 }), false);         // more than half the title: treated as content
  assert.equal(M.looksLikeAd({ dur: 3500, mainDur: 7200 }), true);          // under half the title: treated as an ad
  assert.equal(M.looksLikeAd({ dur: 30, mainDur: 0 }), false);              // nothing known yet and no hint
  assert.equal(M.looksLikeAd({ dur: 30, mainDur: 0, hint: true }), true);   // "Skip Ad" button visible
  assert.equal(M.looksLikeAd({ dur: 7200, mainDur: 0, hint: true }), false);// hint on a long video: not an ad
  assert.equal(M.looksLikeAd({ dur: NaN, mainDur: 7200 }), false);          // loading
  assert.equal(M.looksLikeAd({ dur: Infinity, mainDur: 7200 }), false);     // live
  assert.equal(M.looksLikeAd({ dur: 100, mainDur: 400 }), true);            // 100 s inside a 400 s title
  assert.equal(M.looksLikeAd({ dur: 100, mainDur: 200 }), false);           // main too short to judge
});

test('the web room ships an identical copy of sync-math.js', () => {
  const a = fs.readFileSync(path.join(__dirname, '../core/sync-math.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '../../server-spring/src/main/resources/static/app/sync-math.js'), 'utf8');
  assert.equal(a, b, 'copy extension/core/sync-math.js over server-spring/src/main/resources/static/app/sync-math.js');
});

test('every place that injects content-core.js loads sync-math.js first', () => {
  const root = path.join(__dirname, '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const manifest = JSON.parse(read('manifest.json'));
  for (const cs of manifest.content_scripts) {
    assert.ok(cs.js.indexOf('core/sync-math.js') !== -1 && cs.js.indexOf('core/sync-math.js') < cs.js.indexOf('core/content-core.js'), JSON.stringify(cs.js));
  }
  for (const f of ['background.js', 'popup/popup.js']) {
    const src = read(f);
    assert.match(src, /core\/sync-math\.js.*platforms\/generic\/adapter\.js.*core\/content-core\.js/, f);
  }
  assert.match(read('platforms/local/player.html'), /sync-math\.js[\s\S]*content-core\.js/);
  assert.match(read('sidebar/sidebar.html'), /sync-math\.js[\s\S]*sidebar\.js/);
});
