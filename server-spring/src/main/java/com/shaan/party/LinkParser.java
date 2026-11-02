package com.shaan.party;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Finds a YouTube video / playlist / channel id in whatever someone shared. Mirrors parseYT in yt-search.js. */
public final class LinkParser {
    private LinkParser() {}

    private static final Pattern BARE = Pattern.compile("^[\\w-]{11}$");
    private static final Pattern URL = Pattern.compile(
            "(?:^|[\\s<(\"'])((?:https?://)?(?:[\\w-]+\\.)?(?:youtube\\.com|youtu\\.be|youtube-nocookie\\.com)/\\S*)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern ID11 = Pattern.compile("^([\\w-]{11})(?![\\w-])");
    private static final Pattern PATH_ID = Pattern.compile("^/(?:shorts|embed|live|v)/([\\w-]{11})(?![\\w-])");
    private static final Pattern LIST = Pattern.compile("^[\\w-]{10,64}$");
    private static final Pattern CHANNEL = Pattern.compile("^/channel/(UC[\\w-]{22})(?![\\w-])");

    /** A parsed link, or null when the text holds no YouTube link. */
    private record Parsed(String host, String path, String query) {}

    private static Parsed parse(String input) {
        if (input == null) return null;
        Matcher m = URL.matcher(input.trim());
        if (!m.find()) return null;
        String raw = m.group(1);
        if (!raw.toLowerCase(Locale.ROOT).startsWith("http")) raw = "https://" + raw;
        try {
            URI u = URI.create(raw);
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT).replaceFirst("^(www|m|music)\\.", "");
            return new Parsed(host, u.getRawPath() == null ? "" : u.getRawPath(), u.getRawQuery());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String param(String query, String name) {
        if (query == null) return null;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            String k = eq < 0 ? pair : pair.substring(0, eq);
            if (k.equals(name)) {
                String v = eq < 0 ? "" : pair.substring(eq + 1);
                try {
                    return URLDecoder.decode(v, StandardCharsets.UTF_8);
                } catch (IllegalArgumentException e) {
                    return null;
                }
            }
        }
        return null;
    }

    private static String take(String s) {
        if (s == null) return null;
        Matcher m = ID11.matcher(s);
        return m.find() ? m.group(1) : null;
    }

    public static String videoId(String input) {
        if (input == null) return null;
        String s = input.trim();
        if (BARE.matcher(s).matches()) return s;
        Parsed p = parse(s);
        if (p == null) return null;
        if (p.host().equals("youtu.be")) return take(p.path().startsWith("/") ? p.path().substring(1) : p.path());
        if (p.host().equals("youtube.com") || p.host().equals("youtube-nocookie.com")) {
            String v = take(param(p.query(), "v"));
            if (v != null) return v;
            Matcher m = PATH_ID.matcher(p.path());
            if (m.find()) return m.group(1);
        }
        return null;
    }

    public static String playlistId(String input) {
        Parsed p = parse(input);
        if (p == null || !(p.host().equals("youtube.com") || p.host().equals("youtube-nocookie.com"))) return null;
        String l = param(p.query(), "list");
        return l != null && LIST.matcher(l).matches() ? l : null;
    }

    public static String channelId(String input) {
        Parsed p = parse(input);
        if (p == null || !p.host().equals("youtube.com")) return null;
        Matcher m = CHANNEL.matcher(p.path());
        return m.find() ? m.group(1) : null;
    }
}
