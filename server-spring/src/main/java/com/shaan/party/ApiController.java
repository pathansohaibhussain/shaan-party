package com.shaan.party;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The web room's HTTP API: browse / search (YouTube) and the iPhone "share to room" endpoint. */
@RestController
public class ApiController {
    private final YouTubeApi yt;
    private final PartyHandler party;

    public ApiController(YouTubeApi yt, PartyHandler party) {
        this.yt = yt;
        this.party = party;
    }

    private static String who(HttpServletRequest req) {
        // behind Render / ngrok the real caller is the first address in X-Forwarded-For
        String fwd = req.getHeader("X-Forwarded-For");
        return (fwd != null && !fwd.isBlank()) ? fwd.split(",")[0].trim() : req.getRemoteAddr();
    }

    private static ResponseEntity<String> json(YouTubeApi.Reply r) {
        return ResponseEntity.status(r.status())
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Cache-Control", "no-store")
                .body(r.body());
    }

    @GetMapping("/api/search")
    public ResponseEntity<String> search(@RequestParam(name = "q", required = false) String q,
                                         @RequestParam(name = "type", required = false) String type,
                                         HttpServletRequest req) {
        return json(yt.search(q, type, who(req)));
    }

    @GetMapping("/api/trending")
    public ResponseEntity<String> trending(@RequestParam(name = "cat", required = false) String cat,
                                           @RequestParam(name = "page", required = false) String page,
                                           HttpServletRequest req) {
        return json(yt.trending(cat, page, who(req)));
    }

    @GetMapping("/api/channel")
    public ResponseEntity<String> channel(@RequestParam(name = "id", required = false) String id,
                                          @RequestParam(name = "page", required = false) String page,
                                          HttpServletRequest req) {
        return json(yt.channel(id, page, who(req)));
    }

    @GetMapping("/api/playlist")
    public ResponseEntity<String> playlist(@RequestParam(name = "id", required = false) String id,
                                           @RequestParam(name = "page", required = false) String page,
                                           HttpServletRequest req) {
        return json(yt.playlist(id, page, who(req)));
    }

    // ---- iPhone share: an iOS Shortcut sends the link of the video you are watching in the YouTube app ----

    @GetMapping("/api/share")
    public ResponseEntity<String> shareGet(@RequestParam(name = "room", required = false) String room,
                                           @RequestParam(name = "url", required = false) String url,
                                           @RequestParam(name = "mode", required = false) String mode,
                                           @RequestParam(name = "name", required = false) String name,
                                           HttpServletRequest req) {
        return share(room, url, mode, name, who(req));
    }

    @PostMapping(value = "/api/share", consumes = "application/json")
    public ResponseEntity<String> shareJson(@RequestBody(required = false) JsonNode body, HttpServletRequest req) {
        JsonNode b = body == null ? com.fasterxml.jackson.databind.node.MissingNode.getInstance() : body;
        return share(b.path("room").asText(""), b.path("url").asText(""), b.path("mode").asText(""), b.path("name").asText(""), who(req));
    }

    @PostMapping(value = "/api/share", consumes = "application/x-www-form-urlencoded")
    public ResponseEntity<String> shareForm(@RequestParam(name = "room", required = false) String room,
                                            @RequestParam(name = "url", required = false) String url,
                                            @RequestParam(name = "mode", required = false) String mode,
                                            @RequestParam(name = "name", required = false) String name,
                                            HttpServletRequest req) {
        return share(room, url, mode, name, who(req));
    }

    private ResponseEntity<String> share(String room, String url, String mode, String name, String who) {
        if (!yt.allowCall(who)) return shareReply(429, "rate_limited", "Too many requests. Try again in a minute.", null);
        String r = room == null ? "" : room.trim();
        if (!r.matches("[\\w-]{3,32}")) return shareReply(400, "bad_room", "That is not a room code.", null);
        String id = LinkParser.videoId(url);
        if (id == null) return shareReply(400, "not_a_video", "That does not look like a YouTube video link.", null);
        if (!party.roomActive(r)) return shareReply(404, "room_empty", "Nobody is in that room right now. Open the room first.", null);
        YouTubeApi.VideoInfo v = yt.videoInfo(id);
        boolean playNow = !"queue".equalsIgnoreCase(mode == null ? "" : mode.trim());
        String result = party.share(r, v.id(), v.title(), v.channel(), v.dur(), playNow, name);
        if (result.equals("room_empty")) return shareReply(404, "room_empty", "Nobody is in that room right now. Open the room first.", null);
        if (result.equals("queue_full")) return shareReply(409, "queue_full", "The queue is full.", null);
        return shareReply(200, null, null, v.title().isEmpty() ? "a video" : v.title());
    }

    private static ResponseEntity<String> shareReply(int status, String code, String message, String title) {
        String body = code == null
                ? "{\"ok\":true,\"title\":" + TextUtil.jsonQuote(title) + "}"
                : "{\"error\":" + TextUtil.jsonQuote(code) + ",\"message\":" + TextUtil.jsonQuote(message) + "}";
        return ResponseEntity.status(status)
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Cache-Control", "no-store")
                .body(body);
    }
}
