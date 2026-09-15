import { supabase } from "./supabase-config.js";

const PLACEHOLDER_IMG = "https://via.placeholder.com/800x400?text=News";

function toArticleObject(row) {
  return {
    id: row.id,
    title: row.title || "Untitled",
    link: "#supabase-" + row.id,
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