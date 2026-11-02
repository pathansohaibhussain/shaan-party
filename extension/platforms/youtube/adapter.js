// YouTube adapter. Tells the core how to work with this site.
window.ShaanPlatform = {
  id: 'youtube',
  isHost: h => /youtube\.com$/.test(h),
  getVideo: () => document.querySelector('#movie_player video.html5-main-video, video.html5-main-video, video'),
  // YouTube plays ads inside the same player element
  isAdPlaying: () => !!document.querySelector('.html5-video-player.ad-showing'),
  // a "title" on YouTube is the path plus the ?v= video id
  pageKey: href => {
    try { const u = new URL(href); const v = u.searchParams.get('v'); return u.pathname + (v ? '?v=' + v : ''); }
    catch (e) { return ''; }
  }
};
