// ============================================================
// Supabase Edge Function — Dynamic sitemap.xml
// ============================================================
// Deploy with: supabase functions deploy sitemap
//
// Usage: GET https://<project-ref>.supabase.co/functions/v1/sitemap
//        Returns Content-Type: application/xml
//
// Make this your canonical sitemap URL. Update your hosting
// config to proxy /sitemap.xml → this Edge Function, or
// point Google Search Console to the Edge Function URL directly.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE = "https://newssrilanka24.com.lk";

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data } = await supabase
    .from("news")
    .select("slug, published_at, updated_at, category")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  const today = new Date().toISOString().split("T")[0];

  const articleUrls = (data || [])
    .filter((r) => r.slug)
    .map((r) => {
      const lastmod = (r.updated_at || r.published_at || "").split("T")[0] || today;
      const category = r.category || "general";
      const priority = category === "sri-lanka" ? "0.9" : "0.8";
      return `  <url>
    <loc>${SITE}/article/${r.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${articleUrls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400"
    }
  });
});
