package com.shaan.party;

/**
 * Decides whether a "my video ended" report should start the next queued video.
 * Every phone in the room sends that report, so only the FIRST one may count, and only if it names the video that is playing now.
 * Plain Java (see dev-checks/ServerChecks.java).
 */
public final class AdvanceGate {
    /** A video that has only just started cannot already have ended. */
    public static final long MIN_PLAY_MS = 3000;

    private String currentId = "";
    private long loadedAt;

    /** Call whenever a video starts for the room (someone picked it, the queue started it, or it was shared). */
    public synchronized void loaded(String id, long now) {
        currentId = id == null ? "" : id;
        loadedAt = now;
    }

    /** True for exactly one report per started video; claiming it also blocks the reports that arrive a moment later. */
    public synchronized boolean claim(String endedId, long now) {
        if (currentId.isEmpty() || !currentId.equals(endedId) || now - loadedAt <= MIN_PLAY_MS) return false;
        loadedAt = now;
        return true;
    }
}
