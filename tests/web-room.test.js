// Tests for the web room: the pure helpers, plus the real app.js + browse.js running in a sandbox with a fake page,
// fake network and fake YouTube player.   Run with:  node --test tests/web-room.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '../server-spring/src/main/resources/static/app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
const SY = require(path.join(APP, 'yt-search.js'));

// ================================================================ pure helpers
test('parseYT understands the link shapes people actually paste on a phone', () => {
  const id = 'dQw4w9WgXcQ';
  [id, 'https://www.youtube.com/watch?v=' + id, 'https://m.youtube.com/watch?v=' + id + '&t=42s', 'https://youtu.be/' + id,
    'https://youtu.be/' + id + '?si=AbCdEf', 'https://www.youtube.com/shorts/' + id, 'https://www.youtube.com/embed/' + id,
    'https://www.youtube.com/live/' + id + '?feature=share', 'https://music.youtube.com/watch?v=' + id + '&list=RDAMVM' + id,
    'https://www.youtube.com/watch?feature=share&v=' + id, 'youtube.com/watch?v=' + id, 'youtu.be/' + id, '  https://youtu.be/' + id + '  ',
    'Check this out https://youtu.be/' + id + ' so good', '(https://youtu.be/' + id + ')']
    .forEach(x => assert.equal(SY.parseYT(x), id, 'failed on: ' + x));
});

test('parseYT says no to things that are not a single video', () => {
  ['', null, undefined, 'lofi beats', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/',
    'https://www.youtube.com/playlist?list=PL1234567890', 'https://www.youtube.com/@somechannel', 'https://youtu.be/short',
    'https://www.youtube.com/watch?v=tooshort', 'dQw4w9WgXcQextra']
    .forEach(x => assert.equal(SY.parseYT(x), null, 'should be null: ' + x));
});

test('playlist and channel links', () => {
  assert.equal(SY.parsePlaylist('https://www.youtube.com/playlist?list=PLabcdefghij'), 'PLabcdefghij');
  assert.equal(SY.parsePlaylist('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij'), 'PLabcdefghij');
  assert.equal(SY.parsePlaylist('https://youtu.be/dQw4w9WgXcQ'), null);
  assert.equal(SY.parsePlaylist('https://example.com/?list=PLabcdefghij'), null);
  assert.equal(SY.parseChannel('https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw'), 'UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(SY.parseChannel('https://www.youtube.com/@somechannel'), null);
  assert.equal(SY.parseChannel('https://www.youtube.com/channel/UCshort'), null);
});

test('numbers and times look like YouTube', () => {
  assert.deepEqual([0, 45, 65, 600, 3723, 'x'].map(SY.fmtDuration), ['', '0:45', '1:05', '10:00', '1:02:03', '']);
  assert.deepEqual([0, 999, 1234, 9999, 12345, 123456, 1500000, 12000000, 2e9].map(SY.fmtCount), ['0', '999', '1.2K', '9.9K', '12K', '123K', '1.5M', '12M', '2B']);
  const now = Date.parse('2026-11-01T10:00:00Z');
  assert.equal(SY.timeAgo('2026-11-01T09:59:30Z', now), 'just now');
  assert.equal(SY.timeAgo('2026-11-01T09:59:00Z', now), '1 minute ago');
  assert.equal(SY.timeAgo('2026-11-01T07:00:00Z', now), '3 hours ago');
  assert.equal(SY.timeAgo('2026-10-30T10:00:00Z', now), '2 days ago');
  assert.equal(SY.timeAgo('2026-10-18T10:00:00Z', now), '2 weeks ago');
  assert.equal(SY.timeAgo('2026-08-01T10:00:00Z', now), '3 months ago');
  assert.equal(SY.timeAgo('2024-11-01T10:00:00Z', now), '2 years ago');
  assert.equal(SY.timeAgo('garbage', now), '');
});

test('channel colour and initial are steady', () => {
  assert.equal(SY.colorFor('Aisha'), SY.colorFor('Aisha'));
  assert.notEqual(SY.colorFor('Aisha'), SY.colorFor('Sam'));
  assert.equal(SY.initialOf('  sam'), 'S');
  assert.equal(SY.initialOf(''), '?');
});

test('pictures may only come from YouTube image hosts', () => {
  assert.ok(SY.safeThumb('https://i.ytimg.com/vi/x/mqdefault.jpg'));
  assert.ok(SY.safeThumb('https://yt3.ggpht.com/abc'));
  assert.equal(SY.safeThumb('https://evil.example/x.jpg'), '');
  assert.equal(SY.safeThumb('http://i.ytimg.com/x.jpg'), '');
  assert.equal(SY.safeThumb('javascript:alert(1)'), '');
  assert.equal(SY.safeThumb(null), '');
});

test('cleanItems keeps only well-formed rows of each kind', () => {
  const ch = 'UC' + 'a'.repeat(22);
  const out = SY.cleanItems([
    { kind: 'video', id: 'aaaaaaaaaaa', title: 'T'.repeat(500), channel: 'c', channelId: ch, dur: 99999999, views: 12, published: '2026-10-30T10:00:00Z', live: true },
    { id: 'bad id!', title: 'dropped' }, null, 'junk', { kind: 'video', id: 'bbbbbbbbbbb', channelId: 'nope', published: 'yesterday', live: 'yes' },
    { kind: 'channel', id: ch, title: 'Chan', handle: '@chan', thumb: 'https://yt3.ggpht.com/x', subs: -1, videos: 5 },
    { kind: 'channel', id: 'UCshort', title: 'dropped' },
    { kind: 'playlist', id: 'PLabcdefghij', title: 'List', channel: 'c', count: 7, thumb: 'https://evil.example/p.jpg' },
    { kind: 'playlist', id: 'x', title: 'dropped' }
  ]);
  assert.equal(out.length, 4);
  assert.equal(out[0].title.length, 120);
  assert.equal(out[0].dur, 43200);
  assert.equal(out[0].channelId, ch);
  assert.equal(out[1].channelId, '');
  assert.equal(out[1].published, '');
  assert.equal(out[1].live, false, 'only a real boolean true counts');
  assert.equal(out[2].subs, -1);
  assert.equal(out[2].handle, '@chan');
  assert.equal(out[3].thumb, '', 'picture from a foreign host is dropped');
  assert.deepEqual(SY.cleanItems('nope'), []);
  assert.equal(SY.cleanItems(Array.from({ length: 80 }, (_, i) => ({ id: String(i).padStart(11, 'a') }))).length, 50);
});

test('queueItem and addRecent', () => {
  assert.deepEqual(SY.queueItem({ id: 'aaaaaaaaaaa', title: 'T', channel: 'C', dur: 5, views: 99, extra: 1 }), { id: 'aaaaaaaaaaa', title: 'T', channel: 'C', dur: 5 });
  assert.deepEqual(SY.addRecent(['b', 'a'], ' A '), ['A', 'b']);
  assert.deepEqual(SY.addRecent(['1', '2', '3'], '4', 3), ['4', '1', '2']);
  assert.deepEqual(SY.addRecent(null, 'x'), ['x']);
});

// ================================================================ the real page in a sandbox
class El {
  constructor(tag, id, doc) {
    this.tag = tag; this.id = id; this.doc = doc; this.children = []; this._text = ''; this.value = ''; this.style = {};
    this.listeners = {}; this.set = new Set(); this.scrollTop = 0; this.scrollHeight = 0; this.onclick = null; this.disabled = false;
    this.classList = {
      add: (...c) => c.forEach(x => this.set.add(x)), remove: (...c) => c.forEach(x => this.set.delete(x)),
      contains: c => this.set.has(c),
      toggle: (c, f) => { const on = f === undefined ? !this.set.has(c) : !!f; if (on) this.set.add(c); else this.set.delete(c); return on; }
    };
  }
  set className(v) { this.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.set].join(' '); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(v) { this._text = ''; this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.children.push(typeof c === 'string' ? Object.assign(new El('#text', '', this.doc), { _text: c }) : c)); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  focus() { this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  click() { const r = this.onclick && this.onclick({ target: this }); (this.listeners.click || []).forEach(f => f({ target: this })); return r; }
  all() { return [this, ...this.children.flatMap(c => (c.all ? c.all() : []))]; }
  find(pred) { return this.all().find(pred); }
  byClass(cls) { return this.all().filter(e => e.set.has(cls)); }
  get hidden() { return this.set.has('hidden'); }
}

class FakePlayer {
  constructor(el, opts) { this.opts = opts; this.videoId = opts.videoId; this.state = -1; this.time = 0; this.rate = 1; this.loads = []; FakePlayer.last = this; }
  ready() { this.opts.events.onReady(); }
  getPlayerState() { return this.state; } getCurrentTime() { return this.time; } getDuration() { return 200; } getPlaybackRate() { return this.rate; }
  setPlaybackRate(r) { this.rate = r; } seekTo(t) { this.time = t; } pauseVideo() { this.state = 2; }
  playVideo() { if (!FakePlayer.blockAutoplay) this.state = 1; }
  loadVideoById(o) { this.videoId = o.videoId; this.loads.push(o); if (!FakePlayer.blockAutoplay) this.state = 1; }
}

const idOf = c => c.repeat(11);
const CH = 'UC' + 'a'.repeat(22);
const vid = (c, extra) => ({ kind: 'video', id: idOf(c), title: 'Title ' + c, channel: 'Chan', channelId: CH, dur: 125, views: 1234567, published: '2026-10-30T10:00:00Z', live: false, ...extra });
const OKJSON = body => ({ ok: true, status: 200, json: async () => body });
const ERRJSON = (status, error, message) => ({ ok: false, status, json: async () => ({ error, message }) });

// routes: array of [string-or-regexp, response-or-function]. The first match wins. Anything else gets an empty list.
function boot(opts) {
  opts = opts || {};
  FakePlayer.blockAutoplay = !!opts.blockAutoplay; FakePlayer.last = null;
  const els = {}, timers = [], sockets = [], store = {}, copied = [];
  const doc = { hidden: false, title: '', activeElement: null, head: { appendChild() {} }, listeners: {} };
  doc.addEventListener = (t, f) => { (doc.listeners[t] = doc.listeners[t] || []).push(f); };
  doc.getElementById = id => (els[id] = els[id] || new El('div', id, doc));
  doc.createElement = tag => new El(tag, '', doc);
  ['search', 'page', 'help', 'actions', 'toast', 'unlock', 'emoji-panel', 'members', 'room', 'pane-queue', 'pane-chat', 'chat-dot', 'queue-count', 'next-btn', 'now-chan', 'feed-more', 'page-more', 'queue-clear', 'chat-dot']
    .forEach(id => doc.getElementById(id).set.add('hidden'));                                  // hidden in the real HTML
  class WS { constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); } send(m) { this.sent.push(JSON.parse(m)); } }
  const fetched = [];
  const routes = opts.routes || [];
  const sb = {
    document: doc, console, URL, URLSearchParams, JSON, Math, Date, Promise, Number, String, Array, Set, Map, RegExp, Object, isNaN, Error,
    location: { search: '', protocol: 'http:', host: 'x.test', origin: 'http://x.test', href: 'http://x.test/app/index.html' },
    history: { replaceState() {} }, confirm: () => true, prompt: () => null,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    navigator: { clipboard: { readText: async () => opts.clip || '', writeText: async t => { copied.push(t); } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, done: false }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].done = true; },
    setInterval: () => 1, clearInterval() {},
    WebSocket: WS, YT: { Player: FakePlayer },
    fetch: async url => {
      fetched.push(url);
      for (const [match, resp] of routes) {
        if (typeof match === 'string' ? url === match : match.test(url)) return typeof resp === 'function' ? resp(url) : resp;
      }
      return OKJSON({ items: [], next: null, left: 5000, searches: 40 });
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  ['sync-math.js', 'yt-search.js', 'app.js', 'browse.js'].forEach(f => vm.runInContext(read(f), sb));

  const $ = id => doc.getElementById(id);
  $('name').value = 'Tester';
  $('create').click();                                         // creates a room and connects
  const ws = sockets[0];
  ws.onopen();
  const hear = o => ws.onmessage({ data: JSON.stringify(o) });
  hear({ t: 'welcome', id: '5', others: 1 });
  hear({ t: 'members', list: [{ id: '5', name: 'Tester', icon: '😎' }, { id: '9', name: 'Aisha', icon: '🦊' }] });
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  const sent = () => ws.sent.map(m => m.data).filter(Boolean);
  const qops = () => ws.sent.filter(m => m.t === 'q');
  const chat = () => $('chat').children.map(c => c.textContent);
  const runTimers = ms => { timers.filter(t => !t.done && t.ms === ms).forEach(t => { t.done = true; t.fn(); }); };
  const type = async text => { $('search-input').value = text; $('search-form').listeners.submit[0]({ preventDefault() {} }); await settle(); };
  const action = label => { const b = $('actions').find(e => e.set.has('action') && e.textContent.includes(label)); assert.ok(b, 'no menu item: ' + label); b.click(); };
  const card = (container, i) => container.children[i];
  const main = c => c.find(e => e.set.has('vmain'));
  const more = c => c.find(e => e.set.has('vmore'));
  return { $, hear, sent, qops, chat, fetched, type, runTimers, doc, ws, settle, action, card, main, more, copied };
}

const FEED = [
  ['/api/trending?cat=', OKJSON({ items: [vid('a'), vid('b')], next: 'TOK1' })],
  ['/api/trending?cat=10', OKJSON({ items: [vid('c')], next: null })],
  ['/api/trending?cat=&page=TOK1', OKJSON({ items: [vid('b'), vid('d')], next: null })]
];

// ---------------------------------------------------------------- home feed
test('the home feed loads when the room starts and looks like YouTube cards', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  assert.deepEqual(t.fetched, ['/api/trending?cat=']);
  const feed = t.$('feed');
  assert.equal(feed.children.length, 2);
  const first = t.card(feed, 0).textContent;
  assert.match(first, /Title a/);
  assert.match(first, /2:05/);                       // duration badge
  assert.match(first, /1\.2M views/);
  assert.match(first, /Chan/);
  assert.match(first, /ago/);
  const img = t.card(feed, 0).find(e => e.tag === 'img' && e.src);
  assert.equal(img.src, 'https://i.ytimg.com/vi/' + idOf('a') + '/hqdefault.jpg');
  assert.ok(!t.$('feed-more').hidden, '"Show more" is offered');
});

test('categories switch the feed; coming back does not ask again; "Show more" adds without duplicates', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  const chip = label => t.$('cat-chips').children.find(c => c.textContent === label);
  chip('Music').click(); await t.settle();
  assert.ok(t.fetched.includes('/api/trending?cat=10'));
  assert.equal(t.$('feed').children.length, 1);
  assert.ok(chip('Music').set.has('on') && !chip('All').set.has('on'));
  const n = t.fetched.length;
  chip('All').click(); await t.settle();
  assert.equal(t.fetched.length, n, 'cached');
  assert.equal(t.$('feed').children.length, 2);
  t.$('feed-more').click(); await t.settle();
  assert.ok(t.fetched.includes('/api/trending?cat=&page=TOK1'));
  assert.equal(t.$('feed').children.length, 3, 'the duplicate video is not added twice');
  assert.ok(t.$('feed-more').hidden);
});

test('a server without a YouTube key explains itself in the feed', async () => {
  const t = boot({ routes: [[/\/api\/trending/, ERRJSON(503, 'not_configured', 'Browse and search are not set up on this server yet. You can still paste a YouTube link.')]] });
  await t.settle();
  assert.match(t.$('feed-note').textContent, /not set up/);
  assert.ok(t.$('feed-note').set.has('bad'));
  assert.equal(t.$('feed').children.length, 0);
});

// ---------------------------------------------------------------- playing, the ⋮ menu, the now-playing bar
test('tapping a card plays it for everyone and fills the now-playing bar', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.main(t.card(t.$('feed'), 0)).click();
  const load = t.sent().find(d => d.kind === 'load');
  assert.equal(load.id, idOf('a'));
  assert.equal(load.title, 'Title a');
  assert.equal(load.channel, 'Chan');
  assert.equal(load.channelId, CH);
  assert.equal(load.playing, true);
  assert.equal(FakePlayer.last.videoId, idOf('a'));
  assert.equal(t.$('now-title').textContent, 'Title a');
  assert.equal(t.$('now-chan').textContent, 'Chan');
  assert.ok(!t.$('now-chan').hidden && !t.$('now-chan').disabled);
  assert.ok(t.chat().includes('You are playing: Title a'));
});

test('the ⋮ menu: play next, add to the queue, go to the channel', async () => {
  const t = boot({ routes: [...FEED, [/\/api\/channel/, OKJSON({ channel: { kind: 'channel', id: CH, title: 'Chan', handle: '@chan', thumb: 'https://yt3.ggpht.com/x', subs: 12345, videos: 40, desc: '' }, items: [vid('e'), vid('f')], next: null })]] });
  await t.settle();
  t.more(t.card(t.$('feed'), 0)).click();
  assert.ok(!t.$('actions').hidden);
  ['Play now', 'Play next', 'Add to the queue', 'Go to channel'].forEach(l => assert.ok(t.$('actions').find(e => e.set.has('action') && e.textContent.includes(l)), l));
  t.action('Add to the queue');
  assert.ok(t.$('actions').hidden, 'menu closes after a choice');
  assert.deepEqual(t.qops().pop(), { t: 'q', op: 'add', item: { id: idOf('a'), title: 'Title a', channel: 'Chan', dur: 125 } });
  assert.equal(t.$('toast').textContent, 'Added to the queue');
  t.more(t.card(t.$('feed'), 1)).click();
  t.action('Play next');
  assert.equal(t.qops().pop().op, 'next');
  t.more(t.card(t.$('feed'), 0)).click();
  t.action('Go to channel');
  await t.settle();
  assert.ok(t.fetched.includes('/api/channel?id=' + CH));
  assert.ok(!t.$('page').hidden);
});

// ---------------------------------------------------------------- channel and playlist pages
test('a channel page shows who it is, lists videos, and "Play all" starts the first and queues the rest', async () => {
  const t = boot({
    routes: [...FEED, [/\/api\/channel\?id=.*&page=P2/, OKJSON({ items: [vid('g')], next: null })],
      [/\/api\/channel/, OKJSON({ channel: { kind: 'channel', id: CH, title: 'Chan', handle: '@chan', thumb: 'https://yt3.ggpht.com/x', subs: 12345, videos: 40, desc: '' }, items: [vid('e'), vid('f')], next: 'P2' })]]
  });
  await t.settle();
  t.more(t.card(t.$('feed'), 0)).click(); t.action('Go to channel'); await t.settle();
  assert.equal(t.$('page-title').textContent, 'Chan');
  assert.match(t.$('page-info').textContent, /@chan/);
  assert.match(t.$('page-info').textContent, /12K subscribers/);
  assert.equal(t.$('page-list').children.length, 2);
  assert.ok(!t.$('page-more').hidden);
  t.$('page-more').click(); await t.settle();
  assert.equal(t.$('page-list').children.length, 3);
  const playAll = t.$('page-info').find(e => e.tag === 'button' && e.textContent.includes('Play all'));
  playAll.click();
  assert.equal(t.sent().find(d => d.kind === 'load').id, idOf('e'));
  const rep = t.qops().find(m => m.op === 'replace');
  assert.deepEqual(rep.items.map(i => i.id), [idOf('f'), idOf('g')]);
  assert.ok(t.$('page').hidden, 'pages close so the video is visible');
});

test('pages stack: Back returns to the previous page without asking the server again', async () => {
  const t = boot({
    routes: [...FEED, [/\/api\/playlist/, OKJSON({ playlist: { kind: 'playlist', id: 'PLabcdefghij', title: 'My list', channel: 'Chan', count: 2 }, items: [vid('e')], next: null })],
      [/\/api\/channel/, OKJSON({ channel: { kind: 'channel', id: CH, title: 'Chan', handle: '', subs: 5, videos: 1 }, items: [vid('f')], next: null })]]
  });
  await t.settle();
  t.more(t.card(t.$('feed'), 0)).click(); t.action('Go to channel'); await t.settle();
  t.$('search-input').value = 'https://www.youtube.com/playlist?list=PLabcdefghij';
  t.$('search-form').listeners.submit[0]({ preventDefault() {} }); await t.settle();
  assert.equal(t.$('page-title').textContent, 'My list');
  const n = t.fetched.length;
  t.$('page-back').click();
  assert.equal(t.$('page-title').textContent, 'Chan');
  assert.equal(t.fetched.length, n);
  t.$('page-back').click();
  assert.ok(t.$('page').hidden);
});

test('a page that fails shows the reason; a private playlist is explained', async () => {
  const t = boot({ routes: [...FEED, [/\/api\/playlist/, ERRJSON(404, 'not_found', 'That playlist was not found (it may be private).')]] });
  await t.settle();
  t.$('paste-btn').onclick = t.$('paste-btn').onclick;           // (paste is covered elsewhere)
  t.$('search-open').click();
  await t.type('https://www.youtube.com/playlist?list=PLabcdefghij');
  assert.match(t.$('page-note').textContent, /may be private/);
  assert.ok(t.$('page-note').set.has('bad'));
});

// ---------------------------------------------------------------- search
const LOFI = [vid('a', { title: 'Lofi <b>beats</b> & chill' }), vid('b', { live: true, dur: 0 }), { id: 'not valid!!', title: 'dropped' }];

test('typing a search calls the server once and shows safe, valid results', async () => {
  const t = boot({ routes: [...FEED, [/\/api\/search/, OKJSON({ items: LOFI, left: 5000, searches: 49 })]] });
  await t.settle();
  t.$('search-open').click();
  assert.ok(!t.$('search').hidden);
  assert.equal(t.doc.activeElement, t.$('search-input'), 'keyboard opens inside the tap');
  await t.type('  lofi   beats ');
  assert.ok(t.fetched.includes('/api/search?q=lofi%20beats&type=video'));
  const rows = t.$('search-results').children;
  assert.equal(rows.length, 2, 'the row with a bad id is dropped');
  assert.equal(rows[0].find(e => e.set.has('vtitle')).textContent, 'Lofi <b>beats</b> & chill', 'shown as plain text, never as HTML');
  assert.match(rows[1].textContent, /LIVE/);
  assert.equal(t.doc.activeElement, null, 'keyboard is dismissed so the results are visible');
  assert.equal(t.$('search-note').textContent, '');
});

test('tapping a search result plays it and closes the search', async () => {
  const t = boot({ routes: [...FEED, [/\/api\/search/, OKJSON({ items: LOFI, searches: 49 })]] });
  await t.settle();
  t.$('search-open').click();
  await t.type('lofi');
  t.main(t.card(t.$('search-results'), 0)).click();
  assert.equal(t.sent().find(d => d.kind === 'load').id, idOf('a'));
  assert.ok(t.$('search').hidden);
});

test('Channels and Playlists tabs search that type; results open pages; playlists can be played whole', async () => {
  const t = boot({
    routes: [...FEED,
      [/type=channel/, OKJSON({ items: [{ kind: 'channel', id: CH, title: 'Chan', handle: '@chan', thumb: 'https://yt3.ggpht.com/x', subs: 1500, videos: 3, desc: 'hello' }], searches: 49 })],
      [/type=playlist/, OKJSON({ items: [{ kind: 'playlist', id: 'PLabcdefghij', title: 'My list', channel: 'Chan', count: 2, thumb: 'https://i.ytimg.com/vi/x/mq.jpg' }], searches: 49 })],
      [/\/api\/playlist/, OKJSON({ playlist: { kind: 'playlist', id: 'PLabcdefghij', title: 'My list', channel: 'Chan', count: 2 }, items: [vid('e'), vid('f')], next: null })],
      [/\/api\/channel/, OKJSON({ channel: { kind: 'channel', id: CH, title: 'Chan', handle: '@chan', subs: 1500, videos: 3 }, items: [vid('e')], next: null })]]
  });
  await t.settle();
  t.$('search-open').click();
  t.$('search-input').value = 'chan';
  t.$('st-channel').click(); await t.settle();
  assert.ok(t.fetched.includes('/api/search?q=chan&type=channel'));
  assert.ok(t.$('st-channel').set.has('on') && !t.$('st-video').set.has('on'));
  const row = t.card(t.$('search-results'), 0);
  assert.match(row.textContent, /1\.5K subscribers/);
  t.main(row).click(); await t.settle();
  assert.ok(t.fetched.includes('/api/channel?id=' + CH));
  assert.equal(t.$('page-title').textContent, 'Chan');
  t.$('page-back').click();
  t.$('st-playlist').click(); await t.settle();
  assert.ok(t.fetched.includes('/api/search?q=chan&type=playlist'));
  const prow = t.card(t.$('search-results'), 0);
  assert.match(prow.textContent, /2 videos/);
  t.more(prow).click(); t.action('Play all now'); await t.settle();
  assert.ok(t.fetched.includes('/api/playlist?id=PLabcdefghij'));
  assert.equal(t.sent().find(d => d.kind === 'load').id, idOf('e'));
  assert.deepEqual(t.qops().find(m => m.op === 'replace').items.map(i => i.id), [idOf('f')]);
  assert.ok(t.$('search').hidden);
});

test('"Add all to the queue" on a playlist sends the whole list in one step', async () => {
  const t = boot({ routes: [...FEED, [/type=playlist/, OKJSON({ items: [{ kind: 'playlist', id: 'PLabcdefghij', title: 'My list', channel: 'Chan', count: 2 }], searches: 49 })],
    [/\/api\/playlist/, OKJSON({ playlist: {}, items: [vid('e'), vid('f')], next: null })]] });
  await t.settle();
  t.$('search-open').click();
  t.$('st-playlist').click();
  await t.type('my list');
  t.more(t.card(t.$('search-results'), 0)).click(); t.action('Add all to the queue'); await t.settle();
  const op = t.qops().find(m => m.op === 'addAll');
  assert.deepEqual(op.items.map(i => i.id), [idOf('e'), idOf('f')]);
  assert.equal(t.sent().filter(d => d.kind === 'load').length, 0, 'nothing starts playing');
});

test('pasting a video link into the search box plays it without calling the server', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  const n = t.fetched.length;
  t.$('search-open').click();
  await t.type('Great song https://youtu.be/dQw4w9WgXcQ?si=xyz');
  assert.equal(t.fetched.length, n);
  assert.equal(t.sent().find(d => d.kind === 'load').id, 'dQw4w9WgXcQ');
});

test('the Paste button plays a copied link, opens a copied channel, or falls back to the search box', async () => {
  const a = boot({ routes: FEED, clip: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  await a.settle(); await a.$('paste-btn').click();
  assert.equal(a.sent().find(d => d.kind === 'load').id, 'dQw4w9WgXcQ');

  const b = boot({ routes: [...FEED, [/\/api\/channel/, OKJSON({ channel: { kind: 'channel', id: CH, title: 'Chan', subs: 1, videos: 1 }, items: [], next: null })]], clip: 'https://www.youtube.com/channel/' + CH });
  await b.settle(); await b.$('paste-btn').click(); await b.settle();
  assert.ok(b.fetched.includes('/api/channel?id=' + CH));

  const c = boot({ routes: FEED, clip: 'my shopping list' });
  await c.settle(); await c.$('paste-btn').click();
  assert.equal(c.sent().filter(d => d.kind === 'load').length, 0);
  assert.ok(!c.$('search').hidden);
  assert.match(c.$('search-note').textContent, /no YouTube link/);
});

test('search problems are explained in plain words', async () => {
  const cases = [
    [ERRJSON(429, 'quota_exhausted', "Today's YouTube allowance is used up. You can still paste a YouTube link."), /allowance is used up/],
    [ERRJSON(429, 'rate_limited', 'Too many searches in a row. Try again in a minute.'), /Too many searches/],
    [{ ok: false, status: 502, json: async () => { throw new Error('not json'); } }, /not responding/]
  ];
  for (const [resp, re] of cases) {
    const t = boot({ routes: [...FEED, [/\/api\/search/, resp]] });
    await t.settle();
    t.$('search-open').click();
    await t.type('anything');
    assert.match(t.$('search-note').textContent, re);
    assert.ok(t.$('search-note').set.has('bad'));
  }
  const offline = boot({ routes: [...FEED, [/\/api\/search/, () => { throw new Error('network'); }]] });
  await offline.settle();
  offline.$('search-open').click();
  await offline.type('anything');
  assert.match(offline.$('search-note').textContent, /Couldn't reach the server/);
});

test('short searches never reach the server; empty results say so; a low allowance is shown; a double tap searches once; recent searches return', async () => {
  let release;
  const t = boot({ routes: [...FEED, [/q=jazz/, () => new Promise(r => { release = () => r(OKJSON({ items: [vid('a')], searches: 7 })); })], [/q=zzzz/, OKJSON({ items: [], searches: 40 })]] });
  await t.settle();
  t.$('search-open').click();
  await t.type('a');
  assert.ok(!t.fetched.some(u => u.includes('/api/search')));
  assert.match(t.$('search-note').textContent, /at least 2/);
  await t.type('zzzz');
  assert.match(t.$('search-note').textContent, /Nothing playable/);
  t.$('search-input').value = 'jazz';
  const submit = t.$('search-form').listeners.submit[0];
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  assert.equal(t.fetched.filter(u => u.includes('q=jazz')).length, 1, 'second tap while busy is ignored');
  release(); await t.settle();
  assert.equal(t.$('search-note').textContent, '7 searches left today');
  t.$('search-close').click();
  t.$('search-open').click();
  assert.equal(t.$('search-results').children.length, 1, 'reopening shows the last results without searching again');
  assert.equal(t.fetched.filter(u => u.includes('q=jazz')).length, 1);
});

// ---------------------------------------------------------------- queue
test('the queue screen shows the server list, checks every row, and every button sends the right order', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.hear({ t: 'queue', items: [{ qid: 1, id: idOf('a'), title: 'One', channel: 'C', dur: 60, by: 'Aisha' }, { qid: 2, id: 'bad', title: 'dropped' }, { qid: 3, id: idOf('b'), title: 'Two', channel: 'C', dur: 3700, by: 'Sam' }] });
  assert.equal(t.$('queue-count').textContent, '2');
  assert.ok(!t.$('queue-count').hidden);
  const text = t.$('queue-list').textContent;
  assert.match(text, /One/); assert.match(text, /Two/); assert.match(text, /added by Aisha/); assert.match(text, /1:01:40/);
  assert.doesNotMatch(text, /dropped/);
  const rows = t.$('queue-list').byClass('vcard').filter(r => !r.set.has('now'));
  assert.equal(rows.length, 2);
  t.main(rows[0]).click();
  assert.deepEqual(t.qops().pop(), { t: 'q', op: 'play', qid: 1 });
  t.more(rows[1]).click();
  assert.deepEqual(t.qops().pop(), { t: 'q', op: 'remove', qid: 3 });
  assert.ok(!t.$('queue-clear').hidden);
  t.$('queue-clear').click();
  assert.deepEqual(t.qops().pop(), { t: 'q', op: 'clear' });
  t.hear({ t: 'queue', items: [] });
  assert.ok(t.$('queue-count').hidden && t.$('queue-clear').hidden);
  assert.match(t.$('queue-list').textContent, /Nothing queued yet/);
});

test('"Next" appears only when something plays and the queue has more, and asks the server to advance', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.hear({ t: 'queue', items: [{ qid: 1, id: idOf('c'), title: 'Next one', channel: 'C', dur: 60, by: 'A' }] });
  assert.ok(t.$('next-btn').hidden, 'nothing is playing yet');
  t.main(t.card(t.$('feed'), 0)).click();
  assert.ok(!t.$('next-btn').hidden);
  t.$('next-btn').click();
  assert.deepEqual(t.qops().pop(), { t: 'q', op: 'advance', id: idOf('a') });
  t.hear({ t: 'queue', items: [] });
  assert.ok(t.$('next-btn').hidden);
  assert.match(t.$('queue-list').textContent, /Now playing/);
});

test('when the video really ends the phone asks the server for the next one; an ad ending or a mid-video stop does not', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.main(t.card(t.$('feed'), 0)).click();
  const p = FakePlayer.last;
  p.ready();
  p.time = 10;
  p.opts.events.onStateChange({ data: 0 });
  assert.equal(t.qops().length, 0, 'ended far from the end of the video: not a real ending');
  p.time = 198;
  p.opts.events.onStateChange({ data: 0 });
  assert.deepEqual(t.qops(), [{ t: 'q', op: 'advance', id: idOf('a') }]);
});

test('the server\'s own loads and notices are explained in the chat and update the title bar', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.hear({ t: 'msg', from: '0', data: { kind: 'load', id: idOf('c'), title: 'Up next song', channel: 'Some Chan', time: 0, playing: true, rate: 1, note: '⏭ Up next: Up next song' } });
  assert.ok(t.chat().includes('⏭ Up next: Up next song'));
  assert.equal(FakePlayer.last.videoId, idOf('c'));
  assert.equal(t.$('now-title').textContent, 'Up next song');
  assert.equal(t.$('now-chan').textContent, 'Some Chan');
  assert.ok(t.$('now-chan').disabled, 'no channel link when the server did not send an id');
  t.hear({ t: 'notice', text: '➕ Aisha added to the queue: Song' });
  assert.ok(t.chat().includes('➕ Aisha added to the queue: Song'));
  t.hear({ t: 'notice', text: 'x'.repeat(500) });
  assert.equal(t.chat().pop().length, 200);
  t.hear({ t: 'notice', text: 42 });
});

test('when a friend starts a video you see its title; a replay of the same video is not announced twice', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.hear({ t: 'msg', from: '9', data: { kind: 'load', id: idOf('a'), title: 'Lofi mix', channel: 'C', channelId: CH, time: 0, playing: true, rate: 1 } });
  assert.ok(t.chat().includes('Aisha is playing: Lofi mix'));
  assert.ok(!t.$('now-chan').disabled);
  t.hear({ t: 'msg', from: '9', data: { kind: 'load', id: idOf('a'), time: 5, playing: true, rate: 1 } });
  assert.equal(t.chat().filter(x => x.startsWith('Aisha is playing')).length, 1);
  assert.equal(t.$('now-title').textContent, 'Lofi mix', 'a replay without details keeps the title');
});

// ---------------------------------------------------------------- tabs, iPhone, help
test('tabs switch panes; a chat message while you are elsewhere lights the red dot', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  assert.ok(!t.$('pane-browse').hidden && t.$('pane-queue').hidden && t.$('pane-chat').hidden);
  t.hear({ t: 'msg', from: '9', data: { kind: 'chat', text: 'hello' } });
  assert.ok(!t.$('chat-dot').hidden);
  t.$('tab-chat').click();
  assert.ok(t.$('pane-browse').hidden && !t.$('pane-chat').hidden && t.$('chat-dot').hidden);
  assert.ok(t.$('tab-chat').set.has('on') && !t.$('tab-browse').set.has('on'));
  t.$('tab-queue').click();
  assert.ok(!t.$('pane-queue').hidden && t.$('pane-chat').hidden);
  t.$('members-btn').click();
  assert.ok(!t.$('pane-chat').hidden, 'the members button takes you to the chat tab');
});

test('iPhone fallback: if the video has not started after a few seconds the tap-to-start button appears', async () => {
  const t = boot({ blockAutoplay: true, routes: FEED });
  await t.settle();
  t.hear({ t: 'msg', from: '9', data: { kind: 'load', id: idOf('a'), time: 0, playing: true, rate: 1 } });
  FakePlayer.last.ready();
  t.$('unlock').set.add('hidden');
  t.runTimers(3500);
  assert.ok(!t.$('unlock').hidden, 'tap-to-start is shown again');
  t.$('unlock').click();
  assert.ok(t.$('unlock').hidden);
});

test('no fallback button when playback started fine', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.hear({ t: 'msg', from: '9', data: { kind: 'load', id: idOf('a'), time: 0, playing: true, rate: 1 } });
  FakePlayer.last.ready();
  t.$('unlock').set.add('hidden');
  t.runTimers(3500);
  assert.ok(t.$('unlock').hidden);
});

test('the iPhone share help shows this server\'s address and this room\'s code, with copy buttons', async () => {
  const t = boot({ routes: FEED });
  await t.settle();
  t.$('help-btn').click();
  assert.ok(!t.$('help').hidden);
  const text = t.$('help-body').textContent;
  assert.match(text, /http:\/\/x\.test\/api\/share/);
  assert.match(text, /Shortcuts/);
  assert.match(text, /Show in Share Sheet/);
  assert.match(text, /Request Body to JSON/);
  const code = t.$('room-code').textContent;
  assert.ok(code && text.includes(code));
  const copyBtns = t.$('help-body').all().filter(e => e.tag === 'button' && e.textContent === 'Copy');
  assert.equal(copyBtns.length, 3);
  copyBtns[0].click(); await t.settle();
  assert.deepEqual(t.copied, ['http://x.test/api/share']);
  t.$('help-close').click();
  assert.ok(t.$('help').hidden);
});

test('the page wires up: every id the scripts use exists, and scripts load in the right order', () => {
  const html = read('index.html');
  const js = read('app.js') + read('browse.js');
  const used = new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]));
  ['st-video', 'st-channel', 'st-playlist', 'pane-browse', 'pane-queue', 'pane-chat', 'tab-browse', 'tab-queue', 'tab-chat'].forEach(i => used.add(i));
  const missing = [...used].filter(i => !html.includes('id="' + i + '"'));
  assert.deepEqual(missing, []);
  const pos = n => html.indexOf('/app/' + n);
  assert.ok(pos('sync-math.js') > 0 && pos('sync-math.js') < pos('yt-search.js') && pos('yt-search.js') < pos('app.js') && pos('app.js') < pos('browse.js'));
});
