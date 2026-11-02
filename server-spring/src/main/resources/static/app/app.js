(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ROOM_RE = /^[\w-]{3,32}$/;
  const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐼', '🐸', '👻', '🤖', '👽', '🦄', '🍕', '⭐'];
  const EMOJIS = '😀 😂 🤣 😊 😍 😘 😎 🤩 🥳 😭 😢 😡 😱 😴 🤔 🙄 😅 😉 🙃 😇 🥺 😤 🤯 🤭 👍 👎 👏 🙌 🙏 💪 👀 🔥 ❤️ 💔 💯 ✨ 🎉 🍿 🎬 😈 💀 🤡 👻 🫡 😏 😬 🤝 🫶'.split(' ');
  const REACTS = ['❤️', '😡', '😭', '😂', '😮', '🔥'];
  const ls = {
    get: (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ---- state ----
  let ws = null, me = null, room = null, members = [], connected = false, hb = null, retry = null;
  const clock = new ShaanMath.ClockSync();      // estimate of (server clock - local clock)
  let isLeader = false, nextBeat = 0;           // the lowest member id sends a heartbeat every few seconds
  let name = ls.get('sp_name', ''), icon = ls.get('sp_icon', '😎');
  let typingSent = 0, typingTimer = 0, unread = 0;
  const typers = new Map();
  // youtube
  let player = null, playerReady = false, ytReady = false, currentId = null, currentTitle = '', currentChannel = '', currentChannelId = '', startWatch = 0;
  let queue = [], tab = 'browse';                // the shared queue (the server owns it) and the visible tab
  const queueListeners = [], startListeners = [], nowListeners = [];
  const SY = window.ShaanYT;                    // link parsing + result cleaning (yt-search.js); not named YT: that is YouTube's own global
  let applyUntil = 0, pending = null, afterLoad = null, desired = null, unlocked = false;
  let lastT = 0, lastAt = 0, lastPlaying = false, lastRate = 1, mainDur = 0, inAd = false;

  // ================= landing =================
  AVATARS.forEach(a => { const o = document.createElement('option'); o.value = o.textContent = a; $('avatar').appendChild(o); });
  $('name').value = name; $('avatar').value = icon;
  const qRoom = new URLSearchParams(location.search).get('room');
  if (qRoom && ROOM_RE.test(qRoom)) $('code').value = qRoom;
  const landingMsg = t => { $('landing-msg').textContent = t; };
  $('create').onclick = () => start((Math.random().toString(36) + '000000').slice(2, 8));
  $('join').onclick = () => {
    const c = $('code').value.trim();
    if (!ROOM_RE.test(c)) return landingMsg('Enter a valid room code (3-32 letters or numbers).');
    start(c);
  };
  function start(code) {
    name = $('name').value.trim() || 'Guest' + Math.floor(100 + Math.random() * 900);
    icon = $('avatar').value;
    ls.set('sp_name', name); ls.set('sp_icon', icon);
    room = code;
    $('landing').classList.add('hidden');
    $('room').classList.remove('hidden');
    $('room-code').textContent = code;
    history.replaceState(null, '', '?room=' + encodeURIComponent(code));
    loadYT();
    connect();
    startListeners.forEach(f => f());
  }

  // ================= connection =================
  const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  // sync / load messages carry the (estimated) server time they were sent at, so receivers can correct for travel time
  const relay = data => {
    if ((data.kind === 'sync' || data.kind === 'load') && clock.ready) data = { ...data, sentAt: Math.round(clock.now(Date.now())) };
    send({ t: 'relay', data });
  };
  const pingClock = () => send({ t: 'ping', c: Date.now() });
  const latOf = d => (clock.ready ? ShaanMath.transit(d.sentAt, clock.now(Date.now())) : 0);
  const setStatus = t => { $('status').textContent = t; };

  function connect() {
    clearTimeout(retry);
    setStatus('Connecting…');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => {
      send({ t: 'join', room, name, icon });
      clearInterval(hb); hb = setInterval(pingClock, 10000);       // also keeps the connection alive
      pingClock(); setTimeout(pingClock, 400); setTimeout(pingClock, 1000);
    };
    ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (_) {} };
    ws.onclose = () => {
      connected = false; clearInterval(hb);
      setStatus('Disconnected. Reconnecting…');
      retry = setTimeout(connect, 2500);
    };
    ws.onerror = () => {};
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      unread = 0; document.title = 'Shaan Party';
      if (room && (!ws || ws.readyState > 1)) connect();
    }
  });

  const nameOf = id => (members.find(m => m.id === id) || {}).name || 'Someone';
  const iconOf = id => (members.find(m => m.id === id) || {}).icon || '👤';
  const fmt = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

  function handle(m) {
    if (m.t === 'welcome') {
      me = m.id; connected = true;
      setStatus('Connected');
      sys('You joined the party');
      if (m.others > 0) send({ t: 'req' });
    } else if (m.t === 'pong') {
      clock.sample(Number(m.c), Number(m.s), Date.now());
    } else if (m.t === 'members') {
      const prev = members;
      members = m.list;
      $('count').textContent = members.length;
      renderMembers();
      setStatus('Connected · ' + members.length + ' in party');
      members.filter(x => !prev.some(p => p.id === x.id) && x.id !== me && prev.length).forEach(x => sys(x.name + ' joined'));
      prev.filter(p => !members.some(x => x.id === p.id)).forEach(p => sys(p.name + ' left'));
      const lead = members.reduce((a, b) => (a === null || Number(b.id) < Number(a.id) ? b : a), null);
      isLeader = !!lead && lead.id === me;
    } else if (m.t === 'queue') {
      setQueue(m.items);
    } else if (m.t === 'notice') {
      if (typeof m.text === 'string') sys(m.text.slice(0, 200));
    } else if (m.t === 'msg') onData(m.from, m.data || {});
  }

  // the server sends the whole list on every change; check every field before showing it
  function setQueue(list) {
    queue = (Array.isArray(list) ? list : []).filter(q => q && SY.isId(q.id)).slice(0, 50).map(q => ({
      qid: Number(q.qid) || 0, id: q.id, title: String(q.title || '').slice(0, 120), channel: String(q.channel || '').slice(0, 60),
      dur: Math.max(0, Math.min(43200, Math.floor(Number(q.dur)) || 0)), by: String(q.by || '').slice(0, 24)
    }));
    const b = $('queue-count');
    b.textContent = String(queue.length);
    b.classList.toggle('hidden', !queue.length);
    updateNow();
    queueListeners.forEach(f => f(queue.slice()));
  }

  // ---- the "now playing" bar under the video
  function setNow(title, channel, channelId) {
    currentTitle = title || ''; currentChannel = channel || ''; currentChannelId = /^UC[\w-]{22}$/.test(channelId || '') ? channelId : '';
    updateNow();
  }
  function updateNow() {
    $('now-title').textContent = currentId ? (currentTitle || 'YouTube video') : 'Nothing playing yet';
    const c = $('now-chan');
    c.textContent = currentChannel;
    c.classList.toggle('hidden', !currentChannel);
    c.disabled = !currentChannelId;
    $('next-btn').classList.toggle('hidden', !(currentId && queue.length));
    $('now-sub').classList.toggle('hidden', !currentChannel && !(currentId && queue.length));   // no empty row under the title
    nowListeners.forEach(f => f());
  }

  function onData(from, d) {
    if (d.kind === 'chat') {
      addMsg(from, d);
      if (document.hidden) { unread++; document.title = '(' + unread + ') Shaan Party'; }
    } else if (d.kind === 'typing') {
      typers.set(from, Date.now() + 3000); renderTyping();
    } else if (d.kind === 'req') {
      if (currentId && playerReady && !inAd) relay({ kind: 'load', id: currentId, title: currentTitle, channel: currentChannel, channelId: currentChannelId, time: player.getCurrentTime(), playing: player.getPlayerState() === 1, rate: player.getPlaybackRate() });
    } else if (d.kind === 'load' && /^[\w-]{11}$/.test(d.id || '')) {
      const title = typeof d.title === 'string' ? d.title.slice(0, 120) : '';
      const chan = typeof d.channel === 'string' ? d.channel.slice(0, 60) : '';
      const changed = d.id !== currentId;
      if (typeof d.note === 'string' && d.note) sys(d.note.slice(0, 200));            // the server explains its own loads ("Up next: ...")
      else if (changed) sys(nameOf(from) + ' is playing' + (title ? ': ' + title : ' a video'));
      const lrate = +d.rate || 1;
      desired = { playing: !!d.playing, time: (+d.time || 0) + (d.playing ? latOf(d) * lrate : 0), rate: lrate, at: Date.now() };
      if (changed) setVideo(d.id, desired.time, desired.playing, desired.rate);
      else applyState(desired);
      if (changed || title) setNow(title, chan, d.channelId);                         // a replay without details keeps what we already show
      if (!unlocked) $('unlock').classList.remove('hidden');
    } else if (d.kind === 'sync') {
      if (d.ev !== 'state') {
        const verb = { play: 'played', pause: 'paused', seeked: 'jumped to ' + fmt(d.time), ratechange: 'set speed to ' + d.rate + 'x' }[d.ev];
        if (verb) sys(nameOf(from) + ' ' + verb + (d.ev === 'play' || d.ev === 'pause' ? ' at ' + fmt(d.time) : ''));
      }
      const srate = +d.rate || 1;
      desired = { playing: !!d.playing, time: (+d.time || 0) + (d.playing ? latOf(d) * srate : 0), rate: srate, at: Date.now() };
      if (d.ev === 'beat') applyBeat(desired); else applyState(desired);
    }
  }

  // ================= chat UI =================
  function scrollChat() { const c = $('chat'); c.scrollTop = c.scrollHeight; }
  function sys(t) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = t; $('chat').appendChild(d); scrollChat(); }
  function addMsg(from, d) {
    const mine = from === me;
    const row = document.createElement('div'); row.className = 'm' + (mine ? ' me' : '');
    const av = document.createElement('div'); av.className = 'av'; av.textContent = mine ? icon : iconOf(from);
    const col = document.createElement('div');
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = mine ? 'You' : nameOf(from);
    const b = document.createElement('div'); b.className = 'bubble';
    if (d.reaction) { b.classList.add('big'); b.textContent = String(d.reaction).slice(0, 8); }
    else b.textContent = String(d.text || '').slice(0, 500);
    col.append(nm, b); row.append(av, col);
    if (!mine) { row.classList.add('new'); setTimeout(() => row.classList.remove('new'), 3000); if (tab !== 'chat') $('chat-dot').classList.remove('hidden'); }
    $('chat').appendChild(row); scrollChat();
  }
  function sendChat(d) { const p = { kind: 'chat', ...d }; relay(p); addMsg(me, p); }
  function renderMembers() {
    $('members').innerHTML = '';
    members.forEach(m => { const d = document.createElement('div'); d.textContent = m.icon + ' ' + m.name + (m.id === me ? ' (you)' : ''); $('members').appendChild(d); });
  }
  function renderTyping() {
    const now = Date.now(); [...typers].forEach(([k, v]) => { if (v < now) typers.delete(k); });
    const names = [...typers.keys()].map(nameOf);
    $('typing').textContent = names.length ? names.join(', ') + (names.length > 1 ? ' are typing…' : ' is typing…') : '';
    clearTimeout(typingTimer); if (typers.size) typingTimer = setTimeout(renderTyping, 1000);
  }
  function submitMsg() { const i = $('msg'), t = i.value.trim(); if (t) { sendChat({ text: t }); i.value = ''; } }
  $('msg').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitMsg();
    else if (Date.now() - typingSent > 2000) { typingSent = Date.now(); relay({ kind: 'typing' }); }
  });
  $('send-btn').onclick = submitMsg;
  REACTS.forEach(r => { const b = document.createElement('button'); b.textContent = r; b.onclick = () => sendChat({ reaction: r }); $('reactions').appendChild(b); });
  EMOJIS.forEach(em => { const s = document.createElement('span'); s.textContent = em; s.onclick = () => { $('msg').value += em; }; $('emoji-panel').appendChild(s); });
  $('emoji-btn').onclick = () => $('emoji-panel').classList.toggle('hidden');
  $('members-btn').onclick = () => { showTab('chat'); $('members').classList.toggle('hidden'); };
  $('invite-btn').onclick = () => {
    const url = location.origin + '/app/index.html?room=' + encodeURIComponent(room);
    if (navigator.share) navigator.share({ title: 'Shaan Party', text: 'Join my watch party', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => sys('Invite link copied'), () => prompt('Copy this link:', url));
    else prompt('Copy this link:', url);
  };
  $('leave-btn').onclick = () => { if (confirm('Leave the party?')) location.href = '/app/index.html'; };

  // ================= YouTube =================
  function loadYT() {
    if (window.YT && window.YT.Player) { ytReady = true; return; }
    window.onYouTubeIframeAPIReady = () => { ytReady = true; if (currentId && !player) createPlayer(currentId, afterLoad ? afterLoad.time : 0); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  }
  function createPlayer(id, start) {
    playerReady = false;
    player = new YT.Player('player', {
      width: '100%', height: '100%', videoId: id,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin, start: Math.floor(start || 0) },
      events: { onReady: () => { playerReady = true; flush(); }, onStateChange: onState, onPlaybackRateChange: () => { if (ok()) sendSync('ratechange'); } }
    });
  }
  function setVideo(id, start, playing, rate) {
    currentId = id; mainDur = 0; inAd = false; pending = null;
    afterLoad = { playing: !!playing, time: start || 0, rate: rate || 1 };
    $('empty').classList.add('hidden');
    watchStart(playing);
    if (!ytReady) return;                                 // created when the API finishes loading
    if (!player) createPlayer(id, start);
    else { applyUntil = Date.now() + 2500; player.loadVideoById({ videoId: id, startSeconds: start || 0 }); }
  }
  // iPhones often refuse to start a video that was not started by a tap on this page.
  // If a video that should be playing has not started after a few seconds, show the "tap to start" button again.
  function watchStart(shouldPlay, tries) {
    clearTimeout(startWatch);
    if (!shouldPlay) return;
    startWatch = setTimeout(() => {
      if (!player || !playerReady || typeof player.getPlayerState !== 'function') {
        if ((tries || 0) < 3) watchStart(true, (tries || 0) + 1);   // player still loading: look again
        return;
      }
      const st = player.getPlayerState();
      if (!inAd && st !== 1 && st !== 3) { unlocked = false; $('unlock').classList.remove('hidden'); }
    }, 3500);
  }
  const ok = () => connected && playerReady && !inAd && Date.now() >= applyUntil;
  function flush() {
    if (afterLoad) { const a = afterLoad; afterLoad = null; applyState(a); }
    else if (pending) { const p = pending; pending = null; applyState(p); }
  }
  function applyState(d) {
    if (!player || !playerReady || typeof player.getPlayerState !== 'function') { pending = d; return; }
    if (inAd) { pending = d; return; }
    applyUntil = Date.now() + 1500;
    const cur = player.getCurrentTime();
    const want = d.time + (d.playing && d.at ? (Date.now() - d.at) / 1000 * (d.rate || 1) : 0);
    if (Math.abs(cur - want) > 1.5) player.seekTo(want, true);
    if (d.rate && player.getPlaybackRate() !== d.rate) player.setPlaybackRate(d.rate);
    const st = player.getPlayerState();
    if (d.playing && st !== 1 && st !== 3) player.playVideo();
    if (!d.playing && st === 1) player.pauseVideo();
    lastAt = 0;                                           // reset seek-detection baseline
  }
  // heartbeat from the leader: only fixes drift (YouTube cannot do fractional speed), never flips play / pause
  function applyBeat(d) {
    if (!player || !playerReady || inAd || typeof player.getPlayerState !== 'function') return;
    const st = player.getPlayerState();
    if (!d.playing || (st !== 1 && st !== 3)) return;
    if (Math.abs(d.time - player.getCurrentTime()) > 1.5) { applyUntil = Date.now() + 1500; player.seekTo(d.time, true); lastAt = 0; }
  }
  function sendSync(ev) {
    if (!connected || !player || !playerReady) return;
    const st = player.getPlayerState(), t = player.getCurrentTime();
    const playing = ev === 'play' ? true : ev === 'pause' ? false : (st === 1 || st === 3);
    relay({ kind: 'sync', ev, playing, time: t, rate: player.getPlaybackRate() });
    lastT = t; lastAt = Date.now(); lastPlaying = playing; lastRate = player.getPlaybackRate();
  }
  function onState(e) {
    const st = e.data;
    // the video really finished (not just an ad): every phone says so, the server only acts on the first report
    if (st === 0 && currentId && connected && !inAd && player && typeof player.getDuration === 'function') {
      const dur = player.getDuration() || 0;
      if (dur > 0 && player.getCurrentTime() >= dur - 3) send({ t: 'q', op: 'advance', id: currentId });
    }
    if (afterLoad && (st === 1 || st === 5)) { flush(); return; }
    if (!ok()) return;
    if (st === 1) sendSync('play');
    else if (st === 2) sendSync('pause');
  }

  // seek detection + ad guard (YouTube's API has no seek event)
  setInterval(() => {
    if (!player || !playerReady || typeof player.getCurrentTime !== 'function') return;
    const dur = player.getDuration() || 0;
    if (dur > 0) {
      if (dur > mainDur) mainDur = dur;
      const ad = mainDur > 0 && dur < mainDur * 0.8;      // much shorter than the main video = probably an ad
      if (ad !== inAd) {
        inAd = ad;
        if (ad) sys('Ad playing: sync paused for you');
        else { lastAt = 0; send({ t: 'req' }); sys('Ad finished: catching up'); }
      }
    }
    if (inAd) return;
    const t = player.getCurrentTime(), now = Date.now(), st = player.getPlayerState();
    if (lastAt && Date.now() >= applyUntil) {
      const expected = lastPlaying ? lastT + (now - lastAt) / 1000 * lastRate : lastT;
      if (Math.abs(t - expected) > (lastPlaying ? 1.5 : 0.8)) { sendSync('seeked'); return; }
    }
    if (isLeader && st === 1 && ok() && now >= nextBeat) { nextBeat = now + 4000; sendSync('beat'); return; }
    lastT = t; lastAt = now; lastPlaying = st === 1; lastRate = player.getPlaybackRate();
  }, 500);

  // ================= tabs =================
  function showTab(name) {
    tab = name;
    ['browse', 'queue', 'chat'].forEach(n => {
      $('pane-' + n).classList.toggle('hidden', n !== name);
      $('tab-' + n).classList.toggle('on', n === name);
    });
    if (name === 'chat') { $('chat-dot').classList.add('hidden'); scrollChat(); }
  }
  $('tab-browse').onclick = () => showTab('browse');
  $('tab-queue').onclick = () => showTab('queue');
  $('tab-chat').onclick = () => showTab('chat');
  $('next-btn').onclick = () => { if (currentId) send({ t: 'q', op: 'advance', id: currentId }); };
  $('now-chan').onclick = () => { if (currentChannelId && window.ShaanBrowse) window.ShaanBrowse.openChannel(currentChannelId, currentChannel); };

  // ================= play a video for everyone =================
  // item: { id, title, channel, channelId } (from the feed, search, a channel page, the queue or a pasted link)
  function play(item) {
    const title = String(item.title || '').slice(0, 120), channel = String(item.channel || '').slice(0, 60);
    const channelId = /^UC[\w-]{22}$/.test(item.channelId || '') ? item.channelId : '';
    unlocked = true; $('unlock').classList.add('hidden');
    desired = null;
    setVideo(item.id, 0, true, 1);
    setNow(title, channel, channelId);                       // after setVideo: the bar needs to know a video is loaded
    relay({ kind: 'load', id: item.id, title, channel, channelId, time: 0, playing: true, rate: 1 });
    sys('You are playing' + (title ? ': ' + title : ' a video'));
  }

  // what the browse screens (browse.js) use
  window.ShaanRoom = {
    play, showTab, sys,
    queueOp: (op, extra) => send({ t: 'q', op, ...(extra || {}) }),
    getQueue: () => queue.slice(),
    getNow: () => ({ id: currentId, title: currentTitle, channel: currentChannel, channelId: currentChannelId }),
    onQueue: f => { queueListeners.push(f); },
    onStart: f => { startListeners.push(f); },
    onNow: f => { nowListeners.push(f); },
    code: () => room,
    me: () => ({ name, icon })
  };

  // a tap inside our page gives the browser permission to start playback (needed on iPhone)
  $('unlock').onclick = () => {
    unlocked = true; $('unlock').classList.add('hidden');
    if (desired) applyState(desired);
    else if (player && playerReady) player.playVideo();
  };
})();
