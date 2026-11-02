package com.shaan.party;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Small text helpers (plain Java, no Spring). */
public final class TextUtil {
    private TextUtil() {}

    private static final Pattern ENTITY = Pattern.compile("&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);");

    /** The YouTube API returns titles with HTML entities ("Rock &amp; Roll", "It&#39;s"). Decode them once. */
    public static String decodeEntities(String s) {
        if (s == null || s.indexOf('&') < 0) return s == null ? "" : s;
        Matcher m = ENTITY.matcher(s);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String e = m.group(1);
            String rep;
            switch (e) {
                case "amp": rep = "&"; break;
                case "lt": rep = "<"; break;
                case "gt": rep = ">"; break;
                case "quot": rep = "\""; break;
                case "apos": rep = "'"; break;
                default:
                    try {
                        int cp = e.charAt(1) == 'x' ? Integer.parseInt(e.substring(2), 16) : Integer.parseInt(e.substring(1));
                        rep = Character.isValidCodePoint(cp) && cp > 0 ? new String(Character.toChars(cp)) : m.group();
                    } catch (NumberFormatException ex) {
                        rep = m.group();
                    }
            }
            m.appendReplacement(out, Matcher.quoteReplacement(rep));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** A JSON string literal (with quotes) for any text. */
    public static String jsonQuote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < (s == null ? 0 : s.length()); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    /** Trim and squeeze whitespace so "  lo-fi   beats " and "lo-fi beats" count as the same search. */
    public static String normalizeQuery(String q) {
        if (q == null) return "";
        return q.trim().replaceAll("\\s+", " ");
    }
}
