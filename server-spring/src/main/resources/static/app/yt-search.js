// Helpers for the web room's browse / search screens. No DOM in here, so they can be unit-tested with node.
(function (root) {
  'use strict';

  const ID = /^[\w-]{11}$/;
  const CHANNEL_ID = /^UC[\w-]{22}$/;
  const PLAYLIST_ID = /^[\w-]{10,64}$/;
  const isId = s => typeof s === 'string' && ID.test(s);

  // ---------- links ----------
  // Find the first YouTube link inside whatever was typed or pasted (a bare id, a link with or without "https://",
  // or share text such as "Cool song https://youtu.be/abc..."). Returns a URL object or null.
  function findUrl(input) {
    const s = String(input == null ? '' : input).trim();
    const m = s.match(/(?:^|[\s<("'])((?:https?:\/\/)?(?:[\w-]+\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S*)/i);
    if (!m) return null;
    let raw = m[1];
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    try {
      const u = new URL(raw);
      u.__host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
      return u;
    } catch (e) { return null; }
  }
  const take = v => { const x = String(v || '').match(/^([\w-]{11})(?![\w-])/); return x ? x[1] : null; };

  function parseYT(input) {
    const s = String(input == null ? '' : input).trim();
    if (ID.test(s)) return s;
    const u = findUrl(s);
    if (!u) return null;
    if (u.__host === 'youtu.be') return take(u.pathname.slice(1));
    if (u.__host === 'youtube.com' || u.__host === 'youtube-nocookie.com') {
      const v = take(u.searchParams.get('v'));
      if (v) return v;
      const p = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})(?![\w-])/);
      if (p) return p[1];
    }
    return null;
  }
  function parsePlaylist(input) {
    const u = findUrl(input);
    if (!u || !(u.__host === 'youtube.com' || u.__host === 'youtube-nocookie.com')) return null;
    const l = u.searchParams.get('list');
    return l && PLAYLIST_ID.test(l) ? l : null;
  }
  function parseChannel(input) {
    const u = findUrl(input);
    if (!u || u.__host !== 'youtube.com') return null;
    const m = u.pathname.match(/^\/channel\/(UC[\w-]{22})(?![\w-])/);
    return m ? m[1] : null;
  }

  // ---------- text ----------
  const normalizeQuery = q => String(q == null ? '' : q).trim().replace(/\s+/g, ' ').slice(0, 80);

  // newest first, no duplicates (ignoring case), at most `max`
  function addRecent(list, q, max) {
    const n = normalizeQuery(q);
    const base = Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
    if (!n) return base.slice(0, max || 6);
    return [n, ...base.filter(x => x.toLowerCase() !== n.toLowerCase())].slice(0, max || 6);
  }

  // 3723 -> "1:02:03", 65 -> "1:05", 0 or junk -> ""
  function fmtDuration(sec) {
    sec = Math.floor(Number(sec));
    if (!(sec > 0)) return '';
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }

  // 999 -> "999", 1234 -> "1.2K", 12345 -> "12K", 1500000 -> "1.5M"
  function fmtCount(n) {
    n = Math.floor(Number(n));
    if (!(n >= 0)) return '';
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [size, letter] of units) {
      if (n >= size) {
        const v = n / size;
        return (v < 10 ? String(Math.floor(v * 10) / 10).replace(/\.0$/, '') : String(Math.floor(v))) + letter;
      }
    }
    return String(n);
  }

  // "2026-10-30T10:00:00Z" -> "2 days ago"
  function timeAgo(iso, now) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '';
    const sec = Math.max(0, Math.floor(((now == null ? Date.now() : now) - t) / 1000));
    const steps = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [size, word] of steps) {
      if (sec >= size) { const n = Math.floor(sec / size); return n + ' ' + word + (n === 1 ? '' : 's') + ' ago'; }
    }
    return 'just now';
  }

  // "Channel name" -> a steady colour, so channels without a picture still look distinct
  function colorFor(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ',45%,38%)';
  }
  const initialOf = name => (Array.from(String(name || '').trim())[0] || '?').toUpperCase();

  // ---------- results from the server ----------
  // Pictures may only come from YouTube's own image hosts.
  function safeThumb(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && ['i.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com'].indexOf(u.hostname) !== -1 ? u.href : '';
    } catch (e) { return ''; }
  }
  const num = (v, min, max) => { v = Math.floor(Number(v)); return isFinite(v) ? Math.max(min, Math.min(max, v)) : 0; };
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);

  // Never trust what comes back from the network: keep only well-formed rows, cut long text, check every id.
  function cleanItems(list, max) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const kind = r.kind === 'channel' || r.kind === 'playlist' ? r.kind : 'video';
      if (kind === 'video') {
        if (!isId(r.id)) continue;
        out.push({
          kind, id: r.id, title: str(r.title, 120), channel: str(r.channel, 60),
          channelId: CHANNEL_ID.test(r.channelId || '') ? r.channelId : '',
          dur: num(r.dur, 0, 43200), views: num(r.views, 0, 1e13),
          published: /^\d{4}-\d\d-\d\dT/.test(r.published || '') ? str(r.published, 30) : '', live: r.live === true
        });
      } else if (kind === 'channel') {
        if (!CHANNEL_ID.test(r.id || '')) continue;
        out.push({
          kind, id: r.id, title: str(r.title, 80), handle: /^@[\w.-]{1,40}$/.test(r.handle || '') ? r.handle : '',
          thumb: safeThumb(r.thumb), subs: r.subs === -1 ? -1 : num(r.subs, 0, 1e12), videos: num(r.videos, 0, 1e9), desc: str(r.desc, 120)
        });
      } else {
        if (!PLAYLIST_ID.test(r.id || '')) continue;
        out.push({
          kind, id: r.id, title: str(r.title, 120), channel: str(r.channel, 60),
          channelId: CHANNEL_ID.test(r.channelId || '') ? r.channelId : '', count: num(r.count, 0, 1e6), thumb: safeThumb(r.thumb)
        });
      }
      if (out.length >= (max || 50)) break;
    }
    return out;
  }

  // the only fields the room needs to queue a video
  const queueItem = v => ({ id: v.id, title: str(v.title, 120), channel: str(v.channel, 60), dur: num(v.dur, 0, 43200) });

  const api = { parseYT, parsePlaylist, parseChannel, normalizeQuery, addRecent, fmtDuration, fmtCount, timeAgo, colorFor, initialOf, safeThumb, cleanItems, queueItem, isId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShaanYT = api;
})(typeof window !== 'undefined' ? window : globalThis);
