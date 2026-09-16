import { supabase } from "./supabase-config.js";

const PLACEHOLDER_IMG = "https://via.placeholder.com/800x400?text=News";

export function hashCode(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = ((h << 5) - h + String(str).charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function generateArticleSlug(title, salt) {
  const base = String(title || "news")
    .toLowerCase()
    .replace(/[^a-z0-9\u0D80-\u0DFF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const h = hashCode(String(salt || "")).toString(36).slice(0, 5);
  return (base || "news") + "-" + h;
}

function toArticleObject(row) {
  const slug = row.slug || generateArticleSlug(row.title, row.id);
  return {
    id: row.id,
    title: row.title || "Untitled",
    slug: slug,
    link: "/article/" + slug,
    description: row.short_description || "",
    content: row.content || "",
    thumbnail: row.image_url || PLACEHOLDER_IMG,
    pubDate: row.published_at,
    category: row.category || "general",
    language: row.language || "si",
    author: row.author || "News Sri Lanka 24",
    source: "manual",
    isBreaking: !!row.is_breaking,
    isFeatured: !!row.is_featured
  };
}

export async function fetchSupabaseNews() {
  const { data, error } = await supabase
    .from("news")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map((row) => toArticleObject(row));
}