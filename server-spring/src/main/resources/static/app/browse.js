// The YouTube-style screens of the web room: home feed, search, channel / playlist pages, the ⋮ menu, the queue and the iPhone-share help.
// app.js (loaded first) owns the connection and the player; this file talks to it through window.ShaanRoom.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SY = window.ShaanYT, R = window.ShaanRoom;
  if (!SY || !R) return;

  const ls = {
    get: (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const enc = encodeURIComponent;
  const TOKEN = /^[\w-]{1,100}$/;
  const CATS = [['All', ''], ['Music', '10'], ['Gaming', '20'], ['Movies', '1'], ['Entertainment', '24'], ['Comedy', '23'], ['News', '25'], ['Sports', '17'], ['Tech', '28']];

  // ---------------------------------------------------------------- small helpers
  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  async function getJSON(path) {
    const res = await fetch(path, { headers: { 'ngrok-skip-browser-warning': '1' } });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || !data || data.error) {
      const err = new Error('api');
      err.userMessage = (data && typeof data.message === 'string' && data.message) || 'YouTube is not responding right now. You can still paste a link.';
      throw err;
    }
    return data;
  }
  const friendly = e => (e && e.userMessage) || "Couldn't reach the server. Check your connection.";
  const nextToken = d => (typeof d.next === 'string' && TOKEN.test(d.next) ? d.next : null);

  // ---------------------------------------------------------------- cards
  const thumbUrl = (id, big) => 'https://i.ytimg.com/vi/' + id + '/' + (big ? 'hqdefault' : 'mqdefault') + '.jpg';   // built from a checked id, never from server text
  function avatar(name, src) {
    const a = el('div', 'avatar');
    if (src) { const i = el('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; a.appendChild(i); }
    else { a.textContent = SY.initialOf(name); a.style.background = SY.colorFor(name); }
    return a;
  }
  function thumbBox(src, badge, badgeClass) {
    const t = el('div', 'thumb');
    const i = el('img'); i.src = src; i.alt = ''; i.loading = 'lazy';
    t.appendChild(i);
    if (badge) t.appendChild(el('span', 'badge-dur' + (badgeClass ? ' ' + badgeClass : ''), badge));
    return t;
  }
  const statsLine = v => [v.channel, v.views ? SY.fmtCount(v.views) + ' views' : '', SY.timeAgo(v.published)].filter(Boolean).join(' • ');

  // opts.row = compact row (search, pages, queue); otherwise a big feed card
  function videoCard(v, opts) {
    opts = opts || {};
    const wrap = el('div', 'vcard' + (opts.row ? ' row' : ''));
    const main = el('button', 'vmain'); main.type = 'button';
    const th = thumbBox(thumbUrl(v.id, !opts.row), v.live ? 'LIVE' : SY.fmtDuration(v.dur), v.live ? 'live' : '');
    const info = el('div', 'vinfo');
    if (!opts.row) info.appendChild(avatar(v.channel));
    const txt = el('div', 'vtext');
    txt.append(el('div', 'vtitle', v.title), el('div', 'vsub', statsLine(v)));
    info.appendChild(txt);
    main.append(th, info);
    main.onclick = () => playNow(v);
    const more = el('button', 'vmore', '⋮'); more.type = 'button'; more.title = 'More';
    more.onclick = () => openActions(v.title, videoActions(v));
    wrap.append(main, more);
    return wrap;
  }
  function channelRow(c) {
    const wrap = el('div', 'vcard row chan');
    const main = el('button', 'vmain'); main.type = 'button';
    const info = el('div', 'vinfo');
    const txt = el('div', 'vtext');
    const subs = c.subs === -1 ? '' : SY.fmtCount(c.subs) + ' subscribers';
    txt.append(el('div', 'vtitle', c.title), el('div', 'vsub', [c.handle, subs].filter(Boolean).join(' • ')), el('div', 'vsub dim', c.desc));
    const av = avatar(c.title, c.thumb); av.classList.add('big');
    info.append(av, txt);
    main.appendChild(info);
    main.onclick = () => openChannel(c.id, c.title);
    wrap.appendChild(main);
    return wrap;
  }
  function playlistRow(p) {
    const wrap = el('div', 'vcard row');
    const main = el('button', 'vmain'); main.type = 'button';
    const th = thumbBox(p.thumb || '', p.count ? p.count + ' videos' : '', 'list');
    const info = el('div', 'vinfo');
    const txt = el('div', 'vtext');
    txt.append(el('div', 'vtitle', p.title), el('div', 'vsub', p.channel), el('div', 'vsub dim', 'Playlist'));
    info.appendChild(txt);
    main.append(th, info);
    main.onclick = () => openPlaylist(p.id, p.title);
    const more = el('button', 'vmore', '⋮'); more.type = 'button'; more.title = 'More';
    more.onclick = () => openActions(p.title, [
      { label: '▶  Play all now', run: () => bulk(p.id, 'play') },
      { label: '➕  Add all to the queue', run: () => bulk(p.id, 'add') },
      { label: '📂  Open playlist', run: () => openPlaylist(p.id, p.title) }
    ]);
    wrap.append(main, more);
    return wrap;
  }
  const renderItem = (it, row) => (it.kind === 'channel' ? channelRow(it) : it.kind === 'playlist' ? playlistRow(it) : videoCard(it, { row }));

  // ---------------------------------------------------------------- playing and queueing
  function closeOverlays() {
    $('search').classList.add('hidden');
    $('page').classList.add('hidden');
    $('help').classList.add('hidden');
    stack.length = 0;
    $('search-input').blur();
  }
  function playNow(v) {
    closeOverlays();
    R.play(v);
  }
  function videoActions(v) {
    return [
      { label: '▶  Play now', run: () => playNow(v) },
      { label: '⏭  Play next', run: () => { R.queueOp('next', { item: SY.queueItem(v) }); toast('Will play next'); } },
      { label: '➕  Add to the queue', run: () => { R.queueOp('add', { item: SY.queueItem(v) }); toast('Added to the queue'); } },
      v.channelId ? { label: '👤  Go to channel', run: () => openChannel(v.channelId, v.channel) } : null
    ].filter(Boolean);
  }
  // a whole playlist: fetch up to 50 videos, then play them or queue them
  async function bulk(playlistId, mode) {
    toast('Loading the playlist…');
    try {
      let items = [], page = '';
      for (let i = 0; i < 3; i++) {
        const d = await getJSON('/api/playlist?id=' + enc(playlistId) + (page ? '&page=' + enc(page) : ''));
        items = items.concat(SY.cleanItems(d.items));
        page = nextToken(d);
        if (!page || items.length >= 50) break;
      }
      items = items.filter(i => i.kind === 'video').slice(0, 50);
      if (!items.length) return toast('No playable videos in that playlist.');
      bulkApply(items, mode);
    } catch (e) { toast(friendly(e)); }
  }
  function bulkApply(items, mode) {
    if (mode === 'play') {
      closeOverlays();
      R.play(items[0]);
      R.queueOp('replace', { items: items.slice(1).map(SY.queueItem) });
      toast('Playing ' + items.length + ' videos');
    } else {
      R.queueOp('addAll', { items: items.map(SY.queueItem) });
      toast('Added ' + items.length + ' videos to the queue');
    }
  }

  // ---------------------------------------------------------------- the ⋮ menu (bottom sheet)
  function closeActions() { $('actions').classList.add('hidden'); }
  function openActions(title, actions) {
    const box = $('actions');
    box.textContent = '';
    const sheet = el('div', 'action-sheet');
    sheet.appendChild(el('div', 'action-title', title));
    actions.forEach(a => {
      const b = el('button', 'action', a.label); b.type = 'button';
      b.onclick = () => { closeActions(); a.run(); };
      sheet.appendChild(b);
    });
    const c = el('button', 'action cancel', 'Cancel'); c.type = 'button';
    c.onclick = closeActions;
    sheet.appendChild(c);
    box.appendChild(sheet);
    box.onclick = e => { if (e && e.target === box) closeActions(); };      // a tap on the dark area closes it
    box.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- home feed
  const feeds = {};                 // category id -> { items, next, loaded, busy }
  let cat = '';
  const feedNote = (t, bad) => { const n = $('feed-note'); n.textContent = t || ''; n.classList.toggle('bad', !!bad); };

  function renderCats() {
    const box = $('cat-chips');
    box.textContent = '';
    CATS.forEach(([label, id]) => {
      const b = el('button', 'chip' + (id === cat ? ' on' : ''), label); b.type = 'button';
      b.onclick = () => selectCat(id);
      box.appendChild(b);
    });
  }
  function renderFeed() {
    const f = feeds[cat];
    const box = $('feed');
    box.textContent = '';
    if (f) f.items.forEach(v => box.appendChild(renderItem(v, false)));
    $('feed-more').classList.toggle('hidden', !(f && f.next));
  }
  function selectCat(id) {
    cat = id;
    renderCats();
    renderFeed();
    const f = feeds[id];
    if (!f || !f.loaded) loadFeed(id, false); else feedNote(f.items.length ? '' : 'Nothing to show here right now.');
  }
  async function loadFeed(forCat, more) {
    const f = feeds[forCat] = feeds[forCat] || { items: [], next: null, loaded: false, busy: false };
    if (f.busy) return;
    f.busy = true;
    if (forCat === cat) feedNote('Loading…');
    try {
      const d = await getJSON('/api/trending?cat=' + enc(forCat) + (more && f.next ? '&page=' + enc(f.next) : ''));
      const items = SY.cleanItems(d.items).filter(i => i.kind === 'video');
      const seen = new Set(more ? f.items.map(i => i.id) : []);
      f.items = (more ? f.items : []).concat(items.filter(i => !seen.has(i.id)));
      f.next = nextToken(d);
      f.loaded = true;
      if (forCat === cat) { renderFeed(); feedNote(f.items.length ? '' : 'Nothing to show here right now.'); }
    } catch (e) {
      if (forCat === cat) feedNote(friendly(e), true);
    } finally { f.busy = false; }
  }
  $('feed-more').onclick = () => loadFeed(cat, true);

  // ---------------------------------------------------------------- search
  let sType = 'video', sBusy = false;
  const sCache = {};                // type -> { q, items }
  let recent = [];
  try { recent = SY.addRecent(JSON.parse(ls.get('sp_recent', '[]')), '', 6); } catch (e) { recent = []; }
  const searchNote = (t, bad) => { const n = $('search-note'); n.textContent = t || ''; n.classList.toggle('bad', !!bad); };

  function renderSearch() {
    const box = $('search-results');
    box.textContent = '';
    const c = sCache[sType];
    if (c) { c.items.forEach(it => box.appendChild(renderItem(it, true))); return; }
    if (!recent.length) return;
    box.appendChild(el('div', 'chips-title', 'Recent searches'));
    const chips = el('div', 'chips');
    recent.forEach(q => {
      const b = el('button', 'chip', q); b.type = 'button';
      b.onclick = () => { $('search-input').value = q; doSearch(); };
      chips.appendChild(b);
    });
    box.appendChild(chips);
  }
  function renderTypes() {
    ['video', 'channel', 'playlist'].forEach(t => $('st-' + t).classList.toggle('on', t === sType));
  }
  function openSearch() {
    $('search').classList.remove('hidden');
    renderTypes();
    renderSearch();
    $('search-input').focus();                 // must happen inside the tap so the iPhone keyboard opens
  }
  function closeSearch() { $('search-input').blur(); $('search').classList.add('hidden'); }

  // a pasted video / playlist / channel link goes straight there. Returns true if it was a link.
  function handleLink(raw) {
    const vid = SY.parseYT(raw);
    if (vid) { playNow({ id: vid, title: '', channel: '' }); return true; }
    const pl = SY.parsePlaylist(raw);
    if (pl) { openPlaylist(pl, ''); return true; }
    const ch = SY.parseChannel(raw);
    if (ch) { openChannel(ch, ''); return true; }
    return false;
  }

  async function doSearch() {
    const raw = $('search-input').value;
    if (handleLink(raw)) return;
    const q = SY.normalizeQuery(raw);
    if (q.length < 2) return searchNote('Type at least 2 letters, or paste a YouTube link.', true);
    if (sBusy) return;
    sBusy = true;
    searchNote('Searching…');
    $('search-input').blur();                  // hides the keyboard so the results are visible
    const type = sType;
    try {
      const d = await getJSON('/api/search?q=' + enc(q) + '&type=' + type);
      sCache[type] = { q, items: SY.cleanItems(d.items).filter(i => i.kind === type) };
      recent = SY.addRecent(recent, q, 6);
      ls.set('sp_recent', JSON.stringify(recent));
      if (type === sType) { renderSearch(); $('search-results').scrollTop = 0; }
      if (!sCache[type].items.length) searchNote('Nothing playable found. Try different words.');
      else searchNote(typeof d.searches === 'number' && d.searches <= 15 ? d.searches + ' searches left today' : '');
    } catch (e) {
      searchNote(friendly(e), true);
    } finally { sBusy = false; }
  }
  function setType(t) {
    sType = t;
    renderTypes();
    const q = SY.normalizeQuery($('search-input').value);
    if (q.length >= 2 && !SY.parseYT(q) && (!sCache[t] || sCache[t].q !== q)) doSearch();   // tapping a tab is a clear request to search
    else renderSearch();
  }
  ['video', 'channel', 'playlist'].forEach(t => { $('st-' + t).onclick = () => setType(t); });
  $('search-open').onclick = openSearch;
  $('search-close').onclick = closeSearch;
  $('search-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });
  $('search-results').addEventListener('scroll', () => { if (document.activeElement === $('search-input')) $('search-input').blur(); }, { passive: true });
  // one-tap paste: a copied YouTube link plays (or opens) straight away
  $('paste-btn').onclick = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) {}
    if (handleLink(text)) return;
    openSearch();
    searchNote(text ? 'The clipboard has no YouTube link. Search instead:' : 'Copy a YouTube link first, or search here.', true);
  };

  // ---------------------------------------------------------------- channel and playlist pages
  const stack = [];                 // pages opened on top of each other; each keeps its own list so Back is instant
  const pageNote = (t, bad) => { const n = $('page-note'); n.textContent = t || ''; n.classList.toggle('bad', !!bad); };
  const topPage = () => stack[stack.length - 1];

  function openChannel(id, title) { openPage('channel', id, title); }
  function openPlaylist(id, title) { openPage('playlist', id, title); }
  function openPage(kind, id, title) {
    stack.push({ kind, id, title: title || '', items: [], next: null, info: null, busy: false });
    showPage();
    loadPage(false);
  }
  function showPage() {
    const s = topPage();
    $('page').classList.remove('hidden');
    $('page-title').textContent = (s.info && s.info.title) || s.title || (s.kind === 'channel' ? 'Channel' : 'Playlist');
    renderPage();
  }
  function pageBack() {
    stack.pop();
    if (stack.length) showPage(); else $('page').classList.add('hidden');
  }
  function renderPage() {
    const s = topPage();
    const info = $('page-info');
    info.textContent = '';
    if (s.info) {
      const head = el('div', 'page-head');
      if (s.kind === 'channel') {
        const av = avatar(s.info.title, s.info.thumb); av.classList.add('huge');
        const t = el('div', 'vtext');
        const subs = s.info.subs === -1 ? '' : SY.fmtCount(s.info.subs) + ' subscribers';
        t.append(el('div', 'vtitle big', s.info.title), el('div', 'vsub', [s.info.handle, subs, s.info.videos ? SY.fmtCount(s.info.videos) + ' videos' : ''].filter(Boolean).join(' • ')));
        head.append(av, t);
      } else {
        const t = el('div', 'vtext');
        t.append(el('div', 'vtitle big', s.info.title), el('div', 'vsub', [s.info.channel, s.info.count ? s.info.count + ' videos' : ''].filter(Boolean).join(' • ')));
        head.appendChild(t);
      }
      info.appendChild(head);
    }
    const vids = s.items.filter(i => i.kind === 'video');
    if (vids.length) {
      const bar = el('div', 'page-actions');
      const play = el('button', 'pill solid', '▶  Play all'); play.type = 'button';
      play.onclick = () => bulkApply(vids.slice(0, 50), 'play');
      const add = el('button', 'pill', '➕  Add all to the queue'); add.type = 'button';
      add.onclick = () => bulkApply(vids.slice(0, 50), 'add');
      bar.append(play, add);
      info.appendChild(bar);
    }
    const list = $('page-list');
    list.textContent = '';
    s.items.forEach(v => list.appendChild(renderItem(v, true)));
    $('page-more').classList.toggle('hidden', !s.next);
  }
  async function loadPage(more) {
    const s = topPage();
    if (!s || s.busy) return;
    s.busy = true;
    pageNote(s.items.length ? '' : 'Loading…');
    try {
      const d = await getJSON('/api/' + s.kind + '?id=' + enc(s.id) + (more && s.next ? '&page=' + enc(s.next) : ''));
      const raw = d.channel || d.playlist;
      if (raw && !more) s.info = SY.cleanItems([raw])[0] || null;
      s.items = s.items.concat(SY.cleanItems(d.items).filter(i => i.kind === 'video'));
      s.next = nextToken(d);
      if (s === topPage()) { showPage(); pageNote(s.items.length ? '' : 'No playable videos here.'); }
    } catch (e) {
      if (s === topPage()) pageNote(friendly(e), true);
    } finally { s.busy = false; }
  }
  $('page-back').onclick = pageBack;
  $('page-more').onclick = () => loadPage(true);

  // ---------------------------------------------------------------- queue screen
  function queueRow(q) {
    const wrap = el('div', 'vcard row');
    const main = el('button', 'vmain'); main.type = 'button';
    const th = thumbBox(thumbUrl(q.id, false), SY.fmtDuration(q.dur), '');
    const info = el('div', 'vinfo');
    const txt = el('div', 'vtext');
    txt.append(el('div', 'vtitle', q.title), el('div', 'vsub', [q.channel, q.by ? 'added by ' + q.by : ''].filter(Boolean).join(' • ')));
    info.appendChild(txt);
    main.append(th, info);
    main.onclick = () => R.queueOp('play', { qid: q.qid });
    const rm = el('button', 'vmore', '✕'); rm.type = 'button'; rm.title = 'Remove';
    rm.onclick = () => R.queueOp('remove', { qid: q.qid });
    wrap.append(main, rm);
    return wrap;
  }
  function renderQueue() {
    const list = R.getQueue(), now = R.getNow();
    const box = $('queue-list');
    box.textContent = '';
    if (now.id) {
      box.appendChild(el('div', 'section', 'Now playing'));
      const row = el('div', 'vcard row now');
      const main = el('div', 'vmain');
      const info = el('div', 'vinfo'), txt = el('div', 'vtext');
      txt.append(el('div', 'vtitle', now.title || 'YouTube video'), el('div', 'vsub', now.channel));
      info.appendChild(txt);
      main.append(thumbBox(thumbUrl(now.id, false), '', ''), info);
      row.appendChild(main);
      box.appendChild(row);
    }
    box.appendChild(el('div', 'section', list.length ? 'Up next (' + list.length + ')' : 'Up next'));
    if (!list.length) box.appendChild(el('div', 'empty-note', 'Nothing queued yet. Tap ⋮ on any video and choose "Add to the queue", and it plays by itself when the current video ends.'));
    list.forEach(q => box.appendChild(queueRow(q)));
    $('queue-clear').classList.toggle('hidden', !list.length);
  }
  R.onQueue(renderQueue);
  R.onNow(renderQueue);
  $('queue-clear').onclick = () => R.queueOp('clear');

  // ---------------------------------------------------------------- iPhone: share from the YouTube app
  function copy(text, what) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(what + ' copied'), () => toast('Could not copy'));
    else toast('Could not copy');
  }
  function openHelp() {
    const body = $('help-body');
    body.textContent = '';
    const server = location.origin + '/api/share';
    const code = R.code() || '';
    const who = R.me().name || 'Me';
    const p = (t, cls) => body.appendChild(el('p', cls || 'help-p', t));
    const copyRow = (label, value) => {
      const row = el('div', 'copyrow');
      row.append(el('span', 'copylabel', label), el('code', 'copyvalue', value));
      const b = el('button', 'pill', 'Copy'); b.type = 'button';
      b.onclick = () => copy(value, label);
      row.appendChild(b);
      body.appendChild(row);
    };
    p('Watch in the real YouTube app (with your own Premium and no ads), then send what you are watching to this room with one tap. Set it up once with the Shortcuts app on your iPhone:');
    p('1. Open Shortcuts, tap + and name the new shortcut "Shaan Party".', 'help-step');
    p('2. Tap the ⓘ (details) button and turn on "Show in Share Sheet". Under Share Sheet Types keep only URLs and Text.', 'help-step');
    p('3. Add the action "Get Contents of URL". Paste this address as the URL:', 'help-step');
    copyRow('Address', server);
    p('4. Tap "Show More" on that action. Set Method to POST and Request Body to JSON. Then add these fields (type Text):', 'help-step');
    copyRow('room', code);
    p('url: tap the value, choose "Shortcut Input".   name: your name.   mode: play (starts for everyone now) or queue (adds to Up next).', 'help-step');
    copyRow('name', who);
    p('5. Done. In the YouTube app tap Share on a video, choose Shortcuts, then "Shaan Party". For a new room, change the room value (or set it to "Ask Each Time").', 'help-step');
    p('The room must be open on at least one phone when you share. Menu names can differ a little between iOS versions.', 'help-note');
    $('help').classList.remove('hidden');
  }
  $('help-btn').onclick = openHelp;
  $('help-close').onclick = () => $('help').classList.add('hidden');

  // ---------------------------------------------------------------- escape key, start-up
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('actions').classList.contains('hidden')) closeActions();
    else if (!$('help').classList.contains('hidden')) $('help').classList.add('hidden');
    else if (!$('page').classList.contains('hidden')) pageBack();
    else if (!$('search').classList.contains('hidden')) closeSearch();
  });

  renderCats();
  renderQueue();
  R.onStart(() => { if (!(feeds[cat] && feeds[cat].loaded)) loadFeed(cat, false); });
  window.ShaanBrowse = { openChannel, openPlaylist };
})();
