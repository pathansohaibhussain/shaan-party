package com.shaan.party;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** At most `perMinute` calls per person per rolling minute. Plain Java, injectable clock. */
public final class RateLimiter {
    private final int perMinute;
    private final Clock clock;
    private final Map<String, Deque<Long>> hits = new HashMap<>();

    public RateLimiter(int perMinute, Clock clock) {
        this.perMinute = Math.max(1, perMinute);
        this.clock = clock;
    }

    public synchronized boolean allow(String who) {
        long now = clock.millis();
        if (hits.size() > 2000) {                       // housekeeping: forget people who have been quiet for a minute
            Iterator<Map.Entry<String, Deque<Long>>> it = hits.entrySet().iterator();
            while (it.hasNext()) {
                Deque<Long> d = it.next().getValue();
                if (d.isEmpty() || now - d.peekLast() > 60_000L) it.remove();
            }
        }
        Deque<Long> d = hits.computeIfAbsent(who == null ? "?" : who, k -> new ArrayDeque<>());
        while (!d.isEmpty() && now - d.peekFirst() > 60_000L) d.pollFirst();
        if (d.size() >= perMinute) return false;
        d.addLast(now);
        return true;
    }
}
