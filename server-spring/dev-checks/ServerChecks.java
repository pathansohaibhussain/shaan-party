import com.shaan.party.AdvanceGate;
import com.shaan.party.Iso;
import com.shaan.party.LinkParser;
import com.shaan.party.RateLimiter;
import com.shaan.party.RoomQueue;
import com.shaan.party.SearchGuard;
import com.shaan.party.TextUtil;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;

/**
 * Self-check for the server's plain-Java logic (no Spring, no JUnit, no network).
 * Run from the project root:  npm run check:java
 */
public class ServerChecks {
    static int failed = 0, passed = 0;

    static void check(String name, boolean ok) {
        if (ok) { passed++; System.out.println("  ok   " + name); }
        else { failed++; System.out.println("  FAIL " + name); }
    }

    /** A clock the checks can move. withZone() gives a view that shares the same time. */
    static final class TestClock extends Clock {
        private final long[] box; private final ZoneId zone;
        TestClock(long ms) { this(new long[]{ms}, ZoneOffset.UTC); }
        private TestClock(long[] box, ZoneId zone) { this.box = box; this.zone = zone; }
        void set(long v) { box[0] = v; }
        void add(long v) { box[0] += v; }
        @Override public ZoneId getZone() { return zone; }
        @Override public Clock withZone(ZoneId z) { return new TestClock(box, z); }
        @Override public Instant instant() { return Instant.ofEpochMilli(box[0]); }
        @Override public long millis() { return box[0]; }
    }

    static long at(int y, int mo, int d, int h, int mi, ZoneId z) {
        return ZonedDateTime.of(y, mo, d, h, mi, 0, 0, z).toInstant().toEpochMilli();
    }

    public static void main(String[] args) {
        ZoneId pt = SearchGuard.QUOTA_ZONE;

        System.out.println("daily unit budget");
        TestClock c = new TestClock(at(2026, 11, 1, 10, 0, pt));
        SearchGuard g = new SearchGuard(250, 600_000, 50, c);
        check("starts with the full budget", g.left() == 250);
        check("a 100-unit search fits", g.take(100));
        check("a second one fits", g.take(100));
        check("left counts down", g.left() == 50);
        check("a third 100-unit search does not fit", !g.take(100));
        check("but a 1-unit call still does", g.take(1) && g.left() == 49);
        g.refund(100);
        check("a refund gives units back", g.left() == 149);
        g.refund(10_000);
        check("refund never goes above the budget", g.left() == 250);

        System.out.println("budget resets at Pacific midnight, not UTC");
        c.set(at(2026, 11, 1, 23, 30, pt));
        while (g.take(1)) { }
        check("used up late on Nov 1 (Pacific)", g.left() == 0);
        c.set(at(2026, 11, 2, 0, 5, ZoneOffset.UTC));      // 17:05 Pacific, same quota day
        check("past UTC midnight but still the same Pacific day", g.left() == 0);
        c.set(at(2026, 11, 2, 0, 5, pt));
        check("after Pacific midnight the budget is back", g.left() == 250);
        g.exhaust();
        check("exhaust() blocks everything today", g.left() == 0 && !g.take(1));
        c.set(at(2026, 11, 3, 8, 0, pt));
        check("and clears the next day", g.left() == 250 && g.take(1));

        System.out.println("cache with per-entry lifetime");
        TestClock c3 = new TestClock(at(2026, 11, 1, 10, 0, pt));
        SearchGuard k = new SearchGuard(100, 600_000, 2, c3);
        check("nothing cached at first", k.cached("a") == null);
        k.store("a", "[1]");
        check("stored answer comes back", "[1]".equals(k.cached("a")));
        c3.add(599_000);
        check("fresh just under the default 10 minutes", "[1]".equals(k.cached("a")));
        check("a shorter lifetime can be asked for", k.cached("a", 60_000) == null);
        k.store("a", "[1]");
        c3.add(1_900_000);
        check("a longer lifetime keeps it", "[1]".equals(k.cached("a", 3_600_000)));
        c3.add(3_600_000);
        check("but not forever", k.cached("a", 3_600_000) == null);
        k.store("a", "[1]"); k.store("b", "[2]"); k.store("c", "[3]");
        check("keeps only the newest 2 entries", k.cached("a") == null && "[2]".equals(k.cached("b")) && "[3]".equals(k.cached("c")));

        System.out.println("rate limiter");
        TestClock c2 = new TestClock(at(2026, 11, 1, 10, 0, pt));
        RateLimiter r = new RateLimiter(3, c2);
        check("1st", r.allow("1.1.1.1"));
        check("2nd", r.allow("1.1.1.1"));
        check("3rd", r.allow("1.1.1.1"));
        check("4th within a minute is refused", !r.allow("1.1.1.1"));
        check("someone else is not affected", r.allow("2.2.2.2"));
        c2.add(30_000);
        check("still refused after 30 s", !r.allow("1.1.1.1"));
        c2.add(31_000);
        check("allowed again after a minute", r.allow("1.1.1.1"));

        System.out.println("links (same cases as the web room tests)");
        String id = "dQw4w9WgXcQ";
        String[] same = {
            id, "https://www.youtube.com/watch?v=" + id, "https://m.youtube.com/watch?v=" + id + "&t=42s",
            "https://youtu.be/" + id, "https://youtu.be/" + id + "?si=AbCdEf", "https://www.youtube.com/shorts/" + id,
            "https://www.youtube.com/embed/" + id, "https://www.youtube.com/live/" + id + "?feature=share",
            "https://music.youtube.com/watch?v=" + id + "&list=RDAMVM" + id, "https://www.youtube.com/watch?feature=share&v=" + id,
            "youtube.com/watch?v=" + id, "youtu.be/" + id, "  https://youtu.be/" + id + "  ",
            "Check this out https://youtu.be/" + id + " so good", "(https://youtu.be/" + id + ")"
        };
        boolean allSame = true;
        for (String s : same) if (!id.equals(LinkParser.videoId(s))) { allSame = false; System.out.println("       not understood: " + s); }
        check("every share shape gives the same video id", allSame);
        String[] none = {
            "", "lofi beats", "https://example.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/",
            "https://www.youtube.com/playlist?list=PL1234567890", "https://www.youtube.com/@somechannel", "https://youtu.be/short",
            "https://www.youtube.com/watch?v=tooshort", "dQw4w9WgXcQextra"
        };
        boolean allNone = true;
        for (String s : none) if (LinkParser.videoId(s) != null) { allNone = false; System.out.println("       wrongly accepted: " + s); }
        check("things that are not one video are refused", allNone && LinkParser.videoId(null) == null);
        check("playlist id", "PL1234567890abc".equals(LinkParser.playlistId("https://www.youtube.com/playlist?list=PL1234567890abc")));
        check("playlist id inside a watch link", "PL1234567890abc".equals(LinkParser.playlistId("https://www.youtube.com/watch?v=" + id + "&list=PL1234567890abc")));
        check("no playlist in a plain video link", LinkParser.playlistId("https://youtu.be/" + id) == null);
        check("channel id", "UCuAXFkgsw1L7xaCfnd5JJOw".equals(LinkParser.channelId("https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw")));
        check("handle links are not channel ids", LinkParser.channelId("https://www.youtube.com/@somechannel") == null);

        System.out.println("durations");
        check("PT1H2M3S", Iso.durationSeconds("PT1H2M3S") == 3723);
        check("PT45S", Iso.durationSeconds("PT45S") == 45);
        check("PT10M", Iso.durationSeconds("PT10M") == 600);
        check("P0D (live)", Iso.durationSeconds("P0D") == 0);
        check("P1DT2H is capped at 12 h", Iso.durationSeconds("P1DT2H") == 43_200);
        check("junk and empty", Iso.durationSeconds("banana") == 0 && Iso.durationSeconds("") == 0 && Iso.durationSeconds(null) == 0);

        System.out.println("shared queue");
        RoomQueue q = new RoomQueue();
        RoomQueue.Item a = q.add("aaaaaaaaaaa", "First", "Ch", 100, "Sam");
        RoomQueue.Item b = q.add("bbbbbbbbbbb", "Second", "Ch", 200, "Aisha");
        RoomQueue.Item n = q.addNext("ccccccccccc", "Jumps ahead", "Ch", 300, "Sam");
        check("entries get different ids", a.qid() != b.qid() && b.qid() != n.qid());
        check("play-next goes to the front", q.snapshot().get(0).id().equals("ccccccccccc") && q.size() == 3);
        check("pollFirst takes the front one", q.pollFirst().id().equals("ccccccccccc") && q.size() == 2);
        check("remove by qid", q.remove(a.qid()) && q.size() == 1 && !q.remove(a.qid()));
        RoomQueue.Item t = q.take(b.qid());
        check("take returns and removes", t != null && t.title().equals("Second") && q.size() == 0 && q.take(b.qid()) == null);
        check("pollFirst on an empty queue", q.pollFirst() == null);
        check("a bad video id is refused", q.add("nope", "x", "y", 1, "z") == null && q.add(null, "x", "y", 1, "z") == null && q.size() == 0);
        RoomQueue.Item messy = q.add("ddddddddddd", "Line1\nLine2\u0007" + "x".repeat(300), "C".repeat(200), 999_999, "N".repeat(100));
        check("text is cleaned and cut", messy.title().length() == 120 && !messy.title().contains("\n") && messy.channel().length() == 60 && messy.by().length() == 24);
        check("duration is clamped", messy.dur() == 43_200 && q.add("eeeeeeeeeee", "t", "c", -5, "b").dur() == 0);
        q.clear();
        for (int i = 0; i < RoomQueue.MAX; i++) q.add(String.format("%011d", i), "t", "c", 1, "b");
        check("queue is capped at " + RoomQueue.MAX, q.size() == RoomQueue.MAX && q.add("fffffffffff", "t", "c", 1, "b") == null);
        q.clear();
        check("clear empties it", q.size() == 0);

        System.out.println("auto-advance gate (every phone reports 'ended', only the first may count)");
        AdvanceGate gate = new AdvanceGate();
        check("nothing playing: a report is ignored", !gate.claim("aaaaaaaaaaa", 100_000));
        gate.loaded("aaaaaaaaaaa", 100_000);
        check("a video that only just started cannot have ended", !gate.claim("aaaaaaaaaaa", 101_000));
        check("a report naming another video is ignored", !gate.claim("bbbbbbbbbbb", 200_000));
        check("the first real report counts", gate.claim("aaaaaaaaaaa", 200_000));
        check("the second phone's report a moment later does not", !gate.claim("aaaaaaaaaaa", 200_050));
        check("nor the third", !gate.claim("aaaaaaaaaaa", 200_900));
        gate.loaded("bbbbbbbbbbb", 200_100);
        check("a late report about the OLD video is ignored", !gate.claim("aaaaaaaaaaa", 300_000));
        check("the next video ends normally", gate.claim("bbbbbbbbbbb", 300_000));
        gate.loaded("bbbbbbbbbbb", 300_100);
        check("the same song queued twice in a row: its own ending counts", gate.claim("bbbbbbbbbbb", 400_000));
        check("but the duplicate reports of that ending do not", !gate.claim("bbbbbbbbbbb", 400_020));
        gate.loaded(null, 500_000);
        check("a null id never matches", !gate.claim("", 600_000) && !gate.claim(null, 600_000));

        System.out.println("text helpers");
        check("&amp;", TextUtil.decodeEntities("Rock &amp; Roll").equals("Rock & Roll"));
        check("&#39; and &quot;", TextUtil.decodeEntities("It&#39;s &quot;fine&quot;").equals("It's \"fine\""));
        check("hex and emoji entities", TextUtil.decodeEntities("caf&#xE9; &#128512;").equals("café 😀"));
        check("decodes once only", TextUtil.decodeEntities("&amp;#39;").equals("&#39;"));
        check("unknown / junk entities left alone", TextUtil.decodeEntities("a &nope; &#99999999; b").equals("a &nope; &#99999999; b"));
        check("null is empty", TextUtil.decodeEntities(null).equals(""));
        check("normalizeQuery", TextUtil.normalizeQuery("  lo-fi \t  beats ").equals("lo-fi beats") && TextUtil.normalizeQuery(null).equals(""));
        check("jsonQuote escapes quotes, slashes and newlines", TextUtil.jsonQuote("a\"b\\c\nd").equals("\"a\\\"b\\\\c\\nd\""));
        check("jsonQuote of null / control chars", TextUtil.jsonQuote(null).equals("\"\"") && TextUtil.jsonQuote("\u0001").equals("\"\\u0001\""));

        System.out.println();
        System.out.println(passed + " passed, " + failed + " failed");
        if (failed > 0) System.exit(1);
    }
}
