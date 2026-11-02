(() => {
  const P = window.ShaanPlatform, M = window.ShaanMath;
  if (!P || !M || window.__shaanParty || window !== window.top) return;
  window.__shaanParty = true;
  const PARAM = 'shaanparty', SIDE = 340, ROOM_RE = /^[\w-]{3,32}$/, BEAT_MS = 4000;
  const keyOf = href => P.pageKey(href);

  let room = null, wrap = null, frame = null, fab = null, badge = null, unread = 0, toastBox = null;
  const attached = new WeakSet();
  let lastSent = null, lastApplied = null, lastReceived = null;
  let video = null, applyUntil = 0, pending = null, lastKey = keyOf(location.href);
  let isLeader = false, nextBeat = 0, beatMismatch = 0, nudged = false, baseRate = 1, adWas = false;

  const shareUrl = () => { if (P.shareText) return P.shareText(room); const u = new URL(location.href); u.searchParams.set(PARAM, room); return u.href; };
  const post = (msg) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); };
  const sendLink = () => post({ sp: 'link', url: shareUrl() });
  const adPlaying = () => P.isAdPlaying();

  function pushPage(on) {
    const el = document.documentElement;
    if (on) el.style.setProperty('width', `calc(100% - ${SIDE}px)`, 'important');
    else el.style.removeProperty('width');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }

  // ---- toast (works in fullscreen too) ----
  function ensureToastBox() {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;align-items:flex-end;';
    }
    const host = document.fullscreenElement || document.documentElement;
    if (toastBox.parentNode !== host) host.appendChild(toastBox);
    return toastBox;
  }
  document.addEventListener('fullscreenchange', () => { if (toastBox && toastBox.childNodes.length) ensureToastBox(); });
  function toast(icon, name, text) {
    const box = ensureToastBox();
    const t = document.createElement('div');
    t.style.cssText = 'background:rgba(20,20,28,.94);color:#fff;font:13px system-ui,sans-serif;padding:10px 12px;border-radius:10px;border-left:3px solid #22d3ee;max-width:280px;box-shadow:0 4px 16px rgba(0,0,0,.4);word-break:break-word;transition:opacity .4s;';
    const n = document.createElement('div');
    n.style.cssText = 'font-size:11px;color:#8fd3e8;margin-bottom:2px';
    n.textContent = icon + ' ' + name;
    const b = document.createElement('div'); b.textContent = text;
    t.append(n, b); box.appendChild(t);
    while (box.childNodes.length > 3) box.firstChild.remove();
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 6000);
  }

  function updateFab() {
    if (!fab) return;
    if (unread > 0) { fab.style.opacity = '1'; badge.textContent = unread > 9 ? '9+' : unread; badge.style.display = 'flex'; }
    else { fab.style.opacity = '.18'; badge.style.display = 'none'; }
  }
  function onChat(m) {
    const hidden = wrap && wrap.style.display === 'none';
    if (hidden || document.fullscreenElement) toast(m.icon, m.name, m.text);
    if (hidden) { unread++; updateFab(); }
  }

  function open(r) {
    if (wrap) return;
    room = r;
    sessionStorage.setItem('sp_room', r);
    wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;top:0;right:0;bottom:0;width:${SIDE}px;z-index:2147483647;background:#14141c;`;
    frame = document.createElement('iframe');
    frame.allow = 'clipboard-write';
    frame.style.cssText = 'width:100%;height:100%;border:0;';
    frame.src = chrome.runtime.getURL('sidebar/sidebar.html') + '?room=' + encodeURIComponent(r);
    frame.addEventListener('load', sendLink);
    wrap.appendChild(frame);
    document.documentElement.appendChild(wrap);
    pushPage(true);
    try { chrome.runtime.sendMessage({ type: 'sp-party', active: true, host: location.hostname }, () => void chrome.runtime.lastError); } catch (e) {}
  }

  function minimize() {
    wrap.style.display = 'none'; pushPage(false);
    unread = 0;
    fab = document.createElement('button');
    fab.title = 'Open Shaan Party';
    fab.textContent = '💬';
    fab.style.cssText = 'position:fixed;right:10px;top:80px;z-index:2147483647;width:30px;height:30px;border-radius:50%;border:0;cursor:pointer;font-size:14px;line-height:1;padding:0;background:rgba(40,40,60,.6);opacity:.18;transition:opacity .2s;';
    badge = document.createElement('span');
    badge.style.cssText = 'display:none;position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;background:#ef4444;color:#fff;font:700 10px system-ui,sans-serif;align-items:center;justify-content:center;padding:0 3px;';
    fab.appendChild(badge);
    fab.onmouseenter = () => { fab.style.opacity = '1'; };
    fab.onmouseleave = updateFab;
    fab.onclick = () => { unread = 0; wrap.style.display = 'block'; pushPage(true); fab.remove(); fab = badge = null; };
    document.documentElement.appendChild(fab);
  }

  function leave() {
    sessionStorage.removeItem('sp_room');
    try { chrome.runtime.sendMessage({ type: 'sp-party', active: false }, () => void chrome.runtime.lastError); } catch (e) {}
    if (wrap) wrap.remove(); if (fab) fab.remove(); if (toastBox) toastBox.remove();
    wrap = frame = fab = badge = toastBox = null; room = null; unread = 0; pushPage(false);
    const u = new URL(location.href);
    if (u.searchParams.has(PARAM)) { u.searchParams.delete(PARAM); history.replaceState(null, '', u.href); }
  }

  // ---- video sync ----
  function attach() {
    const v = P.getVideo();
    if (v === video) return;
    video = v;
    if (!v) return;
    if (attached.has(v)) return;
    attached.add(v);
    ['play', 'pause', 'seeked', 'ratechange'].forEach(ev => v.addEventListener(ev, () => onLocal(ev)));
  }
  // while we are gently speeding up / slowing down to catch up, report the real speed, not the nudged one
  const state = () => ({ kind: 'sync', playing: !video.paused, time: video.currentTime, rate: nudged ? baseRate : video.playbackRate });
  function onLocal(ev) {
    if (!room || !video || Date.now() < applyUntil || adPlaying()) return;
    if (ev === 'ratechange') { nudged = false; baseRate = video.playbackRate; }   // the person changed speed themselves
    lastSent = { ev, t: video.currentTime, at: Date.now() };
    post({ sp: 'send', data: { ...state(), ev } });
  }
  // d.lat = seconds the message spent travelling (computed by the sidebar from the shared clock)
  function applyRemote(d) {
    const beat = d.ev === 'beat';
    if (!video || adPlaying()) { if (!beat) pending = { ...d, rcvAt: d.rcvAt || Date.now() }; return; }   // wait for player / ad to finish
    const rate = d.rate || 1;
    const lat = (d.lat || 0) + (d.rcvAt ? (Date.now() - d.rcvAt) / 1000 : 0);
    const want = d.time + (d.playing ? lat * rate : 0);
    const diff = want - video.currentTime;

    // A heartbeat only corrects drift. It never flips play/pause on its own, because one can be in flight
    // while someone pauses. If play/pause disagrees on two beats in a row, treat it as a real state change.
    let event = !beat;
    if (beat) {
      if (d.playing === !video.paused) beatMismatch = 0;
      else if (++beatMismatch >= 2) { beatMismatch = 0; event = true; }
      else return;
    }

    const act = M.driftAction(diff, { beat: !event, playing: d.playing && !video.paused });
    const touched = () => { applyUntil = Date.now() + 1500; };   // our own changes must not echo back to the party
    lastApplied = { playing: d.playing, t: want, at: Date.now() };
    baseRate = rate;
    if (act.action === 'seek') video.currentTime = want;
    if (event || act.action === 'seek') {                          // explicit state, or we just jumped: back to the real speed
      touched();
      nudged = false;
      if (video.playbackRate !== rate) video.playbackRate = rate;
    } else if (act.action === 'nudge') {
      touched(); nudged = true; video.playbackRate = rate * act.factor;
    } else if (nudged ? act.action === 'reset' : video.playbackRate !== rate) {
      touched(); nudged = false; video.playbackRate = rate;
    }
    if (!event) return;
    if (d.playing && video.paused) video.play().catch(() => post({ sp: 'notice', text: 'Browser blocked autoplay. Click the video once.' }));
    if (!d.playing && !video.paused) video.pause();
  }

  // ---- title / episode navigation ----
  function checkNav() {
    const k = keyOf(location.href);
    if (k === lastKey) return;
    lastKey = k;
    applyUntil = Date.now() + 3000;             // ignore player events while the page switches
    const u = new URL(location.href); u.searchParams.delete(PARAM);
    post({ sp: 'send', data: { kind: 'nav', url: u.href } });
    sendLink();
  }
  function applyNav(url) {
    try {
      const u = new URL(url);
      if (!P.isHost(u.hostname)) return;
      if (keyOf(u.href) === keyOf(location.href)) return;
      u.searchParams.set(PARAM, room);
      location.href = u.href;
    } catch (e) {}
  }

  setInterval(() => {
    if (!room) return;
    attach(); checkNav();
    const ad = adPlaying();
    if (adWas && !ad) window.ShaanCore.requestState();          // ad just ended: ask the party where we are now
    adWas = ad;
    if (pending && video && !ad) { const p = pending; pending = null; applyRemote(p); }
    // the leader (lowest member id, decided by the sidebar) sends a heartbeat so everyone else can correct drift
    const now = Date.now();
    if (isLeader && video && !video.paused && !ad && now >= applyUntil && now >= nextBeat) {
      nextBeat = now + BEAT_MS;
      post({ sp: 'send', data: { ...state(), ev: 'beat' } });
    }
  }, 1000);

  window.addEventListener('message', (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.sp === 'remote') {
      const d = m.data || {};
      if (d.kind === 'sync') { lastReceived = { ev: d.ev, t: d.time, at: Date.now() }; applyRemote(d); }
      else if (d.kind === 'nav') applyNav(d.url);
      else if (d.kind === 'file') { if (P.onRemote) P.onRemote(d, m.from); }
      else if (d.kind === 'req') { attach(); if (video && !adPlaying()) post({ sp: 'send', data: { ...state(), ev: 'state' } }); }
    } else if (m.sp === 'ready') { sendLink(); post({ sp: 'platform', id: P.id, host: location.hostname }); if (P.onJoined) P.onJoined(); }
    else if (m.sp === 'chatmsg') onChat(m);
    else if (m.sp === 'leader') { isLeader = !!m.leader; nextBeat = 0; }
    else if (m.sp === 'bg') {
      try { chrome.runtime.sendMessage(m.msg, res => { void chrome.runtime.lastError; post({ sp: 'bg-res', id: m.id, res: res || null }); }); }
      catch (err) { post({ sp: 'bg-res', id: m.id, res: null }); }
    }
    else if (m.sp === 'diag-req') {
      let base = {};
      try { base = P.diagnose ? P.diagnose() : {}; } catch (err) {}
      post({ sp: 'diag', data: { platform: P.id, room, hasVideo: !!video, pending: !!pending, adPlaying: adPlaying(), isLeader, nudged, lastSent, lastApplied, lastReceived, ...base } });
    }
    else if (m.sp === 'setexpected') { if (P.setExpected) P.setExpected(m.minutes); }
    else if (m.sp === 'push-state') {
      attach();
      if (video && !adPlaying()) post({ sp: 'send', data: { ...state(), ev: 'state', push: true } });
      else post({ sp: 'notice', text: 'No movie video found to send. Open 🩺 for details.' });
    }
    else if (m.sp === 'pull-state') window.ShaanCore.requestState();
    else if (m.sp === 'minimize') minimize();
    else if (m.sp === 'leave') leave();
  });

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'sp-start') {
      const code = Math.random().toString(36).slice(2, 8);
      open(code); reply({ ok: true, room: code });
    } else if (msg.type === 'sp-join' && ROOM_RE.test(msg.room || '')) {
      open(msg.room); reply({ ok: true });
    } else reply({ ok: false });
  });

  window.ShaanCore = {
    inRoom: () => !!room,
    send: data => post({ sp: 'send', data }),
    notice: text => post({ sp: 'notice', text }),
    requestState: () => { pending = null; beatMismatch = 0; post({ sp: 'reqstate' }); },
    start: () => { if (room) return room; const c = Math.random().toString(36).slice(2, 8); open(c); return c; },
    join: c => { if (room || !ROOM_RE.test(c || '')) return false; open(c); return true; }
  };

  const fromUrl = new URL(location.href).searchParams.get(PARAM);
  if (fromUrl && ROOM_RE.test(fromUrl)) sessionStorage.setItem('sp_room', fromUrl);
  const initial = fromUrl || sessionStorage.getItem('sp_room');
  if (initial && ROOM_RE.test(initial)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => open(initial));
    else open(initial);
  }
})();
