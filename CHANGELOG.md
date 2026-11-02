# Changelog

## 1.11.0 (the web room becomes a small YouTube)
- New look: dark YouTube-style layout with the player on top, a title bar (tap the channel name to open the channel) and Browse / Queue / Chat tabs. Wide screens put the tabs beside the video.
- Browse: Trending feed with category chips, "Show more", cached per category.
- Search: Videos / Channels / Playlists; durations, view counts and "3 days ago" on every result; only videos that can play in the room are shown. Channel and playlist pages with Play all / Add all to the queue. Pasted playlist and channel links open their page.
- ⋮ menu on every video: Play now, Play next, Add to the queue, Go to channel.
- Shared queue (server side, so everyone always sees the same list): up to 50 videos, tap to play now, remove, clear, ⏭ Next, and automatic next video when one ends (only the first phone's "ended" report counts, so nothing is skipped).
- iPhone share: `POST /api/share` plus a 📲 help screen with your server address and room code, for a one-time Shortcut that sends the video you are watching in the real YouTube app to the room (play now or queue).
- Chat shows what is playing / queued ("Up next: ...", "Aisha added to the queue: ...").
- YouTube budget is now counted in real units (search 101, other calls 1 to 3) with a 9,000-unit daily cap; `YOUTUBE_DAILY_SEARCHES` is replaced by `YOUTUBE_DAILY_UNITS`, new `YOUTUBE_REGION`.
- Tests: web room tests rewritten for the new screens (34), 71 checks of the server's plain-Java logic.

## 1.10.1
- Render hosting: `Dockerfile` (memory-limited for the free 512 MB plan), `.dockerignore`, optional `render.yaml`, step-by-step guide in the README, and tests for the wiring.

## 1.10.0 (mobile web room)
- Search inside the web room: tap the search bar, type, tap a result, and it plays for everyone (thumbnails, channel, LIVE badge). Recent searches are one tap away.
- A pasted YouTube link (any common shape, even inside share text) plays directly from the same box; new **📋 Paste** button plays a copied link in one tap.
- Chat now says what is playing ("Aisha is playing: <title>"). Late joiners get the title too.
- iPhone fallback: if a video has not started a few seconds after loading (iOS blocks autoplay), the "Tap to start" button comes back.
- Server: new `GET /api/search` (YouTube Data API v3). The key stays on the server; searches are cached for 10 minutes, limited to 15 per minute per person and 90 per day (under the free quota, resetting at Pacific midnight like YouTube's). Only embeddable videos are returned.
- Launcher reads `youtubeApiKey` from `party.config.json`. Without a key, search is simply off and pasting links still works.
- Tests: 16 new web-room tests and a Java check for the quota guard (`npm test`, `npm run check:java`).

## 1.9.0
- Security: removed the GIPHY key from the notes file (rotate it, it was exposed); secrets and local settings are git-ignored.
- Drift correction: leader heartbeat every ~4 s; followers seek or gently change speed (extension) to stay together.
- Latency compensation: shared clock estimate (ping/pong) + `sentAt` stamps, so play/pause/seek land where the sender actually is.
- Late joiners: server replays the last known state of the room; `req` is sent to every member instead of only the first.
- Ads: Hotstar ad detection (best effort); every platform now asks the party for the position when an ad ends.
- Cleanup: removed the duplicate Node server (Spring is the only server); launcher no longer hard-codes a folder and reads `party.config.json`; "Someone left" now shows the name; docs rewritten; 30 tests added (`npm test`).
- Existing "Enable on this site" registrations are refreshed automatically when the extension updates.
