package com.shaan.party;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Protects the free YouTube quota (10,000 units a day; a search costs 100, most other calls cost 1):
 * a daily unit budget and a cache of finished answers. Plain Java with an injectable clock (see dev-checks/).
 */
public final class SearchGuard {
    /** YouTube's daily quota resets at midnight Pacific time. */
    public static final ZoneId QUOTA_ZONE = ZoneId.of("America/Los_Angeles");

    private static final class Cached {
        final String body;
        final long at;
        Cached(String body, long at) { this.body = body; this.at = at; }
    }

    private final Clock clock;
    private final int dailyUnits;
    private final long defaultTtlMs;
    private final LinkedHashMap<String, Cached> cache;
    private LocalDate day;
    private int used;
    private boolean exhausted;

    public SearchGuard(int dailyUnits, long defaultTtlMs, int cacheMax, Clock clock) {
        this.dailyUnits = Math.max(0, dailyUnits);
        this.defaultTtlMs = defaultTtlMs;
        this.clock = clock;
        final int max = Math.max(1, cacheMax);
        this.cache = new LinkedHashMap<String, Cached>() {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Cached> eldest) {
                return size() > max;
            }
        };
    }

    private void rollDay() {
        LocalDate today = LocalDate.now(clock.withZone(QUOTA_ZONE));
        if (!today.equals(day)) {
            day = today;
            used = 0;
            exhausted = false;
        }
    }

    public synchronized String cached(String key) {
        return cached(key, defaultTtlMs);
    }

    /** A saved answer, or null if there is none or it is older than ttlMs. */
    public synchronized String cached(String key, long ttlMs) {
        Cached c = cache.get(key);
        if (c == null) return null;
        if (clock.millis() - c.at > ttlMs) {
            cache.remove(key);
            return null;
        }
        return c.body;
    }

    public synchronized void store(String key, String body) {
        cache.put(key, new Cached(body, clock.millis()));
    }

    /** Reserve `units` of today's allowance for a call to YouTube. False when there is not enough left. */
    public synchronized boolean take(int units) {
        rollDay();
        if (exhausted || used + units > dailyUnits) return false;
        used += units;
        return true;
    }

    /** Give a reservation back when the call failed before YouTube counted it. */
    public synchronized void refund(int units) {
        rollDay();
        used = Math.max(0, used - units);
    }

    /** YouTube itself said the quota is gone: stop calling until tomorrow. */
    public synchronized void exhaust() {
        rollDay();
        exhausted = true;
    }

    public synchronized int left() {
        rollDay();
        return exhausted ? 0 : Math.max(0, dailyUnits - used);
    }
}
