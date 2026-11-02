package com.shaan.party;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Everything the web room asks YouTube for: search, trending, channel pages, playlists, video details.
 * The API key lives only here (server side): it is never sent to browsers and never logged.
 * Every upstream call is paid for from a daily unit budget (SearchGuard) and answers are cached.
 */
@Component
public class YouTubeApi {
    /** What the controller sends back: an HTTP status and a JSON body. */
    public record Reply(int status, String body) {}

    /** Just enough about a video to queue it. */
    public record VideoInfo(String id, String title, String channel, int dur) {}

    /** A failed call, already translated into something a person can read. */
    private static final class ApiError extends Exception {
        private static final long serialVersionUID = 1L;
        final int status;
        final String code;
        final String reason;
        ApiError(int status, String code, String message, String reason) {
            super(message);
            this.status = status;
            this.code = code;
            this.reason = reason;
        }
    }

    private interface Job {
        ObjectNode run() throws ApiError;
    }

    private static final ObjectMapper OM = new ObjectMapper();
    private static final String BASE = "https://www.googleapis.com/youtube/v3/";
    private static final String VIDEO_PARTS = "snippet,contentDetails,statistics,status";
    private static final long MIN = 60_000L;
    /** one search = search.list (100 units) + a follow-up list call (1 unit) */
    static final int SEARCH_COST = 101;
    private static final String QUOTA_MSG = "Today's YouTube allowance is used up. You can still paste a YouTube link.";
    private static final String FAIL_MSG = "YouTube is not responding right now. You can still paste a link.";

    private final String apiKey;
    private final String region;
    private final SearchGuard guard;
    private final RateLimiter normal;
    private final RateLimiter expensive;
    private final HttpClient http;
    private final Map<String, VideoInfo> infoCache = new ConcurrentHashMap<>();

    public YouTubeApi(@Value("${youtube.api-key:}") String apiKey,
                      @Value("${youtube.daily-units:9000}") int dailyUnits,
                      @Value("${youtube.region:IN}") String region) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.region = region != null && region.trim().matches("[A-Za-z]{2}") ? region.trim().toUpperCase(Locale.ROOT) : "IN";
        Clock clock = Clock.systemUTC();
        this.guard = new SearchGuard(dailyUnits, 10 * MIN, 300, clock);
        this.normal = new RateLimiter(60, clock);
        this.expensive = new RateLimiter(8, clock);
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        System.out.println(this.apiKey.isEmpty()
                ? "[youtube] No API key set: browse and search are off (pasting links and the queue still work)."
                : "[youtube] On. Daily budget " + dailyUnits + " units (a search costs " + SEARCH_COST + ", most other calls 1). Region " + this.region + ".");
    }

    public boolean allowCall(String who) {
        return normal.allow(who);
    }

    // ------------------------------------------------------------------ public operations

    public Reply search(String rawQuery, String type, String who) {
        if (apiKey.isEmpty()) return notConfigured();
        String q = TextUtil.normalizeQuery(rawQuery);
        if (q.length() < 2 || q.length() > 80) return error(400, "bad_query", "Type between 2 and 80 characters.");
        String ty = type == null || type.isBlank() ? "video" : type;
        if (!ty.equals("video") && !ty.equals("channel") && !ty.equals("playlist")) return error(400, "bad_type", "Unknown search type.");
        if (!expensive.allow(who)) return error(429, "rate_limited", "Too many searches in a row. Try again in a minute.");
        return cachedOr("s|" + ty + "|" + q.toLowerCase(Locale.ROOT), 10 * MIN, () -> doSearch(q, ty));
    }

    public Reply trending(String category, String page, String who) {
        if (apiKey.isEmpty()) return notConfigured();
        String cat = category == null ? "" : category.trim();
        String pg = page == null ? "" : page.trim();
        if (!cat.isEmpty() && !cat.matches("\\d{1,3}")) return error(400, "bad_request", "Unknown category.");
        if (!pg.isEmpty() && !pg.matches("[\\w-]{1,100}")) return error(400, "bad_request", "Bad page.");
        if (!normal.allow(who)) return error(429, "rate_limited", "Slow down a little and try again in a minute.");
        return cachedOr("t|" + region + "|" + cat + "|" + pg, 30 * MIN, () -> {
            String qs = "part=" + VIDEO_PARTS + "&chart=mostPopular&maxResults=20&regionCode=" + region
                    + (cat.isEmpty() ? "" : "&videoCategoryId=" + cat) + pageParam(pg);
            ObjectNode out = OM.createObjectNode();
            try {
                JsonNode res = fetch("videos", qs, 1);
                appendVideos(out.putArray("items"), res, null);
                String next = res.path("nextPageToken").asText("");
                if (next.isEmpty()) out.putNull("next"); else out.put("next", next);
            } catch (ApiError e) {
                if (!"videoChartNotFound".equals(e.reason) && e.status != 404) throw e;   // some categories have no chart in some countries
                out.putArray("items");
                out.putNull("next");
            }
            return out;
        });
    }

    public Reply channel(String id, String page, String who) {
        if (apiKey.isEmpty()) return notConfigured();
        String pg = page == null ? "" : page.trim();
        if (id == null || !id.matches("UC[\\w-]{22}")) return error(400, "bad_request", "That is not a channel id.");
        if (!pg.isEmpty() && !pg.matches("[\\w-]{1,100}")) return error(400, "bad_request", "Bad page.");
        if (!normal.allow(who)) return error(429, "rate_limited", "Slow down a little and try again in a minute.");
        return cachedOr("c|" + id + "|" + pg, 15 * MIN, () -> {
            ObjectNode out = OM.createObjectNode();
            if (pg.isEmpty()) {
                JsonNode ch = fetch("channels", "part=snippet,statistics&id=" + enc(id), 1);
                JsonNode first = null;
                for (JsonNode it : ch.path("items")) { first = it; break; }
                if (first == null) throw new ApiError(404, "not_found", "That channel was not found.", "channelNotFound");
                out.set("channel", channelNode(first));
            }
            playlistPage("UU" + id.substring(2), pg, out);           // a channel's uploads playlist id is its id with UC -> UU
            return out;
        });
    }

    public Reply playlist(String id, String page, String who) {
        if (apiKey.isEmpty()) return notConfigured();
        String pg = page == null ? "" : page.trim();
        if (id == null || !id.matches("[\\w-]{10,64}")) return error(400, "bad_request", "That is not a playlist id.");
        if (!pg.isEmpty() && !pg.matches("[\\w-]{1,100}")) return error(400, "bad_request", "Bad page.");
        if (!normal.allow(who)) return error(429, "rate_limited", "Slow down a little and try again in a minute.");
        return cachedOr("p|" + id + "|" + pg, 15 * MIN, () -> {
            ObjectNode out = OM.createObjectNode();
            if (pg.isEmpty()) {
                JsonNode pl = fetch("playlists", "part=snippet,contentDetails&id=" + enc(id), 1);
                JsonNode first = null;
                for (JsonNode it : pl.path("items")) { first = it; break; }
                if (first == null) throw new ApiError(404, "not_found", "That playlist was not found (it may be private).", "playlistNotFound");
                out.set("playlist", playlistNode(first));
            }
            playlistPage(id, pg, out);
            return out;
        });
    }

    /** Title / channel / length of one video, for the iPhone share endpoint. Never fails: falls back to just the id. */
    public VideoInfo videoInfo(String id) {
        VideoInfo hit = infoCache.get(id);
        if (hit != null) return hit;
        VideoInfo fallback = new VideoInfo(id, "", "", 0);
        if (apiKey.isEmpty()) return fallback;
        try {
            JsonNode res = fetch("videos", "part=" + VIDEO_PARTS + "&id=" + enc(id), 1);
            for (JsonNode it : res.path("items")) {
                ObjectNode n = videoNode(it);
                if (n == null) continue;
                VideoInfo v = new VideoInfo(id, n.path("title").asText(""), n.path("channel").asText(""), n.path("dur").asInt(0));
                if (infoCache.size() > 300) infoCache.clear();
                infoCache.put(id, v);
                return v;
            }
        } catch (ApiError ignored) {
            // the share still works without a title
        }
        return fallback;
    }

    // ------------------------------------------------------------------ building answers

    private ObjectNode doSearch(String q, String ty) throws ApiError {
        String qs = "part=snippet&maxResults=" + (ty.equals("video") ? 15 : 10) + "&type=" + ty
                + "&regionCode=" + region + "&safeSearch=moderate&q=" + enc(q)
                + (ty.equals("video") ? "&videoEmbeddable=true&videoSyndicated=true" : "");
        JsonNode res = fetch("search", qs, 100);
        String idField = ty.equals("video") ? "videoId" : ty.equals("channel") ? "channelId" : "playlistId";
        List<String> ids = new ArrayList<>();
        for (JsonNode it : res.path("items")) {
            String id = it.path("id").path(idField).asText("");
            if (!id.isEmpty()) ids.add(id);
        }
        ObjectNode out = OM.createObjectNode();
        ArrayNode items = out.putArray("items");
        out.putNull("next");
        if (ids.isEmpty()) return out;
        String joined = enc(String.join(",", ids));
        if (ty.equals("video")) {
            appendVideos(items, fetch("videos", "part=" + VIDEO_PARTS + "&id=" + joined, 1), ids);
        } else if (ty.equals("channel")) {
            Map<String, JsonNode> by = byId(fetch("channels", "part=snippet,statistics&id=" + joined, 1));
            for (String id : ids) if (by.containsKey(id)) items.add(channelNode(by.get(id)));
        } else {
            Map<String, JsonNode> by = byId(fetch("playlists", "part=snippet,contentDetails&id=" + joined, 1));
            for (String id : ids) if (by.containsKey(id)) items.add(playlistNode(by.get(id)));
        }
        return out;
    }

    /** One page of a playlist (a channel's uploads are a playlist too): ids first, then details for those videos. */
    private void playlistPage(String playlistId, String page, ObjectNode out) throws ApiError {
        JsonNode res = fetch("playlistItems", "part=contentDetails&maxResults=20&playlistId=" + enc(playlistId) + pageParam(page), 1);
        List<String> ids = new ArrayList<>();
        for (JsonNode it : res.path("items")) {
            String v = it.path("contentDetails").path("videoId").asText("");
            if (!v.isEmpty()) ids.add(v);
        }
        ArrayNode items = out.putArray("items");
        if (!ids.isEmpty()) {
            appendVideos(items, fetch("videos", "part=" + VIDEO_PARTS + "&id=" + enc(String.join(",", ids)), 1), ids);
        }
        String next = res.path("nextPageToken").asText("");
        if (next.isEmpty()) out.putNull("next"); else out.put("next", next);
    }

    private static Map<String, JsonNode> byId(JsonNode res) {
        Map<String, JsonNode> m = new HashMap<>();
        for (JsonNode it : res.path("items")) m.put(it.path("id").asText(""), it);
        return m;
    }

    /** Add playable videos in the order asked for (or in YouTube's order when order is null). Private / removed / blocked ones drop out. */
    private static void appendVideos(ArrayNode items, JsonNode res, List<String> order) {
        if (order == null) {
            for (JsonNode it : res.path("items")) {
                ObjectNode n = videoNode(it);
                if (n != null) items.add(n);
            }
            return;
        }
        Map<String, JsonNode> by = byId(res);
        for (String id : order) {
            if (!by.containsKey(id)) continue;
            ObjectNode n = videoNode(by.get(id));
            if (n != null) items.add(n);
        }
    }

    private static ObjectNode videoNode(JsonNode item) {
        String id = item.path("id").asText("");
        if (!id.matches("[\\w-]{11}")) return null;
        JsonNode sn = item.path("snippet");
        String live = sn.path("liveBroadcastContent").asText("none");
        if (live.equals("upcoming")) return null;                                 // not started yet: nothing to play
        if (!item.path("status").path("embeddable").asBoolean(true)) return null; // would refuse to play in the room
        ObjectNode o = OM.createObjectNode();
        o.put("kind", "video");
        o.put("id", id);
        o.put("title", TextUtil.decodeEntities(sn.path("title").asText("")));
        o.put("channel", TextUtil.decodeEntities(sn.path("channelTitle").asText("")));
        o.put("channelId", sn.path("channelId").asText(""));
        o.put("dur", live.equals("live") ? 0 : Iso.durationSeconds(item.path("contentDetails").path("duration").asText("")));
        o.put("views", item.path("statistics").path("viewCount").asLong(0));
        o.put("published", sn.path("publishedAt").asText(""));
        o.put("live", live.equals("live"));
        return o;
    }

    private static ObjectNode channelNode(JsonNode item) {
        JsonNode sn = item.path("snippet");
        JsonNode st = item.path("statistics");
        ObjectNode o = OM.createObjectNode();
        o.put("kind", "channel");
        o.put("id", item.path("id").asText(""));
        o.put("title", TextUtil.decodeEntities(sn.path("title").asText("")));
        o.put("handle", sn.path("customUrl").asText(""));
        o.put("thumb", thumb(sn));
        o.put("subs", st.path("hiddenSubscriberCount").asBoolean(false) ? -1 : st.path("subscriberCount").asLong(0));
        o.put("videos", st.path("videoCount").asLong(0));
        o.put("desc", RoomQueue.clean(TextUtil.decodeEntities(sn.path("description").asText("")), 120));
        return o;
    }

    private static ObjectNode playlistNode(JsonNode item) {
        JsonNode sn = item.path("snippet");
        ObjectNode o = OM.createObjectNode();
        o.put("kind", "playlist");
        o.put("id", item.path("id").asText(""));
        o.put("title", TextUtil.decodeEntities(sn.path("title").asText("")));
        o.put("channel", TextUtil.decodeEntities(sn.path("channelTitle").asText("")));
        o.put("channelId", sn.path("channelId").asText(""));
        o.put("count", item.path("contentDetails").path("itemCount").asInt(0));
        o.put("thumb", thumb(sn));
        return o;
    }

    private static String thumb(JsonNode sn) {
        String m = sn.path("thumbnails").path("medium").path("url").asText("");
        return m.isEmpty() ? sn.path("thumbnails").path("default").path("url").asText("") : m;
    }

    // ------------------------------------------------------------------ talking to YouTube

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private static String pageParam(String page) {
        return page == null || page.isEmpty() ? "" : "&pageToken=" + enc(page);
    }

    /** One call to the YouTube API, paid for from today's budget. Nothing here ever logs the URL (it contains the key). */
    private JsonNode fetch(String endpoint, String query, int cost) throws ApiError {
        if (!guard.take(cost)) throw new ApiError(429, "quota_exhausted", QUOTA_MSG, "budget");
        try {
            String url = BASE + endpoint + "?" + query + "&key=" + enc(apiKey);
            HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8)).GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonNode root = OM.readTree(res.body());
            if (res.statusCode() == 200) return root;
            String reason = root.path("error").path("errors").path(0).path("reason").asText("unknown");
            System.err.println("[youtube] " + endpoint + " answered " + res.statusCode() + " (" + reason + ")");
            if (reason.equals("quotaExceeded") || reason.equals("dailyLimitExceeded")) {
                guard.exhaust();
                throw new ApiError(429, "quota_exhausted", QUOTA_MSG, reason);
            }
            guard.refund(cost);
            if (res.statusCode() == 404) throw new ApiError(404, "not_found", "Not found.", reason);
            throw new ApiError(502, "search_failed", FAIL_MSG, reason);
        } catch (ApiError e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            guard.refund(cost);
            throw new ApiError(502, "search_failed", FAIL_MSG, "interrupted");
        } catch (Exception e) {
            System.err.println("[youtube] " + endpoint + " failed: " + e.getClass().getSimpleName());   // class only: messages can contain the URL
            guard.refund(cost);
            throw new ApiError(502, "search_failed", FAIL_MSG, "exception");
        }
    }

    private Reply cachedOr(String key, long ttlMs, Job job) {
        String hit = guard.cached(key, ttlMs);
        if (hit != null) return ok(hit, true);
        try {
            String body = OM.writeValueAsString(job.run());
            guard.store(key, body);
            return ok(body, false);
        } catch (ApiError e) {
            return error(e.status, e.code, e.getMessage());
        } catch (Exception e) {
            System.err.println("[youtube] could not build an answer: " + e.getClass().getSimpleName());
            return error(502, "search_failed", FAIL_MSG);
        }
    }

    // ------------------------------------------------------------------ replies

    private String meta() {
        int left = guard.left();
        return "\"left\":" + left + ",\"searches\":" + (left / SEARCH_COST);
    }

    /** `body` is a finished JSON object; add the allowance and cache flag before its closing brace. */
    private Reply ok(String body, boolean cached) {
        return new Reply(200, body.substring(0, body.length() - 1) + "," + meta() + ",\"cached\":" + cached + "}");
    }

    private Reply notConfigured() {
        return error(503, "not_configured", "Browse and search are not set up on this server yet. You can still paste a YouTube link.");
    }

    Reply error(int status, String code, String message) {
        return new Reply(status, "{\"error\":" + TextUtil.jsonQuote(code) + ",\"message\":" + TextUtil.jsonQuote(message) + "," + meta() + "}");
    }
}
