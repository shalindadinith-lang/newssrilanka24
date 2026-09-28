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

function getReadingTime(text, lang = "si") {
  const clean = stripHtml(text || "").trim();
  const words = clean.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 180));
  return lang === "en" ? `${minutes} min read` : `විනාඩි ${minutes} ක කියවීමක්`;
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
    slug: generateArticleSlug(rawTitle, link)
  };
}

// --- Article page template (matches modernized homepage design) --------
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
  const readTime = getReadingTime(contentHtml || desc, inLanguage);
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
          { "@type": "ListItem", position: 2, name: catLabel, item: SITE + "/#" + cat },
          { "@type": "ListItem", position: 3, name: title, item: url }
        ]
      }
    ]
  };

  const relatedHtml = (related || [])
    .map((item) => {
      const rImg = item.row.image_url || PLACEHOLDER_IMG;
      const rTitle = item.row.title || item.slug;
      const rCat = CATEGORY_LABELS[item.row.category] || item.row.category || "පුවත්";
      return `
        <a class="related-card" href="${esc(articleUrl(item.slug))}">
          <img src="${esc(rImg)}" alt="${esc(rTitle)}" width="220" height="120" loading="lazy">
          <div class="related-card-content">
            <span class="related-cat-tag">${esc(rCat)}</span>
            <h4 class="related-card-title">${esc(rTitle)}</h4>
          </div>
        </a>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="${inLanguage}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<title>${esc(title)} | ${esc(SEO.SITE_NAME)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.png">
<link rel="sitemap" type="application/xml" href="${SITE}/sitemap.xml">

<!-- Open Graph / WhatsApp / Facebook -->
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="${inLanguage === "en" ? "en_GB" : "si_LK"}">
<meta property="og:site_name" content="${esc(SEO.SITE_NAME)}">
<meta property="article:published_time" content="${esc(dateISO || "")}">
<meta property="article:section" content="${esc(catLabel)}">

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#b91c1c">

<script type="application/ld+json">${JSON.stringify(ldJson)}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+Sinhala:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">

<!-- Adsterra Monetization Scripts (Preserved) -->
<script src="https://pl31321270.profitableratecpmnetwork.com/1b/c6/93/1bc693fe07ef5d85134af3a84ae194ce.js"></script>
<script src="https://pl31321272.profitableratecpmnetwork.com/68/e7/95/68e795fadd49027611309bafebfbf7ba.js"></script>
<script async="async" data-cfasync="false" src="https://pl31321273.profitableratecpmnetwork.com/92a7664c8a64c05f627ef2d5add9408d/invoke.js"></script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-subtle: #f1f5f9;
  --text: #0f172a;
  --text-secondary: #475569;
  --text-muted: #64748b;
  --primary: #dc2626;
  --primary-dark: #b91c1c;
  --primary-gradient: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
  --border: #e2e8f0;
  --border-light: #f1f5f9;
  --card-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.06);
  --topbar-bg: #0f172a;
  --header-bg: #ffffff;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-pill: 9999px;
  --transition-smooth: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
html.dark, body.dark {
  --bg: #090d16;
  --surface: #111827;
  --surface-subtle: #1e293b;
  --text: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;
  --primary: #ef4444;
  --primary-dark: #dc2626;
  --primary-gradient: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
  --border: #1f2937;
  --border-light: #2d3748;
  --card-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.4);
  --topbar-bg: #050811;
  --header-bg: #0f172a;
}
body {
  font-family: 'Plus Jakarta Sans', 'Noto Sans Sinhala', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  transition: background-color 0.3s ease, color 0.3s ease;
}
a { color: inherit; text-decoration: none; }

/* Reading Progress */
.reading-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 4px;
  background: var(--primary);
  width: 0%;
  z-index: 999;
  transition: width 0.1s linear;
}

/* Top bar */
.top-bar {
  background: var(--topbar-bg);
  color: #e2e8f0;
  font-size: 0.82rem;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.top-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
}
.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}
.pulse-dot {
  width: 7px;
  height: 7px;
  background: #ef4444;
  border-radius: 50%;
  display: inline-block;
  animation: pulse 1.8s infinite;
}
@keyframes pulse {
  0% { transform: scale(0.95); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.5; }
  100% { transform: scale(0.95); opacity: 1; }
}
.dark-toggle {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #f8fafc;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  transition: var(--transition-smooth);
}
.dark-toggle:hover { background: rgba(255, 255, 255, 0.2); }

/* Main Header */
.main-header {
  background: var(--header-bg);
  border-bottom: 1px solid var(--border);
  padding: 16px 0;
}
.header-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logo {
  display: flex;
  align-items: center;
  gap: 14px;
}
.logo-icon-wrap {
  width: 44px;
  height: 44px;
  background: var(--primary-gradient);
  color: white;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.35rem;
}
.logo-text h1 {
  font-size: 1.55rem;
  font-weight: 800;
  color: var(--text);
  line-height: 1.1;
}
.logo-text h1 span { color: var(--primary); }
.logo-text .tagline { font-size: 0.76rem; color: var(--text-muted); font-weight: 500; }

/* Breaking bar */
.breaking-bar {
  background: linear-gradient(90deg, #b91c1c 0%, #0f172a 100%);
  color: #ffffff;
  padding: 8px 20px;
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}
.breaking-bar i { color: #fef08a; }

/* Article Wrap */
.article-wrap {
  max-width: 860px;
  margin: 32px auto 50px;
  padding: 0 20px;
}
.article-card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 34px;
  box-shadow: var(--card-shadow);
  border: 1px solid var(--border);
}
.crumb {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.crumb a { color: var(--primary); font-weight: 600; }
.article-badges {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.cat-tag {
  background: var(--primary);
  color: #fff;
  padding: 3px 12px;
  border-radius: var(--radius-pill);
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
}
.read-time-tag {
  color: var(--text-muted);
  font-size: 0.82rem;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
}
.article-title {
  font-size: 1.85rem;
  font-weight: 800;
  line-height: 1.38;
  color: var(--text);
  margin-bottom: 14px;
}
.card-meta {
  font-size: 0.85rem;
  color: var(--text-muted);
  display: flex;
  gap: 14px;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.article-img {
  width: 100%;
  max-height: 480px;
  object-fit: cover;
  border-radius: var(--radius-md);
  margin: 12px 0 20px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.06);
}
.article-desc {
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.7;
  color: var(--text);
  margin-bottom: 16px;
}
.full-content {
  margin-top: 16px;
  line-height: 1.9;
  font-size: 1.04rem;
  color: var(--text);
  overflow-wrap: break-word;
}
.full-content p { margin-bottom: 16px; }
.full-content img { max-width: 100%; height: auto; border-radius: var(--radius-md); margin: 12px 0; }

/* Adsterra sponsored box */
.ad-slot {
  background: var(--surface-subtle);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  margin: 24px 0;
  text-align: center;
  overflow: hidden;
}
.ad-label {
  font-size: 0.65rem;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  text-transform: uppercase;
  font-weight: 700;
  margin-bottom: 6px;
}

/* Reactions */
.reactions-box {
  background: var(--surface-subtle);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin: 30px 0 22px;
  border: 1px solid var(--border);
  text-align: center;
}
.reactions-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin-bottom: 14px;
  color: var(--text);
}
.reactions-btns {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.reaction-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 8px 16px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
  transition: var(--transition-smooth);
}
.reaction-btn:hover { transform: scale(1.08); border-color: var(--primary); }
.reaction-btn.user-reacted { background: rgba(220, 38, 38, 0.12); border-color: var(--primary); color: var(--primary); }

/* Share Bar */
.share-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 22px 0;
  padding: 16px;
  background: var(--surface-subtle);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}
.share-label {
  font-weight: 700;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 6px;
}
.share-buttons-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.share-btn {
  padding: 8px 15px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  color: #ffffff;
  transition: var(--transition-smooth);
  text-decoration: none;
}
.share-btn:hover { transform: translateY(-2px); opacity: 0.92; }
.share-btn-wa { background: #25d366; }
.share-btn-fb { background: #1877f2; }
.share-btn-tw { background: #000000; border: 1px solid rgba(255,255,255,0.2); }
.share-btn-tg { background: #0088cc; }
.share-btn-copy { background: #64748b; }

/* Navigation links */
.action-links {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 24px;
  flex-wrap: wrap;
}
.back-home {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--primary);
  color: #fff;
  padding: 11px 24px;
  border-radius: var(--radius-pill);
  text-decoration: none;
  font-weight: 700;
  font-size: 0.9rem;
  transition: var(--transition-smooth);
}
.back-home:hover { background: var(--primary-dark); transform: translateY(-1px); }
.source-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--surface-subtle);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 11px 20px;
  border-radius: var(--radius-pill);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
  transition: var(--transition-smooth);
}
.source-link:hover { border-color: var(--primary); color: var(--primary); }

/* Related Articles */
.related {
  margin-top: 36px;
  padding-top: 24px;
  border-top: 2px solid var(--border);
}
.related h2 {
  font-size: 1.2rem;
  font-weight: 800;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.related-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}
.related-card {
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: var(--transition-smooth);
}
.related-card:hover { transform: translateY(-3px); border-color: var(--primary); }
.related-card img { width: 100%; height: 110px; object-fit: cover; display: block; }
.related-card-content { padding: 10px; }
.related-cat-tag {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  display: inline-block;
  margin-bottom: 4px;
}
.related-card-title {
  font-size: 0.84rem;
  font-weight: 700;
  line-height: 1.35;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Back to Top */
.back-to-top {
  position: fixed;
  bottom: 25px;
  right: 25px;
  width: 44px;
  height: 44px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  z-index: 99;
  box-shadow: 0 4px 12px rgba(220,38,38,0.3);
  transition: var(--transition-smooth);
}
.back-to-top:hover { background: var(--primary-dark); transform: translateY(-3px); }
.back-to-top.visible { display: flex; }

/* Footer */
footer {
  background: var(--topbar-bg);
  color: #94a3b8;
  padding: 35px 20px 25px;
  text-align: center;
  font-size: 0.88rem;
  margin-top: 60px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
footer a { color: var(--primary); text-decoration: none; font-weight: 600; }

@media (max-width: 768px) {
  .article-card { padding: 20px; }
  .article-title { font-size: 1.4rem; }
  .share-section { flex-direction: column; align-items: stretch; }
  .share-buttons-row { justify-content: center; }
}
</style>
</head>
<body>
<!-- Adsterra Container -->
<div id="container-92a7664c8a64c05f627ef2d5add9408d"></div>

<div class="reading-progress-bar" id="readingProgressBar"></div>

<div class="top-bar">
  <div class="top-container">
    <div>
      <span class="live-badge"><span class="pulse-dot"></span> සජීවී</span> &nbsp;
      <span id="currentDateDisplay">News Sri Lanka 24</span>
    </div>
    <div>
      <button class="dark-toggle" id="darkModeToggle" aria-label="Toggle Theme">
        <i class="fas fa-moon"></i> <span id="themeToggleText">අඳුරු තේමාව</span>
      </button>
    </div>
  </div>
</div>

<header class="main-header">
  <div class="header-container">
    <a class="logo" href="${SITE}/">
      <div class="logo-icon-wrap"><i class="fas fa-newspaper"></i></div>
      <div class="logo-text">
        <h1>News Sri Lanka <span>24</span></h1>
        <span class="tagline">සැබෑ කාලීන සිංහල පුවත් සාරාංශ</span>
      </div>
    </a>
  </div>
</header>

<div class="breaking-bar">
  <i class="fas fa-bolt"></i> <span>නවතම පුවත් සාරාංශ • Real-Time News Updates</span>
</div>

<div class="article-wrap">
  <article class="article-card">
    <nav class="crumb" aria-label="breadcrumb">
      <a href="${SITE}/">මුල් පිටුව</a> <span>/</span> <a href="${SITE}/#${esc(cat)}">${esc(catLabel)}</a> <span>/</span> <span>${esc(title)}</span>
    </nav>
    <div class="article-badges">
      <span class="cat-tag">${esc(catLabel)}</span>
      <span class="read-time-tag"><i class="far fa-clock"></i> ${esc(readTime)}</span>
    </div>
    <h1 class="article-title">${esc(title)}</h1>
    <div class="card-meta">
      <span><i class="far fa-user"></i> ${esc(author)}</span>
      <span><i class="far fa-calendar-alt"></i> ${esc(dateHuman)}</span>
    </div>

    <img class="article-img" src="${esc(image)}" alt="${esc(title)}" width="860" height="460" loading="eager" fetchpriority="high" onerror="this.src='${PLACEHOLDER_IMG}'">

    ${desc ? `<p class="article-desc">${esc(desc)}</p>` : ""}

    <!-- In-Article Adsterra Unit (300x250) -->
    <div class="ad-slot">
      <div class="ad-label">SPONSORED</div>
      <script>
        atOptions = {
          'key' : 'dec4e43f04017b7d07d7deee36dc3e4a',
          'format' : 'iframe',
          'height' : 250,
          'width' : 300,
          'params' : {}
        };
      <\/script>
      <script src="https://www.highrevenueformat.com/dec4e43f04017b7d07d7deee36dc3e4a/invoke.js"><\/script>
    </div>

    ${contentHtml ? `<div class="full-content">${contentHtml}</div>` : ""}

    <!-- Reactions Box -->
    <div class="reactions-box">
      <div class="reactions-title"><i class="fas fa-heart-pulse"></i> මෙම පුවත ගැන ඔබගේ ප්‍රතිචාරය දක්වන්න</div>
      <div class="reactions-btns" id="reactionsBtns">
        <button class="reaction-btn" data-type="like">👍 <span>කැමතියි</span> <span class="cnt">(14)</span></button>
        <button class="reaction-btn" data-type="love">❤️ <span>ආදරෙයි</span> <span class="cnt">(28)</span></button>
        <button class="reaction-btn" data-type="wow">😮 <span>පුදුමයි</span> <span class="cnt">(7)</span></button>
        <button class="reaction-btn" data-type="sad">😢 <span>කණගාටුයි</span> <span class="cnt">(2)</span></button>
        <button class="reaction-btn" data-type="fire">🔥 <span>උණුසුම්</span> <span class="cnt">(35)</span></button>
      </div>
    </div>

    <!-- Social Share Buttons -->
    <div class="share-section">
      <span class="share-label"><i class="fas fa-share-nodes"></i> මිතුරන් සමඟ බෙදාගන්න:</span>
      <div class="share-buttons-row">
        <a class="share-btn share-btn-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${shareText}%20${shareUrl}"><i class="fab fa-whatsapp"></i> WhatsApp</a>
        <a class="share-btn share-btn-fb" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}"><i class="fab fa-facebook-f"></i> Facebook</a>
        <a class="share-btn share-btn-tw" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}"><i class="fab fa-x-twitter"></i> X</a>
        <a class="share-btn share-btn-tg" target="_blank" rel="noopener" href="https://t.me/share/url?url=${shareUrl}&text=${shareText}"><i class="fab fa-telegram"></i> Telegram</a>
        <button class="share-btn share-btn-copy" id="shareCopy"><i class="fas fa-link"></i> Link</button>
      </div>
    </div>

    <div class="action-links">
      ${sourceLink}
      <a class="back-home" href="${SITE}/"><i class="fas fa-arrow-left"></i> සියලුම පුවත් වෙත</a>
    </div>

    ${relatedHtml ? `<div class="related"><h2><i class="fas fa-layer-group"></i> සබැඳි පුවත් (Related Articles)</h2><div class="related-grid">${relatedHtml}</div></div>` : ""}

    <!-- Bottom Adsterra Banner (728x90 / 320x50) -->
    <div class="ad-slot" style="margin-top:30px;">
      <div class="ad-label">SPONSORED</div>
      <script>
        atOptions = {
          'key' : '893aa38ef072c8387fb5371b4cbe2259',
          'format' : 'iframe',
          'height' : 90,
          'width' : 728,
          'params' : {}
        };
      <\/script>
      <script src="https://www.highrevenueformat.com/893aa38ef072c8387fb5371b4cbe2259/invoke.js"><\/script>
    </div>
  </article>
</div>

<button class="back-to-top" id="backToTopBtn" aria-label="Back to Top"><i class="fas fa-arrow-up"></i></button>

<footer>
  <p>© 2026 <a href="${SITE}/">${esc(SEO.SITE_NAME)}</a>. සැබෑ කාලීන පුවත් සාරාංශ.</p>
</footer>

<script>
// Date display
const dateEl = document.getElementById("currentDateDisplay");
if (dateEl) {
  dateEl.textContent = new Date().toLocaleDateString("si-LK", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

// Reading Progress
window.addEventListener("scroll", () => {
  const h = document.documentElement.scrollHeight - window.innerHeight;
  const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
  const bar = document.getElementById("readingProgressBar");
  if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + "%";

  const btt = document.getElementById("backToTopBtn");
  if (btt) {
    if (window.scrollY > 400) btt.classList.add("visible");
    else btt.classList.remove("visible");
  }
}, { passive: true });

document.getElementById("backToTopBtn")?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// Dark Mode
const darkToggle = document.getElementById("darkModeToggle");
const themeTxt = document.getElementById("themeToggleText");
function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add("dark");
    document.body.classList.add("dark");
    if (themeTxt) themeTxt.textContent = "ආලෝක තේමාව";
    darkToggle.querySelector("i").className = "fas fa-sun";
  } else {
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark");
    if (themeTxt) themeTxt.textContent = "අඳුරු තේමාව";
    darkToggle.querySelector("i").className = "fas fa-moon";
  }
}
const saved = localStorage.getItem("theme");
if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  applyTheme(true);
} else {
  applyTheme(false);
}
darkToggle?.addEventListener("click", () => {
  const nextDark = !document.body.classList.contains("dark");
  applyTheme(nextDark);
  localStorage.setItem("theme", nextDark ? "dark" : "light");
});

// Copy link
document.getElementById("shareCopy")?.addEventListener("click", () => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText("${esc(url)}").then(() => alert("ලින්ක් එක සාර්ථකව copy කරගන්නා ලදී!"));
  } else {
    prompt("Copy link:", "${esc(url)}");
  }
});

// Reactions
const articleKey = "nsl_reactions_${esc(slug)}";
function getReactData() {
  const r = localStorage.getItem(articleKey);
  if (r) try { return JSON.parse(r); } catch(e) {}
  return { choice: null, counts: { like: 14, love: 28, wow: 7, sad: 2, fire: 35 } };
}
function saveReactData(d) { localStorage.setItem(articleKey, JSON.stringify(d)); }
function updateReactUI() {
  const d = getReactData();
  document.querySelectorAll("#reactionsBtns .reaction-btn").forEach(btn => {
    const t = btn.getAttribute("data-type");
    if (d.choice === t) btn.classList.add("user-reacted");
    else btn.classList.remove("user-reacted");
    const span = btn.querySelector(".cnt");
    if (span) span.textContent = "(" + (d.counts[t] || 0) + ")";
  });
}
document.querySelectorAll("#reactionsBtns .reaction-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const t = btn.getAttribute("data-type");
    const d = getReactData();
    if (d.choice === t) {
      d.counts[t] = Math.max(0, d.counts[t] - 1);
      d.choice = null;
    } else {
      if (d.choice) d.counts[d.choice] = Math.max(0, d.counts[d.choice] - 1);
      d.counts[t] = (d.counts[t] || 0) + 1;
      d.choice = t;
    }
    saveReactData(d);
    updateReactUI();
  });
});
updateReactUI();
</script>
</body>
</html>`;
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
    const related = articles
      .filter((other) => other.slug !== a.slug && (other.row.category === a.row.category || !a.row.category))
      .slice(0, 4);
    const changed = writeFileIfChanged(rel, renderArticlePage(a.row, a.slug, related));
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