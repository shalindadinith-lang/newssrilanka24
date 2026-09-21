#!/usr/bin/env node
// ============================================================
// build-static.js
// Pre-renders static article pages for GitHub Pages so that
// GET /article/{slug} returns HTTP 200 with real HTML content
// (no client-side JS required for Googlebot to index).
//
// - Reads Supabase URL + anon key from supabase-config.js
//   (single source of truth; anon key is read-only public RLS).
//   Override with env: SUPABASE_URL / SUPABASE_ANON_KEY
// - Fetches ONLY published articles (status=published).
// - Writes article/{slug}/index.html for every published article.
// - Regenerates sitemap.xml with homepage + all article URLs.
// - Idempotent: only rewrites when file content actually changes.
//
// Deploy/run:  node build-static.js   (or: npm run build)
// ============================================================

const fs = require("fs");
const path = require("path");
const SEO = require("./seo-config.js");

const SITE = SEO.SITE;
const ROOT = __dirname;

function articleUrl(slug) {
  return SITE + "/article/" + slug + "/";
}

function sitemapLoc(slug) {
  return SITE + "/article/" + encodeURIComponent(slug) + "/";
}

const PLACEHOLDER_IMG = "https://via.placeholder.com/800x400?text=News";

const CATEGORY_LABELS = {
  general: "සාමාන්‍ය",
  "sri-lanka": "ශ්‍රී ලංකා",
  world: "ලෝකය",
  technology: "තාක්ෂණය",
  sports: "ක්‍රීඩා",
  business: "ව්‍යාපාර",
  entertainment: "විනෝදාස්වාදය",
  education: "අධ්‍යාපනය",
  health: "සෞඛ්‍ය"
};

// Same feed list as index.html (RSS articles become normal article pages).
const RSS_FEEDS = [
  "https://api.rss2json.com/v1/api.json?rss_url=https://www.lankacnews.com/feeds/posts/default?alt=rss"
];

function detectCategory(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("ටෙක්") || lower.includes("තාක්ෂණ") || lower.includes("technology") || lower.includes("smartphone") || lower.includes("phone") || lower.includes("app")) return "technology";
  if (lower.includes("ක්‍රීඩා") || lower.includes("තරග") || lower.includes("sports") || lower.includes("cricket")) return "sports";
  if (lower.includes("ව්‍යාපාර") || lower.includes("ආර්ථික") || lower.includes("business") || lower.includes("economy") || lower.includes("market")) return "business";
  if (lower.includes("ලෝක") || lower.includes("විදෙස්") || lower.includes("world") || lower.includes("international")) return "world";
  if (lower.includes("සිනමා") || lower.includes("රංගන") || lower.includes("ගායන") || lower.includes("entertainment") || lower.includes("film")) return "entertainment";
  if (lower.includes("අධ්‍යාපන") || lower.includes("පාසල්") || lower.includes("විශ්වවිද්‍යාල") || lower.includes("education")) return "education";
  if (lower.includes("සෞඛ්‍ය") || lower.includes("රෝග") || lower.includes("health") || lower.includes("hospital")) return "health";
  if (lower.includes("ශ්‍රී ලංකා") || lower.includes("ශ්‍රී ලංකාව") || lower.includes("sri lanka")) return "sri-lanka";
  return "general";
}

function normKey(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9\u0D80-\u0DFF]+/g, "");
}

function parseDateISO(value) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function cleanAuthor(value) {
  const cleaned = String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  // Drop email/feed tech addresses like "noreply@blogger.com".
  return /@/.test(cleaned) ? "" : cleaned;
}

// --- Slug generation (MUST stay identical to supabase-news.js) ----------
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = ((h << 5) - h + String(str).charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function generateArticleSlug(title, salt) {
  const base = String(title || "news")
    .toLowerCase()
    .replace(/[^a-z0-9\u0D80-\u0DFF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const h = hashCode(String(salt || "")).toString(36).slice(0, 5);
  return (base || "news") + "-" + h;
}

function articleSlug(row) {
  return row.slug || generateArticleSlug(row.title || "news", row.id);
}

// --- Supabase config (parse from supabase-config.js) --------------------
function readSupabaseConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
  }
  const file = path.join(ROOT, "supabase-config.js");
  const src = fs.readFileSync(file, "utf8");
  const url = (src.match(/const supabaseUrl\s*=\s*"([^"]+)"/) || [])[1];
  const key = (src.match(/const supabaseAnonKey\s*=\s*"([^"]+)"/) || [])[1];
  if (!url || !key) {
    throw new Error(
      "Could not read Supabase config from supabase-config.js. " +
        "Set SUPABASE_URL / SUPABASE_ANON_KEY env vars instead."
    );
  }
  return { url, key };
}

// --- Helpers ------------------------------------------------------------
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escXml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(str) {
  return String(str == null ? "" : str).replace(/<[^>]*>/g, " ");
}

function formatDateSI(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("si-LK", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch (_) {
    return "";
  }
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function truncate(str, n) {
  const s = stripHtml(str).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) : s;
}

// --- REST fetch of published articles -----------------------------------
async function fetchPublishedArticles(supabase) {
  const url =
    supabase.url +
    "/rest/v1/news?select=*&status=eq.published&order=published_at.desc";
  const response = await fetch(url, {
    headers: {
      apikey: supabase.key,
      Authorization: "Bearer " + supabase.key,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error("Supabase fetch failed: " + response.status + " " + (await response.text()));
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

// Fetch RSS feed items (same source as the homepage) and map them into the
// same article shape as Supabase rows so they render as normal article pages.
async function fetchRssItems() {
  let allItems = [];
  for (const feedUrl of RSS_FEEDS) {
    try {
      const response = await fetch(feedUrl);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (data && Array.isArray(data.items)) allItems = allItems.concat(data.items);
    } catch (e) {
      console.warn("RSS feed failed (" + feedUrl + "): " + e.message);
    }
  }
  const unique = new Map();
  allItems.forEach((item) => {
    if (item && item.link && !unique.has(item.link)) unique.set(item.link, item);
  });
  return Array.from(unique.values());
}

function rssItemToRow(item) {
  const link = item.link || "";
  const rawTitle = item.title || "";
  const title = String(rawTitle).trim() || "Untitled";
  const description = stripHtml(item.description || "").replace(/\s+/g, " ").trim();
  const content = item.content || item.description || "";
  const image = item.thumbnail || (item.enclosure && item.enclosure.link) || PLACEHOLDER_IMG;
  const published = parseDateISO(item.pubDate);
  const author = cleanAuthor(item.author) || "News Sri Lanka 24";
  return {
    id: "rss-" + hashCode(link).toString(36),
    title: title,
    short_description: description,
    content: content,
    image_url: image,
    category: detectCategory(title + " " + description),
    language: "si",
    author: author,
    published_at: published,
    updated_at: published,
    status: "published",
    is_breaking: false,
    is_featured: false,
    source: "rss",
    originalLink: link,
    // Same slug algorithm + salt (title, link) as the homepage so the clean
    // URL is identical whether opened in the SPA or as the static page.
    slug: generateArticleSlug(rawTitle, link)
  };
}

// --- Article page template (matches homepage design) --------------------
function renderArticlePage(row, slug, related) {
  const url = articleUrl(slug);
  const title = row.title || "Untitled";
  const image = row.image_url || PLACEHOLDER_IMG;
  const desc = stripHtml(row.short_description || printfDescription(row.content) || "").trim();
  const metaDesc = truncate(desc || title, 160) || title;
  const author = row.author || "News Sri Lanka 24";
  const cat = row.category || "general";
  const catLabel = CATEGORY_LABELS[cat] || cat;
  const dateISO = row.published_at || null;
  const dateHuman = formatDateSI(dateISO);
  const inLanguage = row.language === "en" ? "en" : "si";
  const contentHtml = row.content || "";
  const shareText = encodeURIComponent(title);
  const shareUrl = encodeURIComponent(url);
  const sourceLink =
    row.source === "rss" && row.originalLink
      ? `<a class="source-link" href="${esc(row.originalLink)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-external-link-alt"></i> මුල් පුවත කියවන්න</a>`
      : "";

  const ldJson = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "NewsArticle",
        headline: title,
        description: metaDesc,
        image: [image],
        datePublished: dateISO,
        dateModified: row.updated_at || dateISO,
        author: { "@type": "Organization", name: author },
        publisher: {
          "@type": "NewsMediaOrganization",
          name: SEO.SITE_NAME,
          logo: { "@type": "ImageObject", url: SEO.LOGO_IMAGE, width: 512, height: 512 }
        },
        url: url,
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        articleSection: catLabel,
        inLanguage: inLanguage
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "මුල් පිටුව", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: title, item: url }
        ]
      }
    ]
  };

  const relatedHtml = (related || [])
    .map((item) => {
      return (
        '<li><a href="' +
        esc(articleUrl(item.slug)) +
        '">' +
        esc(item.row.title || item.slug) +
        "</a></li>"
      );
    })
    .join("");

  const head = `<!DOCTYPE html>
<html lang="${inLanguage}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<title>${esc(title)} | ${esc(SEO.SITE_NAME)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.png">
<link rel="sitemap" type="application/xml" href="${SITE}/sitemap.xml">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="${inLanguage === "en" ? "en_GB" : "si_LK"}">
<meta property="og:site_name" content="${esc(SEO.SITE_NAME)}">
<meta property="article:published_time" content="${esc(dateISO || "")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">${JSON.stringify(ldJson)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&family=Noto+Sans+Sinhala:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #f5f7fb;
  --surface: #ffffff;
  --text: #1e293b;
  --text-secondary: #475569;
  --primary: #c40000;
  --border: #e2e8f0;
  --card-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
  --header-bg: #c40000;
}
body.dark {
  --bg: #0f172a;
  --surface: #1e293b;
  --text: #f1f5f9;
  --text-secondary: #cbd5e1;
  --border: #334155;
  --header-bg: #7f1a1a;
}
body {
  font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
  background: var(--bg);
  color: var(--text);
}
.top-bar {
  background: var(--header-bg);
  color: white;
  padding: 12px 24px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.top-container {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
}
.logo { color: white; text-decoration: none; font-size: 1.5rem; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.related { margin-top: 28px; }
.related h2 { font-size: 1.15rem; margin-bottom: 10px; }
.related ul { padding-left: 18px; line-height: 1.8; }
.related a { color: var(--primary); }
.crumb { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px; }
.crumb a { color: var(--primary); text-decoration: none; }
.controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dark-toggle {
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  padding: 8px 12px;
  border-radius: 40px;
  cursor: pointer;
}
.article-wrap {
  max-width: 860px;
  margin: 30px auto;
  padding: 0 20px;
}
.article-card {
  background: var(--surface);
  border-radius: 24px;
  padding: 28px;
  box-shadow: var(--card-shadow);
  border: 1px solid var(--border);
}
.cat-tag {
  display: inline-flex;
  background: var(--primary);
  color: #fff;
  padding: 3px 12px;
  border-radius: 30px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 12px;
}
.article-title { font-size: 1.6rem; font-weight: 700; line-height: 1.4; margin-bottom: 12px; }
.card-meta { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px; }
.article-img {
  width: 100%;
  max-height: 460px;
  object-fit: cover;
  border-radius: 18px;
  margin: 15px 0;
}
.article-desc { font-size: 1.05rem; line-height: 1.7; }
.full-content {
  margin-top: 16px;
  line-height: 1.9;
  background: var(--surface);
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--border);
  overflow-wrap: break-word;
}
.full-content img { max-width: 100%; height: auto; border-radius: 12px; }
.back-home {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--primary);
  color: #fff;
  padding: 12px 24px;
  border-radius: 40px;
  text-decoration: none;
  font-weight: 600;
  margin-top: 24px;
}
.back-home:hover { opacity: 0.9; }
.source-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--primary);
  color: #fff;
  padding: 12px 24px;
  border-radius: 40px;
  text-decoration: none;
  font-weight: 600;
  margin-top: 24px;
  margin-right: 10px;
}
.source-link:hover { opacity: 0.9; }
.share-buttons {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  flex-wrap: wrap;
}
.share-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 8px 15px;
  border-radius: 30px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--text);
  text-decoration: none;
  transition: 0.2s;
}
.share-btn:hover { opacity: 0.8; }
footer {
  background: var(--surface);
  text-align: center;
  padding: 24px;
  border-top: 1px solid var(--border);
  margin-top: 40px;
}
@media (max-width: 700px) {
  .article-card { padding: 20px; }
  .article-title { font-size: 1.25rem; }
}
</style>
</head>
<body>`;

  const body = `<div class="top-bar">
  <div class="top-container">
    <a class="logo" href="${SITE}/"><i class="fas fa-newspaper"></i> newssrilanka24.com.lk</a>
    <div class="controls">
      <button class="dark-toggle" id="darkModeToggle"><i class="fas fa-moon"></i> අඳුරු</button>
    </div>
  </div>
</div>

<div class="breaking" style="background:#000000dd;color:#ffd966;padding:10px 20px;overflow:hidden;white-space:nowrap;font-weight:500;"><i class="fas fa-bolt"></i> BREAKING:</div>

<div class="article-wrap">
  <div class="article-card">
    <nav class="crumb" aria-label="breadcrumb"><a href="${SITE}/">මුල් පිටුව</a> / ${esc(catLabel)}</nav>
    <span class="cat-tag">${esc(catLabel)}</span>
    <h1 class="article-title">${esc(title)}</h1>
    <div class="card-meta">
      <i class="far fa-user"></i> ${esc(author)} &nbsp;&nbsp; <i class="far fa-calendar"></i> ${esc(dateHuman)}
    </div>
    <img class="article-img" src="${esc(image)}" alt="${esc(title)}" width="860" height="460" loading="eager" fetchpriority="high" onerror="this.src='${PLACEHOLDER_IMG}'">
    ${desc ? `<p class="article-desc">${esc(desc)}</p>` : ""}
    ${contentHtml ? `<div class="full-content">${contentHtml}</div>` : ""}

    ${relatedHtml ? `<div class="related"><h2>තවත් පුවත්</h2><ul>${relatedHtml}</ul></div>` : ""}

    <div>
      ${sourceLink}
      <a class="back-home" href="${SITE}/"><i class="fas fa-home"></i> සියලුම පුවත්</a>
    </div>

    <div class="share-buttons">
      <a class="share-btn" target="_blank" rel="noopener" href="https://wa.me/?text=${shareText}%20${shareUrl}"><i class="fab fa-whatsapp"></i> WhatsApp</a>
      <a class="share-btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}"><i class="fab fa-twitter"></i> Twitter</a>
      <a class="share-btn" target="_blank" rel="noopener" href="https://t.me/share/url?url=${shareUrl}&text=${shareText}"><i class="fab fa-telegram-plane"></i> Telegram</a>
      <button class="share-btn" id="shareCopy"><i class="fas fa-copy"></i> Copy Link</button>
    </div>
  </div>
</div>

<footer><i class="fas fa-newspaper"></i> සැබෑ කාලීන පුවත්</footer>

<script>
const darkToggle = document.getElementById("darkModeToggle");
if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark");
darkToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
});
document.getElementById("shareCopy").addEventListener("click", () => {
  navigator.clipboard.writeText("${esc(url)}").then(() => alert("ලින්ක් එක copy කළා!"));
});
</script>
</body>
</html>`;

  return head + body;
}

// --- Write helpers (idempotent) -----------------------------------------
function writeFileIfChanged(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs) && fs.readFileSync(abs, "utf8") === content) {
    return false; // unchanged
  }
  fs.writeFileSync(abs, content);
  return true;
}

// --- Sitemap ------------------------------------------------------------
function renderSitemap(articles, generatedAt) {
  const rows = [];
  rows.push(
    "  <url>\n" +
      "    <loc>" + SITE + "/</loc>\n" +
      "    <lastmod>" + generatedAt + "</lastmod>\n" +
      "    <changefreq>daily</changefreq>\n" +
      "    <priority>1.0</priority>\n" +
      "  </url>"
  );
  for (const a of articles) {
    const lastmod = (a.row.updated_at || a.row.published_at || "").split("T")[0] || generatedAt;
    const priority = (a.row.category || "general") === "sri-lanka" ? "0.9" : "0.8";
    rows.push(
      "  <url>\n" +
        "    <loc>" + escXml(articleUrl(a.slug)) + "</loc>\n" +
        "    <lastmod>" + escXml(lastmod) + "</lastmod>\n" +
        "    <changefreq>weekly</changefreq>\n" +
        "    <priority>" + priority + "</priority>\n" +
        "  </url>"
    );
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.join("\n") +
    "\n</urlset>\n"
  );
}

function printfDescription(content) {
  return stripHtml(content || "").replace(/\s+/g, " ").trim();
}

// --- Main ---------------------------------------------------------------
async function main() {
  console.log("=== Static article pre-render ===");
  const supabase = readSupabaseConfig();
  console.log("Supabase URL:", supabase.url);

  const rows = await fetchPublishedArticles(supabase);
  console.log("Published articles fetched:", rows.length);

  const articles = rows.map((row) => ({
    slug: articleSlug(row),
    row: row
  }));

  // RSS-fed articles are rendered as normal article pages too, de-duplicated
  // against Supabase articles (by slug and by normalized title).
  const seenSlugs = new Set(articles.map((a) => a.slug));
  const seenTitles = new Set(articles.map((a) => normKey(a.row.title)));
  let rssItems = [];
  try {
    rssItems = await fetchRssItems();
  } catch (e) {
    console.warn("RSS fetch skipped: " + e.message);
  }
  for (const item of rssItems) {
    const row = rssItemToRow(item);
    if (!row.originalLink) continue;
    if (seenSlugs.has(row.slug)) continue;
    const titleKey = normKey(row.title);
    if (seenTitles.has(titleKey)) continue;
    seenSlugs.add(row.slug);
    seenTitles.add(titleKey);
    articles.push({ slug: row.slug, row: row });
  }
  console.log("RSS articles fetched:", rssItems.length, "| total pages:", articles.length);

  let written = 0;
  for (const a of articles) {
    const rel = path.join("article", a.slug, "index.html");
    const changed = writeFileIfChanged(rel, renderArticlePage(a.row, a.slug));
    if (changed) {
      written++;
      console.log("  + article/" + a.slug + "/index.html");
    }
  }

  const sitemapPath = path.join(ROOT, "sitemap.xml");
  const sitemapChanged = writeFileIfChanged("sitemap.xml", renderSitemap(articles, todayISO()));
  console.log("Sitemap:", sitemapChanged ? "updated (" + articles.length + " article URLs)" : "unchanged");

  console.log(
    "Done. Wrote " + written + " article page(s). Generated dir: article/{slug}/index.html"
  );
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});