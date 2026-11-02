# Shaan Party extension layout

    manifest.json
    core/sync-math.js         pure helpers: drift decisions, clock sync, travel time, ad heuristic (no DOM, unit-tested)
    core/content-core.js      shared logic: sidebar, sync, heartbeat, navigation, toasts (no site-specific code)
    sidebar/                  chat UI + the WebSocket connection (html, css, js)
    background.js             service worker: frame list, per-site script registration, ad-tab closer
    popup/                    toolbar popup (settings, start/join, server test)
    platforms/
      hotstar/adapter.js      video / ad detection / page identity on Hotstar
      youtube/adapter.js      same for YouTube
      generic/adapter.js      prototype: any website, enabled per site from the popup (finds <video>, handles iframes)
      local/                  player page for local video files (adapter.js, player.html/.css/.js)
    tests/                    node --test files (run `npm test` in the project root)

Script order matters everywhere the core is injected: `core/sync-math.js`, then the platform adapter, then `core/content-core.js`.
A test checks the manifest, background.js, popup.js, player.html and sidebar.html.

## Adding a new platform (e.g. Netflix)
1. Create platforms/netflix/adapter.js defining window.ShaanPlatform = { id, isHost, getVideo, isAdPlaying, pageKey }.
   Optional: shareText, onJoined / onRemote (local player), setExpected, diagnose (extra lines for the 🩺 panel).
2. In manifest.json add the site to host_permissions, to web_accessible_resources.matches,
   and a new content_scripts entry: js ["core/sync-math.js", "platforms/netflix/adapter.js", "core/content-core.js"].
3. In popup/popup.js add the site's domain to the tab check regex.
4. Ads: make isAdPlaying() return true while an ad plays. The core then pauses sync for you and, when it ends, asks the party for the current position.
