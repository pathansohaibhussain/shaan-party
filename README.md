# Shaan Party

Private watch parties. No accounts: share a room code and everyone's play / pause / seek / speed stays in sync, with chat, reactions and GIFs next to the video.

| Part | What it is |
|---|---|
| `extension/` | Chrome extension (MV3, v1.9.0). Works on Hotstar, YouTube, local video files, and any other site you enable by hand |
| `server-spring/` | The server (Java 17, Spring Boot). A small WebSocket relay, and it also hosts the web room |
| web room | `<server>/app`: YouTube only, runs in any phone or browser, no extension needed. A YouTube-style app: browse, search, channels, playlists, shared queue, chat |

## Run it
1. Install Java 17+ and Maven. For friends outside your network also install [ngrok](https://ngrok.com).
2. Copy `party.config.example.json` to `party.config.json` and put your ngrok URL in it (skip if you only play on your own network).
3. Double-click **`start-party.bat`**. It starts the server and the tunnel and prints the server URL for the popup.
   Manual start: `cd server-spring && mvn spring-boot:run` (listens on `ws://localhost:8080`, `PORT` env var changes it).
4. Chrome: `chrome://extensions` > Developer mode > Load unpacked > pick the `extension` folder. After updating the folder, press the reload button on the extension card.
5. Open a video, click the extension icon, set the **Server URL** (`ws://localhost:8080` or the printed `wss://...`), press **Start a party on this tab**, then send the 🔗 link from the sidebar.
   Friends need the extension, the same server URL, and their own Hotstar subscription (or the same video file for local playback).

### The phone web room (looks and feels like YouTube)
Open `<server>/app` on the phone (iPhone: Safari, then Share > Add to Home Screen for an app-like icon). Create a room, send the invite 🔗, and everyone joins.

- **Browse tab:** a YouTube-style home feed (Trending for your country) with category chips (Music, Gaming, Movies, ...). Tap a video and it starts for everyone.
- **Search:** tap the search bar, type, tap a result. Tabs for **Videos / Channels / Playlists**. Paste any YouTube link into the same box (video, playlist or channel) and it opens straight away. The **📋** button does the same with whatever you just copied.
- **⋮ on any video:** Play now, Play next, Add to the queue, Go to channel. Channel and playlist pages have **Play all** and **Add all to the queue**.
- **Queue tab:** one shared "Up next" list for the whole room (up to 50). Tap a row to play it now, ✕ removes it. When a video ends, the next one starts by itself for everyone. **⏭ Next** skips.
- **Chat tab:** chat, reactions, members (a red dot shows new messages while you are on another tab).
- **📲 Share from the YouTube app (iPhone):** tap the 📲 button in the room header. It shows how to make a one-time iOS Shortcut so that *Share > Shaan Party* inside the real YouTube app (your Premium, no ads) plays or queues that video for the whole room. The page fills in your server address and room code. The same thing works from any tool that can send `POST /api/share` (see Protocol).

**One-time setup for browse + search (free, about 5 minutes):** these need a YouTube Data API key. The key stays on the server (it is never sent to phones).
1. Go to <https://console.cloud.google.com>, sign in with a Google account and create a project (any name, e.g. Shaan Party).
2. Open *APIs & Services > Library*, search for **YouTube Data API v3** and press **Enable**.
3. Open *APIs & Services > Credentials > Create credentials > API key* and copy the key.
4. Recommended: click the new key > *API restrictions* > *Restrict key* > tick only **YouTube Data API v3** > Save. (Do not add website/IP restrictions: the server, not a website, uses the key.)
5. Paste the key into `party.config.json` as `"youtubeApiKey"` and restart with `start-party.bat`. (If you start the server by hand, set the `YOUTUBE_API_KEY` environment variable. On Render, add it under Environment.)

Without a key the room still works: pasting links, the queue, chat and sync do not need it. Only the feed and search are off.

**The daily allowance.** Google's free allowance is 10,000 "units" a day for everybody using your key. A **search costs 101**; the Trending feed, a channel page, a playlist or a video's details cost **1 to 3**. So you get roughly 90 searches a day, or thousands of browses. The server keeps a budget of 9,000 units (`YOUTUBE_DAILY_UNITS`), resets it at midnight Pacific time like YouTube does, remembers every answer for 10 to 30 minutes, and lets one person do at most 8 searches or 60 other requests a minute. When the budget runs out the room says so and pasting links still works. Trending uses `YOUTUBE_REGION` (default `IN`). Only videos that are allowed to play outside YouTube are shown. Ads still play in the embedded player and YouTube Premium does not apply there (the Shortcut above is the way to watch in the real app).

GIFs (extension): paste a free GIPHY API key into the extension popup. It is stored only in your browser. Never put it in a file that gets shared or committed.

## Host it free on Render (no PC or ngrok needed)
Render runs the server on the internet for free. Friends then use `https://<your-name>.onrender.com/app` on their phones, and `wss://<your-name>.onrender.com` in the extension popup.

1. **Put the project on GitHub (private).** Install Git, then in the project folder run `git init`, `git add .`, `git commit -m "Shaan Party"`. Create an empty **private** repository on github.com and run the 3 lines it shows under "push an existing repository". Before pushing, run `git status` and check that `party.config.json` is NOT listed (it is git-ignored on purpose).
2. Sign up at <https://render.com> with your GitHub account (no card needed for the free plan) and allow it to see the repository.
3. **New + > Web Service**, pick the repository, then set: Language **Docker**, Region **Singapore** (closest to India), Instance type **Free**. Leave the rest as it is.
4. Under *Environment Variables* add `YOUTUBE_API_KEY` = your key (only if you want browse and search; see the setup above). Optional: `YOUTUBE_REGION` (e.g. `IN`).
5. **Create Web Service.** The first build takes about 5 to 8 minutes. When the log says the service is live, open `https://<name>.onrender.com/app`.
6. In the extension popup set **Server URL** to `wss://<name>.onrender.com` and press the test button.

(`render.yaml` is also included, so *New + > Blueprint* can do steps 3 and 4 for you.)

What to expect on the free plan:
- It sleeps after 15 minutes without traffic and takes about a minute to wake. An open party counts as traffic (the apps ping every 10 s), so it stays awake while people are connected. Open the web room link a minute before you start.
- Rooms live in memory. If Render restarts the service, people reconnect by themselves, but the old chat is gone.
- Free instances have 512 MB RAM and 750 hours a month, enough for one always-on service. Changes you push to GitHub redeploy automatically.
- The address is public. Room codes are random, and your YouTube budget is capped (9,000 units a day, with per-person limits), so strangers cannot use up your allowance.

## How syncing works
- **Events.** Play, pause, seek and speed changes are sent to everyone. They carry a `sentAt` timestamp so receivers add the travel time (see clocks below).
- **Clocks.** Every client pings the server every 10 s (`ping {c}` -> `pong {c, s}`) and estimates its offset from the server clock, trusting the lowest round trip (`extension/core/sync-math.js`, `ClockSync`). Message lag = receiver's estimated server time minus `sentAt`, so two PCs with different clocks still agree.
- **Heartbeat / drift.** The member with the lowest id is the leader and sends a `beat` every ~4 s while playing. Followers correct against it: drift over 1.5 s seeks, 0.3 to 1.5 s gently changes speed by at most 5% until caught up (extension only; the YouTube iframe cannot do fractional speeds, so the web room only seeks). A beat never flips play/pause by itself; if play/pause disagrees on two beats in a row it is treated as real.
- **Late joiners.** The server remembers the newest `sync` / `load` of each room and replays it to anyone who joins; the new member also asks everyone (`req`), and every member that can answer (no ad playing, video loaded) does.
- **Ads.** While an ad plays on your side, sync is paused for you. When it ends the extension asks the party for the current position. YouTube ads are detected from the player; Hotstar ads are best effort (see below); generic sites classify videos by length.

## Hotstar ads: what is and isn't detected
Detected: a short video swapped into the player (under half the title's length), or a visible "Skip Ad" / "Ad 1 of 2" control. Not detected: ads stitched into the video stream itself. If you get out of sync after one of those, open 🩺 and press **Send my position** (or **Get party position**). The 🩺 panel also shows the title length seen and whether an ad hint is on screen, which is the first thing to check if detection misbehaves on your account/app version.

## Protocol
**HTTP (web room).** All answers are JSON. Errors look like `{error, message, left}`; successes carry `left` (units left today) and `searches` (about how many searches that is).
- `GET /api/trending?cat=<id>&page=<token>` : `{items:[video], next}`
- `GET /api/search?q=<text>&type=video|channel|playlist` : `{items, next:null}`
- `GET /api/channel?id=UC...&page=` : `{channel, items:[video], next}` (`channel` only on the first page)
- `GET /api/playlist?id=PL...&page=` : `{playlist, items:[video], next}`
- `POST /api/share` (JSON or form: `room`, `url`, `mode` = `play` (default) or `queue`, `name`) : `{ok:true, title}`. `GET` with the same query parameters works too. Errors: `bad_room`, `not_a_video`, `room_empty` (404, nobody is in that room), `queue_full`, `rate_limited`.
- Items: `video {kind,id,title,channel,channelId,dur,views,published,live}`, `channel {kind,id,title,handle,thumb,subs,videos,desc}`, `playlist {kind,id,title,channel,channelId,count,thumb}`.
- Error codes: `not_configured` 503, `bad_query` / `bad_request` / `bad_type` 400, `rate_limited` / `quota_exhausted` 429, `not_found` 404, `search_failed` 502.

**WebSocket (`/ws`, JSON).**
Client to server: `join {room, name, icon}`, `relay {data}`, `req`, `ping {c}`, `q {op, ...}` (queue).
Server to client: `welcome {id, others}`, `members {list}`, `msg {from, data}`, `pong {c, s}`, `queue {items:[{qid,id,title,channel,dur,by}]}`, `notice {text}`.
`data.kind` values: `sync` (`ev` = play, pause, seeked, ratechange, state, beat), `nav`, `chat`, `typing`, `file`, `req`, `load` (web room: `id`, `title`, `channel`, `channelId`, optional `note` shown in chat).
Queue ops (`q`): `add {item}`, `next {item}` (play next), `addAll {items}`, `replace {items}` (play-all: the queue becomes exactly these), `remove {qid}`, `clear`, `play {qid}` (play that one now), `advance {id}` (the video `id` ended, or Next was tapped). The server owns the queue: it answers every change by sending the whole list to everybody, and starts the next video itself (a `msg` from `"0"` with a `load` and a `note`). Every phone reports "ended", and only the first report that names the video playing now counts.
Room codes: 3-32 letters, digits, `_` or `-`.

## Tests
`npm test` (Node 18+, no dependencies) runs the extension tests (drift/clock/ad maths, the real `content-core.js` with a fake video and clock, the Hotstar ad logic), the web room tests (the real `app.js` + `browse.js` in a sandbox with a fake page, network and YouTube player: feed, search, channel and playlist pages, queue, auto-advance, iPhone fallback, share help) and checks of the Render files. One test also checks that `extension/core/sync-math.js` and the web room's copy `server-spring/src/main/resources/static/app/sync-math.js` are identical. If you edit one, copy it over the other.
`npm run check:java` (needs the JDK you already have for Maven) runs the server's plain-Java logic: the unit budget and Pacific-midnight reset, rate limits, cache lifetimes, link parsing (same cases as the web room tests), the shared queue, and the "only the first ended-report counts" rule.
The parts that talk to Spring and to Google are only compile-checked here, so after changing them run the server once (`mvn spring-boot:run`) and try a search.

## Folder map
    Dockerfile, render.yaml      for hosting on Render (see above)
    start-party.bat / .ps1       launcher for running on your own PC (reads party.config.json)
    party.config.example.json    copy to party.config.json (git-ignored)
    extension/                   see extension/README.md
    server-spring/               Spring Boot server + web room (src/main/resources/static/app)
