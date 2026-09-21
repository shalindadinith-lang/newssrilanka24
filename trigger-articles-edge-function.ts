// ============================================================
// Supabase Edge Function — Instant static article regeneration
// ============================================================
// PURPOSE
//   When the admin publishes a new article, admin.js calls this
//   function. It validates that the caller is an authenticated
//   admin (via their Supabase JWT), then sends a GitHub
//   repository_dispatch event so build-static.js runs IMMEDIATELY
//   — no waiting for GitHub's scheduled cron, no manual build.
//
// SECURITY
//   The GitHub PAT lives ONLY in Supabase Secrets (server-side).
//   It is never present in client-side JS or public files.
//   Only users whose profiles.is_admin = true can trigger a build.
//
// DEPLOY (one-time, owner does this):
//   supabase login
//   supabase link --project-ref jwjqhzrdrvqxwcahxmmb
//   supabase secrets set GH_PAT=<PAT: repo/actions:write scope>
//   supabase functions deploy trigger-articles --no-verify-jwt
//
// Unless this is deployed, admin.js fails silently and the
// scheduled workflow still covers regeneration automatically.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GH_OWNER = "shalindadinith-lang";
const GH_REPO = "newssrilanka24";
const EVENT_TYPE = "generate-articles";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing token" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid token" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || !profile.is_admin) return json({ error: "Not authorized" }, 403);

    const pat = Deno.env.get("GH_PAT");
    if (!pat) return json({ error: "GH_PAT secret not configured" }, 500);

    const gh = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + pat,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "news-trigger"
      },
      body: JSON.stringify({ event_type: EVENT_TYPE })
    });

    if (gh.status !== 204) {
      const t = await gh.text();
      return json({ error: "GitHub dispatch failed: " + gh.status + " " + t.slice(0, 200) }, 502);
    }

    return json({ ok: true }, 202);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
});