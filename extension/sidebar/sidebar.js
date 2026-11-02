const $ = id => document.getElementById(id);
const room = new URLSearchParams(location.search).get('room');
let ws, me = null, members = [], settings = {}, link = '', typingTimer = 0, lastTypingSent = 0, hb;
const clock = new ShaanMath.ClockSync();   // our estimate of (server clock - local clock)
const typers = new Map();
const EMOJIS = '😀 😂 🤣 😊 😍 😘 😎 🤩 🥳 😭 😢 😡 😱 😴 🤔 🙄 😅 😉 🙃 😇 🥺 😤 🤯 🤭 👍 👎 👏 🙌 🙏 💪 👀 🔥 ❤️ 💔 💯 ✨ 🎉 🍿 🎬 😈 💀 🤡 👻 🫡 😏 😬 🤝 🫶'.split(' ');
const REACTS = ['❤️', '😡', '😭', '😂', '😮', '🔥'];

chrome.storage.local.get({ server: 'ws://localhost:8080', name: '', icon: '😎', giphy: '' }, s => {
  settings = s;
  if (!s.name) { s.name = 'Guest' + Math.floor(100 + Math.random() * 900); chrome.storage.local.set({ name: s.name }); }
  connect();
});

function toParent(m) { parent.postMessage(m, '*'); }
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
// sync / load messages carry the (estimated) server time they were sent at, so receivers can correct for travel time
function relay(data) {
  if ((data.kind === 'sync' || data.kind === 'load') && clock.ready) data = { ...data, sentAt: Math.round(clock.now(Date.now())) };
  send({ t: 'relay', data });
}
const pingClock = () => send({ t: 'ping', c: Date.now() });
function setStatus(t) { $('status').textContent = t; }

function connect() {
  setStatus('Connecting…');
  try { ws = new WebSocket(settings.server); } catch (e) { setStatus('Invalid server URL. Fix it in the popup.'); return; }
  ws.onopen = () => {
    send({ t: 'join', room, name: settings.name, icon: settings.icon });
    clearInterval(hb); hb = setInterval(pingClock, 10000);          // also keeps the connection alive
    pingClock(); setTimeout(pingClock, 400); setTimeout(pingClock, 1000);
  };
  ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (_) {} };
  ws.onclose = () => { clearInterval(hb); setStatus('Disconnected. Retrying…'); setTimeout(connect, 3000); };
  ws.onerror = () => {};
}

const nameOf = id => (members.find(m => m.id === id) || {}).name || 'Someone';
const iconOf = id => (members.find(m => m.id === id) || {}).icon || '👤';
const fmt = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

function handle(m) {
  if (m.t === 'welcome') {
    me = m.id; setStatus('Connected · room ' + room);
    toParent({ sp: 'ready' });
    sys('You joined the party');
    if (m.others > 0) send({ t: 'req' });
  } else if (m.t === 'pong') {
    clock.sample(Number(m.c), Number(m.s), Date.now());
  } else if (m.t === 'members') {
    const prev = members;
    members = m.list; $('count').textContent = members.length; setStatus('Connected · room ' + room + ' · ' + members.length + ' in party'); renderMembers();
    members.filter(x => !prev.some(p => p.id === x.id) && x.id !== me && prev.length).forEach(x => sys(x.name + ' joined'));
    prev.filter(p => !members.some(x => x.id === p.id)).forEach(p => sys(p.name + ' left'));
    // the member with the lowest id is the "leader": it sends the heartbeat everyone else corrects against
    const lead = members.reduce((a, b) => (a === null || Number(b.id) < Number(a.id) ? b : a), null);
    toParent({ sp: 'leader', leader: !!lead && lead.id === me });
  } else if (m.t === 'msg') onData(m.from, m.data);
}

function onData(from, d) {
  if (d.kind === 'chat') {
    addMsg(from, d);
    const text = d.reaction ? String(d.reaction).slice(0, 8) : d.gif ? 'sent a GIF' : String(d.text || '').slice(0, 120);
    toParent({ sp: 'chatmsg', name: nameOf(from), icon: iconOf(from), text });
  }
  else if (d.kind === 'typing') {
    typers.set(from, Date.now() + 3000); renderTyping();
  } else if (d.kind === 'sync') {
    if (d.ev === 'state') { if (d.push) sys(nameOf(from) + ' synced everyone to ' + fmt(d.time)); } else {
      const verb = { play: 'played', pause: 'paused', seeked: 'jumped to ' + fmt(d.time), ratechange: 'set speed to ' + d.rate + 'x' }[d.ev];
      if (verb) sys(nameOf(from) + ' ' + verb + (d.ev === 'play' || d.ev === 'pause' ? ' at ' + fmt(d.time) : ''));
    }
    const lat = clock.ready ? ShaanMath.transit(d.sentAt, clock.now(Date.now())) : 0;   // seconds the message was in flight
    toParent({ sp: 'remote', data: { ...d, lat }, from });
  } else if (d.kind === 'nav') { sys(nameOf(from) + ' changed the video'); toParent({ sp: 'remote', data: d, from }); }
  else if (d.kind === 'req') toParent({ sp: 'remote', data: d, from });
  else if (d.kind === 'file') toParent({ sp: 'remote', data: d, from });
}

function renderMembers() {
  $('members').innerHTML = '';
  members.forEach(m => { const d = document.createElement('div'); d.className = 'member'; d.textContent = m.icon + ' ' + m.name + (m.id === me ? ' (you)' : ''); $('members').appendChild(d); });
}
function renderTyping() {
  const now = Date.now(); [...typers].forEach(([k, v]) => { if (v < now) typers.delete(k); });
  const names = [...typers.keys()].map(nameOf);
  $('typing').textContent = names.length ? names.join(', ') + (names.length > 1 ? ' are typing…' : ' is typing…') : '';
  clearTimeout(typingTimer); if (typers.size) typingTimer = setTimeout(renderTyping, 1000);
}

function scroll() { const c = $('chat'); c.scrollTop = c.scrollHeight; }
function sys(t) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = t; $('chat').appendChild(d); scroll(); }
function addMsg(from, d) {
  const mine = from === me;
  const row = document.createElement('div'); row.className = 'm' + (mine ? ' me' : '');
  const av = document.createElement('div'); av.className = 'av'; av.textContent = mine ? settings.icon : iconOf(from);
  const col = document.createElement('div');
  const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = mine ? 'You' : nameOf(from);
  const b = document.createElement('div'); b.className = 'bubble';
  if (d.reaction) { b.classList.add('big'); b.textContent = String(d.reaction).slice(0, 8); }
  else if (d.gif) {
    try { const u = new URL(d.gif); if (u.protocol === 'https:' && /(^|\.)giphy\.com$/.test(u.hostname)) { const i = document.createElement('img'); i.src = u.href; b.appendChild(i); } } catch (_) {}
  } else b.textContent = String(d.text || '').slice(0, 500);
  col.append(nm, b); row.append(av, col);
  if (!mine) { row.classList.add('new'); setTimeout(() => row.classList.remove('new'), 3000); } $('chat').appendChild(row); scroll();
}
function sendChat(d) { const p = { kind: 'chat', ...d }; relay(p); addMsg(me, p); }

// UI wiring
$('msg').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) { sendChat({ text: e.target.value.trim() }); e.target.value = ''; }
  else if (Date.now() - lastTypingSent > 2000) { lastTypingSent = Date.now(); relay({ kind: 'typing' }); }
});
['keydown', 'keyup', 'keypress'].forEach(ev => document.addEventListener(ev, e => e.stopPropagation()));
REACTS.forEach(r => { const b = document.createElement('button'); b.textContent = r; b.onclick = () => sendChat({ reaction: r }); $('reactions').appendChild(b); });
EMOJIS.forEach(em => { const s = document.createElement('span'); s.textContent = em; s.onclick = () => { $('msg').value += em; $('msg').focus(); }; $('emoji-panel').appendChild(s); });
$('emoji-btn').onclick = () => { $('gif-panel').classList.add('hidden'); $('emoji-panel').classList.toggle('hidden'); };
$('gif-btn').onclick = () => { $('emoji-panel').classList.add('hidden'); $('gif-panel').classList.toggle('hidden'); if (!settings.giphy) $('gif-results').textContent = 'Add a free GIPHY API key in the extension popup to use GIFs.'; else if (!$('gif-results').children.length) loadGifs(''); };
$('members-btn').onclick = () => $('members').classList.toggle('hidden');
$('min-btn').onclick = () => toParent({ sp: 'minimize' });
$('leave-btn').onclick = () => { if (confirm('Leave the party?')) toParent({ sp: 'leave' }); };
$('code-btn').onclick = () => navigator.clipboard.writeText(room).then(() => sys('Room code copied: ' + room), () => prompt('Room code:', room));
$('copy-btn').onclick = () => navigator.clipboard.writeText(link).then(() => sys('Invite link copied'), () => prompt('Copy this link:', link));

let gifT;
async function loadGifs(q) {
  if (!settings.giphy) return;
  const base = 'https://api.giphy.com/v1/gifs/';
  const url = (q ? base + 'search?q=' + encodeURIComponent(q) + '&' : base + 'trending?') + 'limit=12&rating=pg-13&api_key=' + encodeURIComponent(settings.giphy);
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) throw new Error('bad response');
    $('gif-results').innerHTML = '';
    (j.data || []).forEach(g => {
      const u = g.images && g.images.fixed_width && g.images.fixed_width.url;
      if (!u) return;
      const i = document.createElement('img'); i.src = u;
      i.onclick = () => { sendChat({ gif: u }); $('gif-panel').classList.add('hidden'); };
      $('gif-results').appendChild(i);
    });
  } catch (_) { $('gif-results').textContent = 'GIF search failed. Check your GIPHY API key in the popup.'; }
}
$('gif-q').addEventListener('input', e => { clearTimeout(gifT); gifT = setTimeout(() => loadGifs(e.target.value.trim()), 400); });

window.addEventListener('message', e => {
  if (e.source !== parent) return;
  const m = e.data || {};
  if (m.sp === 'send') relay(m.data);
  else if (m.sp === 'link') link = m.url;
  else if (m.sp === 'reqstate') send({ t: 'req' });
  else if (m.sp === 'notice') sys(m.text);
  else if (m.sp === 'platform') { platformId = m.id; topHost = m.host; if (m.id === 'generic' && !frameTimer) { frameTimer = setInterval(checkFrames, 5000); checkFrames(); } }
  else if (m.sp === 'diag') renderDiag(m.data);
  else if (m.sp === 'bg-res') { const r = pendBg.get(m.id); if (r) { pendBg.delete(m.id); r(m.res); } }
});


// ---- ask the background worker (relayed through the page script) ----
const pendBg = new Map();
let bgSeq = 0, platformId = '', topHost = '', frameTimer = null, missingOrigins = [], diagTimer = null;
function bg(msg) {
  return new Promise(res => {
    const id = ++bgSeq;
    pendBg.set(id, res);
    toParent({ sp: 'bg', id, msg });
    setTimeout(() => { if (pendBg.has(id)) { pendBg.delete(id); res(null); } }, 8000);
  });
}

// ---- "Allow player" banner (generic sites only) ----
const NOISE = /(google|gstatic|doubleclick|googlesyndication|cloudflare|facebook|twitter|disqus|gravatar|jsdelivr|cdnjs|bootstrapcdn)/i;
async function checkFrames() {
  if (platformId !== 'generic') return;
  const r = await bg({ type: 'sp-frames' });
  if (!r || !r.origins) return;
  const missing = [];
  for (const o of r.origins) {
    let host; try { host = new URL(o).hostname; } catch (e) { continue; }
    if (host === topHost || NOISE.test(host)) continue;
    const ok = await new Promise(res => chrome.permissions.contains({ origins: [o + '/*'] }, res));
    if (!ok) missing.push(o);
  }
  missingOrigins = missing;
  if (missing.length) {
    $('allow-text').textContent = 'Player may be on: ' + missing.slice(0, 4).map(o => new URL(o).hostname).join(', ') + '. Not allowed yet.';
    $('allow-banner').classList.remove('hidden');
  } else $('allow-banner').classList.add('hidden');
}
$('allow-btn').onclick = () => {
  chrome.permissions.request({ origins: missingOrigins.map(o => o + '/*') }, async granted => {
    if (!granted) return sys('Permission was not granted.');
    const r = await bg({ type: 'sp-allow', origins: missingOrigins });
    sys(r && r.ok ? 'Player allowed. Press play once. Open 🩺 if it still does not sync.' : 'Could not finish enabling. Refresh the page and try again.');
    setTimeout(checkFrames, 1500);
  });
};

// ---- diagnostics panel ----
const reqDiag = () => toParent({ sp: 'diag-req' });
$('diag-btn').onclick = () => {
  const el = $('diag');
  el.classList.toggle('hidden');
  clearInterval(diagTimer);
  if (!el.classList.contains('hidden')) { reqDiag(); diagTimer = setInterval(reqDiag, 2000); }
};
$('push-btn').onclick = () => toParent({ sp: 'push-state' });
$('pull-btn').onclick = () => { toParent({ sp: 'pull-state' }); sys('Asked the party for their position…'); };
$('exp-set').onclick = () => toParent({ sp: 'setexpected', minutes: Number($('exp-min').value) || 0 });
function renderDiag(d) {
  const ago = t => t ? Math.round((Date.now() - t.at) / 1000) + 's ago' : '-';
  const L = [];
  L.push('Site type: ' + d.platform + ' | in room: ' + (d.room || '-'));
  L.push('Video found: ' + (d.hasVideo ? 'yes' : 'NO') + ' | ad playing: ' + (d.adPlaying ? 'yes' : 'no') + ' | waiting to sync: ' + (d.pending ? 'yes' : 'no'));
  if (d.expectedSec !== undefined) L.push('Expected movie length: ' + (d.expectedSec ? Math.round(d.expectedSec / 60) + ' min (' + d.expectedSource + ')' : 'unknown'));
  if (d.isLeader !== undefined) L.push('Heartbeat leader: ' + (d.isLeader ? 'you' : 'someone else') + (d.nudged ? ' | catching up (speed nudged)' : ''));
  if (d.mainDur !== undefined) L.push('Title length seen: ' + (d.mainDur ? Math.round(d.mainDur / 60) + ' min' : 'unknown') + ' | ad hint on page: ' + (d.adHint ? 'yes' : 'no'));
  L.push('Clock: ' + (clock.ready ? 'synced, offset ' + Math.round(clock.offset) + ' ms, round trip ' + Math.round(clock.rtt) + ' ms' : 'not synced yet'));
  L.push('Last sent: ' + (d.lastSent ? d.lastSent.ev + ' @ ' + fmt(d.lastSent.t) + ' (' + ago(d.lastSent) + ')' : '-'));
  L.push('Last received from partner: ' + (d.lastReceived ? (d.lastReceived.ev || '?') + ' @ ' + fmt(d.lastReceived.t) + ' (' + ago(d.lastReceived) + ')' : 'NOTHING YET'));
  L.push('Last applied: ' + (d.lastApplied ? (d.lastApplied.playing ? 'play' : 'pause') + ' @ ' + fmt(d.lastApplied.t) + ' (' + ago(d.lastApplied) + ')' : '-'));
  if (d.candidates) {
    L.push('Videos seen (' + d.candidates.length + '):');
    d.candidates.forEach(c => L.push((c.selected ? ' ▶ ' : ' • ') + c.where + ' ' + c.host + ' | ' + c.kind + ' | ' + (c.dur >= 0 ? Math.round(c.dur / 60) + 'm' : c.dur === -2 ? 'no length' : 'live') + ' | ' + (c.paused ? 'paused' : 'playing')));
    if (!d.candidates.length) L.push(' none. Press play, then use "Allow player" if the banner shows.');
  }
  $('diag-out').textContent = L.join('\n');
}
