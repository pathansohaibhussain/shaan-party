// Hotstar / JioHotstar adapter. Tells the core how to work with this site.
// Ad detection is best effort (the site gives us no official signal):
//   1. a short video swapped into the player (much shorter than the real title) counts as an ad
//   2. a visible "Skip Ad" / "Ad 1 of 2" style control counts as an ad
// Ads that are stitched into the stream itself cannot be detected. Use 🩺 > "Send my position" after those.
(() => {
  const keyOf = href => { try { return new URL(href).pathname; } catch (e) { return ''; } };
  const getVideo = () => document.querySelector('video');
  const AD_TEXT = /^(skip\s+ads?|ads?\b\s*[:·|\-]?\s*\d+|ad\s+\d+\s+of|advertisement)/i;

  let main = { key: '', dur: 0 };          // longest non-ad duration seen on this title
  let hint = { at: 0, val: false };

  function adHint() {
    const now = Date.now();
    if (now - hint.at < 500) return hint.val;
    hint.at = now;
    let found = false;
    try {
      found = [...document.querySelectorAll('button,[role="button"],[aria-label]')].some(el => {
        if (!el.getClientRects().length) return false;                       // not visible
        const t = (el.getAttribute('aria-label') || el.textContent || '').trim();
        return t.length > 0 && t.length <= 40 && AD_TEXT.test(t);
      });
    } catch (e) {}
    hint.val = found;
    return found;
  }

  function isAdPlaying() {
    const v = getVideo();
    if (!v || !window.ShaanMath) return false;
    const key = keyOf(location.href);
    if (main.key !== key) main = { key, dur: 0 };                            // new title / episode
    const dur = v.duration;
    if (!(dur > 0) || !isFinite(dur)) return false;                          // loading or live
    const ad = window.ShaanMath.looksLikeAd({ dur, mainDur: main.dur, hint: adHint() });
    if (!ad && dur > main.dur) main.dur = dur;                               // only real content raises the "main" length
    return ad;
  }

  window.ShaanPlatform = {
    id: 'hotstar',
    isHost: h => /hotstar\.com$/.test(h),
    getVideo,
    isAdPlaying,
    // a "title" on Hotstar is identified by its path
    pageKey: keyOf,
    diagnose: () => ({ mainDur: Math.round(main.dur), adHint: hint.val })
  };
})();
