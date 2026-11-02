// Generic adapter: works on any page the user has enabled.
// Top frame   = party side. Collects every <video> (own page + iframes), classifies each as
//               movie / ad / other by length, and only syncs the movie.
// Child frame = "agent": reports all of its videos to the top frame and obeys commands.
(() => {
  if (window.__spGenericLoaded) return;
  window.__spGenericLoaded = true;
  const MIN_AREA = 150 * 80;

  function allVideos(root, deep, out) {
    root.querySelectorAll('video').forEach(v => out.push(v));
    if (deep) root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) allVideos(el.shadowRoot, deep, out); });
    return out;
  }
  function localVideos() {
    let l = allVideos(document, false, []);
    if (!l.length) l = allVideos(document, true, []);      // open shadow DOM only if nothing else found
    return l;
  }
  const areaOf = v => { const r = v.getBoundingClientRect(); return r.width * r.height; };

  // ---------------- AGENT (inside iframes) ----------------
  if (window !== window.top) {
    const ids = new WeakMap(), bound = new WeakSet(), byId = new Map();
    let nextId = 1;
    const idOf = v => { if (!ids.has(v)) ids.set(v, nextId++); return ids.get(v); };
    const EVS = ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange'];
    const send = (v, ev) => window.top.postMessage({
      sp: 'sp-agent', ver: 2, ev, vid: idOf(v), paused: v.paused, t: v.currentTime, rate: v.playbackRate,
      dur: v.duration, area: areaOf(v), host: location.hostname
    }, '*');
    function scan() {
      byId.forEach((v, id) => { if (!v.isConnected) byId.delete(id); });
      localVideos().slice(0, 6).forEach(v => {
        byId.set(idOf(v), v);
        if (!bound.has(v)) { bound.add(v); EVS.forEach(e => v.addEventListener(e, () => send(v, e))); }
        send(v, 'tick');
      });
    }
    setInterval(scan, 1500);
    window.addEventListener('message', e => {
      const m = e.data;
      if (e.source !== window.top || !m || m.sp !== 'sp-agent-cmd') return;
      const v = byId.get(m.vid);
      if (!v) return;
      if (m.cmd === 'play') v.play().catch(() => window.top.postMessage({ sp: 'sp-agent', ev: 'blocked' }, '*'));
      else if (m.cmd === 'pause') v.pause();
      else if (m.cmd === 'seek') v.currentTime = m.value;
      else if (m.cmd === 'rate') v.playbackRate = m.value;
    });
    return;
  }

  // ---------------- TOP FRAME ----------------
  class AgentVideo extends EventTarget {      // looks like a <video> to the core, forwards to the iframe agent
    constructor(win, vid) { super(); this.win = win; this.vid = vid; this.s = { paused: true, t: 0, rate: 1, dur: 0, at: Date.now() }; }
    get paused() { return this.s.paused; }
    get currentTime() { return this.s.paused ? this.s.t : this.s.t + (Date.now() - this.s.at) / 1000 * this.s.rate; }
    set currentTime(t) { this.s.t = t; this.s.at = Date.now(); this._cmd('seek', t); }
    get playbackRate() { return this.s.rate; }
    set playbackRate(r) { this.s.rate = r; this._cmd('rate', r); }
    get duration() { return this.s.dur; }
    get readyState() { return 4; }
    play() { this.s.at = Date.now(); this.s.paused = false; this._cmd('play'); return Promise.resolve(); }
    pause() { this.s.t = this.currentTime; this.s.paused = true; this._cmd('pause'); }
    _cmd(cmd, value) { try { this.win.postMessage({ sp: 'sp-agent-cmd', vid: this.vid, cmd, value }, '*'); } catch (e) {} }
    update(m) {
      this.s = { paused: m.paused, t: m.t, rate: m.rate, dur: m.dur, at: Date.now() };
      if (['play', 'pause', 'seeked', 'ratechange'].includes(m.ev)) this.dispatchEvent(new Event(m.ev));
    }
  }

  const agents = new Map();   // iframe window -> Map(vid -> entry)
  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.sp !== 'sp-agent' || e.source === window) return;
    if (m.ev !== 'blocked' && m.ver !== 2) return;      // ignore leftover helpers from older versions
    if (m.ev === 'blocked') { if (window.ShaanCore) window.ShaanCore.notice('Browser blocked autoplay inside the player. Click the video once.'); return; }
    let w = agents.get(e.source);
    if (!w) { w = new Map(); agents.set(e.source, w); }
    let a = w.get(m.vid);
    if (!a) { a = { proxy: new AgentVideo(e.source, m.vid), area: 0, dur: 0, paused: true, seen: 0, host: '' }; w.set(m.vid, a); }
    a.area = m.area; a.dur = m.dur; a.paused = m.paused; a.host = m.host; a.seen = Date.now();
    a.proxy.update(m);
  });

  // ---- expected movie length (from the page itself, or set manually) ----
  const parseISO = s => { const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)$/.exec(s || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
  function fromLd() {
    for (const n of document.querySelectorAll('script[type="application/ld+json"]')) {
      let j; try { j = JSON.parse(n.textContent); } catch (e) { continue; }
      const stack = [].concat(j);
      while (stack.length) {
        const o = stack.pop();
        if (!o || typeof o !== 'object') continue;
        if (Array.isArray(o)) { stack.push(...o); continue; }
        if (o['@graph']) stack.push(...[].concat(o['@graph']));
        if (/Movie|Episode|VideoObject/.test([].concat(o['@type'] || []).join(' ')) && o.duration) { const s = parseISO(o.duration); if (s) return s; }
      }
    }
    return 0;
  }
  let expCache = { key: '', sec: 0, src: '', at: 0 };
  function expected() {
    const key = location.pathname, now = Date.now();
    if (expCache.key === key && (expCache.sec || now - expCache.at < 10000)) return expCache;
    let sec = 0, src = '';
    try { const ov = sessionStorage.getItem('sp_expected_min'); if (ov) { sec = Number(ov) * 60; src = 'set manually'; } } catch (e) {}
    if (!sec) { const s = fromLd(); if (s) { sec = s; src = 'page data'; } }
    if (!sec) { const m = document.querySelector('meta[property="video:duration"],meta[property="og:video:duration"]'); const n = m && Number(m.content); if (n > 0) { sec = n; src = 'page meta'; } }
    expCache = { key, sec, src, at: now };
    return expCache;
  }
  function classify(dur) {
    if (Number.isNaN(dur) || dur === 0) return 'loading';
    if (!isFinite(dur)) return 'live';
    const exp = expected().sec;
    if (exp) return dur >= exp * 0.7 && dur <= exp * 1.35 ? 'movie' : dur < exp * 0.5 ? 'ad' : 'other';
    return dur >= 60 ? 'movie' : 'short';
  }

  let cc = { at: 0, list: [] };
  function candidates() {
    if (Date.now() - cc.at < 300) return cc.list;
    const out = [], now = Date.now();
    localVideos().forEach(v => out.push({ el: v, src: 'page', host: location.hostname, area: areaOf(v), dur: v.duration, paused: v.paused, ready: v.readyState >= 1 }));
    agents.forEach(w => w.forEach(a => { if (now - a.seen < 5000) out.push({ el: a.proxy, src: 'player frame', host: a.host, area: a.area, dur: a.dur, paused: a.paused, ready: true }); }));
    out.forEach(c => { c.kind = c.area < MIN_AREA ? 'tiny' : !c.ready ? 'loading' : classify(c.dur); });
    cc = { at: now, list: out };
    return out;
  }
  function pick(cs) {
    const best = list => list.reduce((b, c) => (!b || c.area > b.area ? c : b), null);
    return best(cs.filter(c => c.kind === 'movie' || c.kind === 'live')) || best(cs.filter(c => c.kind === 'other' || c.kind === 'short'));
  }

  // (when an ad ends, the core asks the party for the current position, for every platform)
  let adCache = false, adAt = 0;
  function isAd() {
    const now = Date.now();
    if (now - adAt > 400) {
      adAt = now;
      adCache = candidates().some(c => c.kind === 'ad' && !c.paused);
    }
    return adCache;
  }

  window.ShaanPlatform = {
    id: 'generic',
    isHost: h => h === location.hostname,
    getVideo: () => { const c = pick(candidates()); return c ? c.el : null; },
    isAdPlaying: isAd,
    pageKey: href => { try { return new URL(href).pathname; } catch (e) { return ''; } },
    setExpected: minutes => {
      try { if (minutes > 0) sessionStorage.setItem('sp_expected_min', String(minutes)); else sessionStorage.removeItem('sp_expected_min'); } catch (e) {}
      expCache = { key: '', sec: 0, src: '', at: 0 }; cc = { at: 0, list: [] };
    },
    diagnose: () => {
      const cs = candidates(), sel = pick(cs), exp = expected();
      return {
        expectedSec: exp.sec, expectedSource: exp.src,
        candidates: cs.map(c => ({ where: c.src, host: c.host, kind: c.kind, dur: isFinite(c.dur) ? Math.round(c.dur) : (Number.isNaN(c.dur) ? -2 : -1), paused: c.paused, selected: c === sel }))
      };
    }
  };
})();
