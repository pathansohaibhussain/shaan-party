package com.shaan.party;

import java.time.Duration;

/** Reads YouTube's ISO 8601 durations ("PT1H2M3S"). */
public final class Iso {
    private Iso() {}

    /** Seconds, or 0 if it cannot be read (live streams report "P0D"). Capped at 12 hours. */
    public static int durationSeconds(String iso) {
        if (iso == null || iso.isEmpty()) return 0;
        try {
            long s = Duration.parse(iso).getSeconds();
            return (int) Math.max(0, Math.min(s, 43_200));
        } catch (RuntimeException e) {
            return 0;
        }
    }
}
