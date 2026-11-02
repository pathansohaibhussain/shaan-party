package com.shaan.party;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** The shared "up next" list of one room. Plain Java; every change goes through the server so everybody sees the same list. */
public final class RoomQueue {
    public static final int MAX = 50;
    private static final Pattern ID = Pattern.compile("^[\\w-]{11}$");

    /** One entry. qid is unique inside the room and is how clients refer to an entry. */
    public record Item(long qid, String id, String title, String channel, int dur, String by) {}

    private final List<Item> items = new ArrayList<>();
    private long seq = 0;

    /** Strip control characters and cut to length. */
    static String clean(String s, int max) {
        if (s == null) return "";
        String t = s.replaceAll("[\\p{Cntrl}]", " ").trim();
        return t.codePointCount(0, t.length()) <= max ? t : t.substring(0, t.offsetByCodePoints(0, max));
    }

    private Item make(String id, String title, String channel, int dur, String by) {
        if (id == null || !ID.matcher(id).matches() || items.size() >= MAX) return null;
        return new Item(++seq, id, clean(title, 120), clean(channel, 60), Math.max(0, Math.min(dur, 43_200)), clean(by, 24));
    }

    /** Add at the end. Returns the new entry, or null if the id is invalid or the queue is full. */
    public synchronized Item add(String id, String title, String channel, int dur, String by) {
        Item it = make(id, title, channel, dur, by);
        if (it != null) items.add(it);
        return it;
    }

    /** Add at the front ("play next"). */
    public synchronized Item addNext(String id, String title, String channel, int dur, String by) {
        Item it = make(id, title, channel, dur, by);
        if (it != null) items.add(0, it);
        return it;
    }

    public synchronized boolean remove(long qid) {
        return items.removeIf(i -> i.qid() == qid);
    }

    /** Remove and return one entry (used when someone taps it to play it now). */
    public synchronized Item take(long qid) {
        for (int i = 0; i < items.size(); i++) {
            if (items.get(i).qid() == qid) return items.remove(i);
        }
        return null;
    }

    public synchronized Item pollFirst() {
        return items.isEmpty() ? null : items.remove(0);
    }

    public synchronized void clear() {
        items.clear();
    }

    public synchronized int size() {
        return items.size();
    }

    public synchronized List<Item> snapshot() {
        return new ArrayList<>(items);
    }
}
