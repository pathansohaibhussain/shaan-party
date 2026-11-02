// Local video player adapter. The "site" is the extension's own player page.
window.ShaanPlatform = {
  id: 'local',
  isHost: () => false,                         // no page-to-page navigation sync for local files
  getVideo: () => {
    const v = document.getElementById('video');
    return v && v.src && v.readyState >= 1 ? v : null;   // only once a file is loaded
  },
  isAdPlaying: () => false,
  pageKey: () => 'local',
  shareText: room => room                      // extension URLs differ per PC, so share the room code
};
