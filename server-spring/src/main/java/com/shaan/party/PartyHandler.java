package com.shaan.party;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

@Component
public class PartyHandler extends TextWebSocketHandler {

    private static final Pattern ROOM = Pattern.compile("^[\\w-]{3,32}$");

    private record Client(String id, String room, String name, String icon, WebSocketSession out) {}

    /** Last known playback state and the shared queue of a room. Lives only while someone is in the room. */
    private static final class RoomState {
        JsonNode lastSync;   // newest "sync" payload (extension rooms)
        JsonNode lastLoad;   // newest "load" payload (web rooms)
        final AdvanceGate gate = new AdvanceGate();   // which video is playing and whether its "ended" report was already used
        final RoomQueue queue = new RoomQueue();
    }

    private final ObjectMapper om = new ObjectMapper();
    private final Map<String, List<Client>> rooms = new ConcurrentHashMap<>();
    private final Map<String, RoomState> states = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> safeSessions = new ConcurrentHashMap<>();
    private final AtomicLong nextId = new AtomicLong(1);

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        // Decorator makes concurrent sends to one session safe
        safeSessions.put(session.getId(), new ConcurrentWebSocketSessionDecorator(session, 5000, 64 * 1024));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode m;
        try {
            m = om.readTree(message.getPayload());
        } catch (Exception e) {
            return;
        }
        String t = m.path("t").asText("");
        Client me = (Client) session.getAttributes().get("client");

        // Clock sync: the client sends its local time in "c", we answer with ours in "s".
        // Clients use the round trip to work out how far their clock is from ours (see sync-math.js).
        if (t.equals("ping")) {
            WebSocketSession out = safeSessions.get(session.getId());
            if (out != null && out.isOpen()) {
                ObjectNode p = om.createObjectNode();
                p.put("t", "pong").put("c", m.path("c").asLong(0)).put("s", System.currentTimeMillis());
                try {
                    out.sendMessage(new TextMessage(om.writeValueAsString(p)));
                } catch (Exception ignored) {
                }
            }
            return;
        }

        if (t.equals("join") && me == null) {
            String room = m.path("room").asText("");
            if (!ROOM.matcher(room).matches()) {
                session.close(CloseStatus.POLICY_VIOLATION);
                return;
            }
            String name = cut(m.path("name").asText("Guest"), 24);
            String icon = cut(m.path("icon").asText("😎"), 8);
            Client c = new Client(String.valueOf(nextId.getAndIncrement()), room,
                    name.isBlank() ? "Guest" : name, icon.isBlank() ? "😎" : icon,
                    safeSessions.get(session.getId()));
            int others;
            synchronized (this) {
                List<Client> list = rooms.computeIfAbsent(room, k -> new CopyOnWriteArrayList<>());
                others = list.size();
                list.add(c);
            }
            session.getAttributes().put("client", c);
            ObjectNode w = om.createObjectNode();
            w.put("t", "welcome").put("id", c.id()).put("others", others);
            send(c, w);
            broadcastMembers(room);
            if (others > 0) {                  // new joiners get the last known position and the queue straight away
                replayState(c);
                RoomState st = states.get(room);
                if (st != null && st.queue.size() > 0) send(c, queueNode(st));
            }
            return;
        }
        if (me == null) return;

        if (t.equals("relay")) {
            remember(me.room(), m.path("data"));
            ObjectNode o = om.createObjectNode();
            o.put("t", "msg").put("from", me.id());
            o.set("data", m.path("data"));
            for (Client c : others(me)) send(c, o);
        } else if (t.equals("req")) {
            // ask everyone: members that cannot answer right now (ad playing, no video yet) simply stay quiet
            ObjectNode n = om.createObjectNode();
            n.put("t", "msg").put("from", me.id());
            n.putObject("data").put("kind", "req");
            for (Client c : others(me)) send(c, n);
        } else if (t.equals("q")) {
            handleQueue(me, m);
        }
        // anything else is ignored
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        safeSessions.remove(session.getId());
        Client me = (Client) session.getAttributes().get("client");
        if (me == null) return;
        boolean empty;
        synchronized (this) {
            List<Client> list = rooms.get(me.room());
            if (list != null) list.remove(me);
            empty = list == null || list.isEmpty();
            if (empty) { rooms.remove(me.room()); states.remove(me.room()); }
        }
        if (!empty) broadcastMembers(me.room());
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable ex) {
        // connection will be cleaned up in afterConnectionClosed
    }

    /** Keep the newest sync / load / nav payload per room. Nothing else is stored. */
    private void remember(String room, JsonNode data) {
        String kind = data.path("kind").asText("");
        if (!kind.equals("sync") && !kind.equals("load") && !kind.equals("nav")) return;
        RoomState st = states.computeIfAbsent(room, k -> new RoomState());
        synchronized (st) {
            if (kind.equals("sync")) {
                st.lastSync = data.deepCopy();
            } else if (kind.equals("load")) {
                st.lastLoad = data.deepCopy();
                st.lastSync = null;          // a new video starts a new timeline
                st.gate.loaded(data.path("id").asText(""), System.currentTimeMillis());
            } else {
                st.lastLoad = null;          // page / episode changed
                st.lastSync = null;
            }
        }
    }

    /** Send a joiner the last known state. The original "sentAt" stamp is kept, so the client can add the elapsed time. */
    private void replayState(Client c) {
        RoomState st = states.get(c.room());
        if (st == null) return;
        JsonNode load;
        JsonNode sync;
        synchronized (st) {
            load = st.lastLoad;
            sync = st.lastSync;
        }
        ObjectNode data = null;
        if (load != null && load.isObject()) {
            data = ((ObjectNode) load).deepCopy();
            if (sync != null && sync.isObject()) {   // the newest position beats the position at load time
                for (String f : new String[]{"time", "playing", "rate", "sentAt"}) {
                    if (sync.has(f)) data.set(f, sync.get(f));
                }
            }
        } else if (sync != null && sync.isObject()) {
            data = ((ObjectNode) sync).deepCopy();
            data.put("ev", "state");               // a replay is a state, not a fresh play / pause
        }
        if (data == null) return;
        ObjectNode o = om.createObjectNode();
        o.put("t", "msg").put("from", "0");
        o.set("data", data);
        send(c, o);
    }

    // ------------------------------------------------------------------ shared queue

    /**
     * Queue changes come in as {t:"q", op:...}. The server is the only place the queue is edited, so everyone always sees
     * the same list: it answers every change with the whole list ({t:"queue"}).
     * Ops: add, next (play next), addAll, replace, remove, clear, play (play one from the queue now), advance (the video ended or "next" was tapped).
     */
    private void handleQueue(Client me, JsonNode m) {
        RoomState st = states.computeIfAbsent(me.room(), k -> new RoomState());
        String op = m.path("op").asText("");
        boolean changed = false;
        RoomQueue.Item toPlay = null;
        String note = null;
        String notice = null;
        switch (op) {
            case "add": {
                JsonNode it = m.path("item");
                RoomQueue.Item added = st.queue.add(it.path("id").asText(""), it.path("title").asText(""), it.path("channel").asText(""), it.path("dur").asInt(0), me.name());
                if (added != null) { changed = true; notice = "➕ " + me.name() + " added to the queue: " + added.title(); }
                break;
            }
            case "next": {
                JsonNode it = m.path("item");
                RoomQueue.Item added = st.queue.addNext(it.path("id").asText(""), it.path("title").asText(""), it.path("channel").asText(""), it.path("dur").asInt(0), me.name());
                if (added != null) { changed = true; notice = "⏭ " + me.name() + " will play next: " + added.title(); }
                break;
            }
            case "addAll": {
                int n = 0;
                for (JsonNode it : m.path("items")) {
                    if (n >= RoomQueue.MAX) break;
                    if (st.queue.add(it.path("id").asText(""), it.path("title").asText(""), it.path("channel").asText(""), it.path("dur").asInt(0), me.name()) != null) n++;
                }
                if (n > 0) { changed = true; notice = "➕ " + me.name() + " added " + n + (n == 1 ? " video" : " videos") + " to the queue"; }
                break;
            }
            case "replace": {
                // "Play all" on a playlist: the queue becomes exactly these videos (the first one is loaded by the sender)
                st.queue.clear();
                int n = 0;
                for (JsonNode it : m.path("items")) {
                    if (n >= RoomQueue.MAX) break;
                    if (st.queue.add(it.path("id").asText(""), it.path("title").asText(""), it.path("channel").asText(""), it.path("dur").asInt(0), me.name()) != null) n++;
                }
                changed = true;
                notice = "📃 " + me.name() + " started a playlist" + (n > 0 ? " (" + n + " more up next)" : "");
                break;
            }
            case "remove":
                changed = st.queue.remove(m.path("qid").asLong(-1));
                break;
            case "clear":
                if (st.queue.size() > 0) { st.queue.clear(); changed = true; notice = "🗑 " + me.name() + " cleared the queue"; }
                break;
            case "play":
                toPlay = st.queue.take(m.path("qid").asLong(-1));
                if (toPlay != null) { changed = true; note = "▶ " + me.name() + " played from the queue: " + toPlay.title(); }
                break;
            case "advance": {
                // Every phone reports "my video ended", so only the first report counts: it must name the video that is
                // playing now, and a video that just started cannot end again within a few seconds.
                if (st.gate.claim(m.path("id").asText(""), System.currentTimeMillis())) {
                    toPlay = st.queue.pollFirst();
                    if (toPlay != null) { changed = true; note = "⏭ Up next: " + toPlay.title(); }
                }
                break;
            }
            default:
                return;
        }
        if (toPlay != null) issueLoad(me.room(), st, toPlay.id(), toPlay.title(), toPlay.channel(), note);
        if (changed) broadcast(me.room(), queueNode(st));
        if (notice != null) notice(me.room(), notice);
    }

    /** Start a video for everybody in the room (used by the queue and by the share endpoint). */
    private void issueLoad(String room, RoomState st, String id, String title, String channel, String note) {
        long now = System.currentTimeMillis();
        ObjectNode data = om.createObjectNode();
        data.put("kind", "load").put("id", id).put("title", title).put("channel", channel)
                .put("time", 0).put("playing", true).put("rate", 1).put("sentAt", now);
        if (note != null) data.put("note", note);
        synchronized (st) {
            st.lastLoad = data.deepCopy();
            st.lastSync = null;
            st.gate.loaded(id, now);
        }
        ObjectNode o = om.createObjectNode();
        o.put("t", "msg").put("from", "0");
        o.set("data", data);
        broadcast(room, o);
    }

    private ObjectNode queueNode(RoomState st) {
        ObjectNode o = om.createObjectNode();
        o.put("t", "queue");
        ArrayNode arr = o.putArray("items");
        for (RoomQueue.Item it : st.queue.snapshot()) {
            arr.addObject().put("qid", it.qid()).put("id", it.id()).put("title", it.title())
                    .put("channel", it.channel()).put("dur", it.dur()).put("by", it.by());
        }
        return o;
    }

    private void notice(String room, String text) {
        ObjectNode o = om.createObjectNode();
        o.put("t", "notice").put("text", text);
        broadcast(room, o);
    }

    private void broadcast(String room, JsonNode node) {
        List<Client> list = rooms.get(room);
        if (list == null) return;
        for (Client c : list) send(c, node);
    }

    // ------------------------------------------------------------------ used by ApiController

    public boolean roomActive(String room) {
        List<Client> list = rooms.get(room);
        return list != null && !list.isEmpty();
    }

    /** The iPhone share endpoint: play a video now, or add it to the queue, for everyone in the room. Returns ok, room_empty or queue_full. */
    public String share(String room, String id, String title, String channel, int dur, boolean playNow, String by) {
        if (!roomActive(room)) return "room_empty";
        String who = RoomQueue.clean(by == null || by.isBlank() ? "Someone" : by, 24);
        String label = title == null || title.isBlank() ? "a video" : title;
        RoomState st = states.computeIfAbsent(room, k -> new RoomState());
        if (playNow) {
            issueLoad(room, st, id, title == null ? "" : title, channel == null ? "" : channel, "📲 " + who + " shared: " + label);
            return "ok";
        }
        RoomQueue.Item added = st.queue.add(id, title, channel, dur, who);
        if (added == null) return "queue_full";
        broadcast(room, queueNode(st));
        notice(room, "📲 " + who + " added to the queue: " + label);
        return "ok";
    }

    private List<Client> others(Client me) {
        List<Client> list = rooms.getOrDefault(me.room(), List.of());
        return list.stream().filter(c -> c != me).toList();
    }

    private void broadcastMembers(String room) {
        List<Client> list = rooms.get(room);
        if (list == null) return;
        ObjectNode o = om.createObjectNode();
        o.put("t", "members");
        ArrayNode arr = o.putArray("list");
        for (Client c : list) arr.addObject().put("id", c.id()).put("name", c.name()).put("icon", c.icon());
        for (Client c : list) send(c, o);
    }

    private void send(Client c, JsonNode node) {
        try {
            if (c.out() != null && c.out().isOpen()) c.out().sendMessage(new TextMessage(om.writeValueAsString(node)));
        } catch (Exception ignored) {
        }
    }

    private static String cut(String s, int maxCodePoints) {
        if (s.codePointCount(0, s.length()) <= maxCodePoints) return s;
        return s.substring(0, s.offsetByCodePoints(0, maxCodePoints));
    }
}
