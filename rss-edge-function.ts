// ============================================================
// Supabase Edge Function — Dynamic rss.xml
// ============================================================
// Deploy with: supabase functions deploy rss
//
// Usage: GET https://<project-ref>.supabase.co/functions/v1/rss
//        Returns Content-Type: application/rss+xml; charset=utf-8
//
// Generates live RSS 2.0 feed with latest published news,
// descriptions, article links, publication dates, and featured images.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE = "https://newssrilanka24.com.lk";

function escXml(str: string): string {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data } = await supabase
    .from("news")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);

  const articles = data || [];
  const nowRFC = new Date().toUTCString();

  const items = articles
    .map((row: any) => {
      const slug = row.slug || "news";
      const url = `${SITE}/article/${slug}/`;
      const title = row.title || "Untitled";
      const rawDesc = row.short_description || row.content || "";
      const desc = rawDesc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const truncatedDesc = desc.length > 400 ? desc.slice(0, 400) + "..." : desc;
      const content = row.content || desc;
      const pubDate = row.published_at ? new Date(row.published_at).toUTCString() : nowRFC;
      const cat = row.category || "General";
      const author = row.author || "News Sri Lanka 24";
      const image = row.image_url && !row.image_url.includes("via.placeholder.com") ? row.image_url : "";

      return `    <item>
      <title><![CDATA[${title}]]></title>
      <link>${escXml(url)}</link>
      <guid isPermaLink="true">${escXml(url)}</guid>
      <description><![CDATA[${truncatedDesc}]]></description>
      <content:encoded><![CDATA[${content}]]></content:encoded>
      <category><![CDATA[${cat}]]></category>
      <dc:creator><![CDATA[${author}]]></dc:creator>
      <pubDate>${pubDate}</pubDate>
${image ? `      <enclosure url="${escXml(image)}" length="0" type="image/jpeg" />
      <media:content url="${escXml(image)}" medium="image">
        <media:title><![CDATA[${title}]]></media:title>
      </media:content>
      <media:thumbnail url="${escXml(image)}" />` : ""}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title><![CDATA[News Sri Lanka 24 | සැබෑ කාලීන සිංහල පුවත් සාරාංශ]]></title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description><![CDATA[ශ්‍රී ලංකාවේ සහ ලෝකයේ නවතම සිංහල පුවත් සාරාංශ සජීවීව සහ විශ්වාසනීයව ඔබ වෙත ගෙන එන ඩිජිටල් පුවත් වේදිකාව.]]></description>
    <language>si-LK</language>
    <lastBuildDate>${nowRFC}</lastBuildDate>
    <generator>News Sri Lanka 24 Edge Feed Engine</generator>
    <image>
      <url>${SITE}/logo.png</url>
      <title><![CDATA[News Sri Lanka 24]]></title>
      <link>${SITE}/</link>
    </image>
    <copyright><![CDATA[© ${new Date().getFullYear()} News Sri Lanka 24. All rights reserved.]]></copyright>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "s-maxage=1800, stale-while-revalidate=86400"
    }
  });
});
