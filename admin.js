import { supabase } from "./supabase-config.js";

// Server-side trigger (Supabase Edge Function) that asks GitHub to regenerate
// static article pages immediately after a publish. No secrets live in JS —
// the function checks the caller is an authenticated admin, then dispatches
// the build. Fire-and-forget: if it isn't deployed yet, the scheduled
// workflow still covers regeneration automatically.
const TRIGGER_FN_URL = "https://jwjqhzrdrvqxwcahxmmb.supabase.co/functions/v1/trigger-articles";

async function triggerInstantRegeneration() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await fetch(TRIGGER_FN_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + data.session.access_token }
    });
  } catch (e) { /* optional trigger — ignore */ }
}

const CATEGORY_LABELS = {
  general: "General",
  "sri-lanka": "Sri Lanka",
  world: "World",
  technology: "Technology",
  sports: "Sports",
  business: "Business",
  entertainment: "Entertainment",
  education: "Education",
  health: "Health"
};

const $ = (id) => document.getElementById(id);

let editingDocId = null;
let uploadedImageUrl = null;
let newsCache = {};

// ------------------------------------------------------------------ Auth ----

supabase.auth.onAuthStateChange((_event, session) => {
  handleSession(session);
});

async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);
}

async function handleSession(session) {
  const user = session?.user || null;
  if (!user) { showLogin(); return; }
  const ok = await isAdminUser(user);
  if (!ok) {
    showNotAuthorized("Supabase profiles එකේ is_admin = true නැත. admin@newssrilanka24.com.lk ට admin claim සකස් කරන්න.");
    return;
  }
  showDashboard();
  $("adminEmail").textContent = user.email || "";
  loadNews();
}

async function isAdminUser(user) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (error) { console.warn("profiles query failed:", error.message); return false; }
    return !!(data && data.is_admin);
  } catch (e) {
    console.warn("isAdminUser error:", e);
    return false;
  }
}

function translateError(msg) {
  if (!msg) return "Unknown error.";
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email හෝ password වැරදියි.";
  if (m.includes("email not confirmed")) return "Email තහවුරු කර නැත.";
  return msg;
}

function showSaveStatus(msg, isError) {
  const el = $("saveStatus");
  if (!el) return;
  el.innerHTML = msg;
  el.style.display = "block";
  el.style.margin = "12px 0 0";
  el.style.padding = "10px 14px";
  el.style.borderRadius = "10px";
  el.style.fontSize = "0.9rem";
  el.style.border = "1px solid " + (isError ? "#f87171" : "#4ade80");
  el.style.background = isError ? "#7f1d1d33" : "#14532d33";
  el.style.color = isError ? "#fca5a5" : "#86efac";
  clearTimeout(window.__saveStatusTimer);
  window.__saveStatusTimer = setTimeout(() => { el.style.display = "none"; }, 25000);
}

// After publishing, watch the live article URL until the auto-generated
// static page is available (HTTP 200), then confirm it in the admin panel.
function pollArticleReadiness(finalSlug) {
  const url = "https://newssrilanka24.com.lk/article/" + finalSlug + "/";
  const el = $("saveStatus");
  if (!el) return;
  clearTimeout(window.__saveStatusTimer);
  el.style.display = "block";
  el.style.margin = "12px 0 0";
  el.style.padding = "10px 14px";
  el.style.borderRadius = "10px";
  el.style.fontSize = "0.9rem";
  el.style.border = "1px solid #4ade80";
  el.style.background = "#14532d33";
  el.style.color = "#86efac";
  let tries = 0;
  const update = (html) => { el.innerHTML = html; };
  update('Static page එක GitHub Actions මඟින් සෑදීමට පටන් ගෙන ඇත. URL එක check වෙමින් පවතී...<br><small><a href="' + url + '" target="_blank" rel="noopener">' + url + "</a></small>");
  const timer = setInterval(async () => {
    tries++;
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) {
        clearInterval(timer);
        update('✅ Article page live (HTTP ' + res.status + '): <a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>");
        window.__saveStatusTimer = setTimeout(() => { el.style.display = "none"; }, 15000);
        return;
      }
    } catch (e) {}
    if (tries >= 24) {
      clearInterval(timer);
      update('Static build සූදානම් වෙමින් පවතී (උපරිම ~5–7 මිනිත්තු). URL: <a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>");
      window.__saveStatusTimer = setTimeout(() => { el.style.display = "none"; }, 15000);
    }
  }, 20000);
}

function setLoginError(msg) { $("loginError").textContent = msg; }

function showLogin() {
  $("loginScreen").style.display = "flex";
  $("dashboard").style.display = "none";
  $("notAuthorized").style.display = "none";
  $("adminUserInfo").style.display = "none";
}

function showNotAuthorized(msg) {
  $("loginScreen").style.display = "none";
  $("dashboard").style.display = "none";
  $("notAuthorized").style.display = "flex";
  $("notAuthorizedMsg").textContent = msg;
}

function showDashboard() {
  $("loginScreen").style.display = "none";
  $("notAuthorized").style.display = "none";
  $("dashboard").style.display = "block";
  $("adminUserInfo").style.display = "flex";
  resetEditor();
  updatePendingCount();
}

// Login
$("loginBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const pass  = $("loginPassword").value;
  setLoginError("");
  if (!email || !pass) { setLoginError("Email සහ password ඇතුළත් කරන්න."); return; }
  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "Logging in...";
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false;
  btn.textContent = "Login";
  if (error) setLoginError(translateError(error.message));
});

// Logout
$("logoutBtn").addEventListener("click", () => supabase.auth.signOut());
$("backToLoginBtn").addEventListener("click", () => supabase.auth.signOut());

// --------------------------------------------------------------- Tabs ----

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("tab-list").style.display        = tab === "list" ? "block" : "none";
    $("tab-editor").style.display      = tab === "editor" ? "block" : "none";
    $("tab-submissions").style.display = tab === "submissions" ? "block" : "none";
    $("tab-poll").style.display        = tab === "poll" ? "block" : "none";
    if (tab === "list") loadNews();
    if (tab === "editor") $("newsFormTitle").innerHTML = '<i class="fas fa-edit"></i> Add News';
    if (tab === "submissions") loadSubmissions();
    if (tab === "poll") loadPollAdmin();
  });
});

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("tab-list").style.display        = tab === "list" ? "block" : "none";
  $("tab-editor").style.display      = tab === "editor" ? "block" : "none";
  $("tab-submissions").style.display = tab === "submissions" ? "block" : "none";
  $("tab-poll").style.display        = tab === "poll" ? "block" : "none";
}

// ------------------------------------------------------------- News ----

async function loadNews() {
  const tbody = $("newsTableBody");
  tbody.innerHTML = '<tr><td colspan="6">පූරණය වෙමින්...</td></tr>';
  const { data, error } = await supabase
    .from("news").select("*").order("published_at", { ascending: false });

  if (error) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--red);">Error: ' + escapeHtml(error.message) + "</td></tr>";
    return;
  }
  newsCache = {};
  tbody.innerHTML = "";
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">News නැත. මුලින්ම news එකක් add කරන්න.</td></tr>';
    return;
  }
  data.forEach((row) => {
    newsCache[row.id] = row;
    tbody.appendChild(buildRow(row));
  });
}

function buildRow(row) {
  const tr = document.createElement("tr");
  const d  = toDate(row.published_at);
  const dateStr = d ? d.toLocaleDateString("si-LK") : "-";
  const status  = row.status === "published" ? "published" : "draft";
  tr.innerHTML = `
    <td>${escapeHtml(row.title || "")}</td>
    <td>${row.language === "en" ? "English" : "සිංහල"}</td>
    <td>${CATEGORY_LABELS[row.category] || row.category || "-"}</td>
    <td><span class="status-badge ${status}">${status === "published" ? "Published" : "Draft"}</span></td>
    <td>${dateStr}</td>
    <td class="actions-cell">
      <button class="btn btn-info btn-sm"    data-action="view"   data-id="${row.id}">View</button>
      <button class="btn btn-secondary btn-sm" data-action="edit"   data-id="${row.id}">Edit</button>
      <button class="btn btn-primary btn-sm"   data-action="toggle" data-id="${row.id}" data-status="${status}">${status === "published" ? "Unpublish" : "Publish"}</button>
      <button class="btn btn-danger btn-sm"    data-action="delete" data-id="${row.id}">Delete</button>
    </td>`;
  return tr;
}

$("newsTableBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id   = btn.dataset.id;
  const row  = newsCache[id];
  const act  = btn.dataset.action;
  if (act === "view")   viewArticle(row);
  else if (act === "edit")   editArticle(row);
  else if (act === "toggle") toggleStatus(id, row.status);
  else if (act === "delete") deleteArticle(id);
});

async function toggleStatus(id, currentStatus) {
  const next = currentStatus === "published" ? "draft" : "published";
  const { error } = await supabase.from("news").update({ status: next }).eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  loadNews();
}

async function deleteArticle(id) {
  if (!confirm("මෙම News එක ස්ථිරවම මකන්නද?")) return;
  const row = newsCache[id];
  if (row && row.image_url) { await removeStorageFile(row.image_url); }
  const { error } = await supabase.from("news").delete().eq("id", id);
  if (error) { alert("Delete error: " + error.message); return; }
  loadNews();
}

// --------------------------------------------------------------- View ----

function viewArticle(row) {
  const body = $("viewBody");
  const d = toDate(row.published_at);
  body.innerHTML = `
    <h2 style="color:var(--primary);">${escapeHtml(row.title || "")}</h2>
    <p style="color:var(--text-secondary);margin:8px 0;">
      ${CATEGORY_LABELS[row.category] || row.category || "-"} •
      ${row.language === "en" ? "English" : "සිංහල"} •
      ${d ? d.toLocaleString("si-LK") : ""}
    </p>
    ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" style="width:100%;border-radius:16px;margin:12px 0;">` : ""}
    <p><strong>Short Description:</strong><br>${escapeHtml(row.short_description || "")}</p>
    <div style="margin-top:12px;line-height:1.8;"><strong>Full Content:</strong><br>${escapeHtml(row.content || "")}</div>
    <p style="margin-top:12px;"><strong>Author:</strong> ${escapeHtml(row.author || "News Sri Lanka 24")} &nbsp;|&nbsp;
    <strong>Status:</strong> ${row.status} &nbsp;|&nbsp;
    <strong>Breaking:</strong> ${row.is_breaking ? "Yes" : "No"} &nbsp;|&nbsp;
    <strong>Featured:</strong> ${row.is_featured ? "Yes" : "No"}</p>`;
  $("viewModal").style.display = "flex";
}

// -------------------------------------------------------------- Edit ----

function editArticle(row) {
  editingDocId = row.id;
  $("docId").value                = row.id;
  $("newsTitle").value            = row.title || "";
  $("newsShortDescription").value = row.short_description || "";
  $("newsContent").value          = row.content || "";
  $("newsCategory").value         = row.category || "general";
  $("newsLanguage").value         = row.language || "si";
  $("newsAuthor").value           = row.author || "News Sri Lanka 24";
  $("newsBreaking").checked       = !!row.is_breaking;
  $("newsFeatured").checked       = !!row.is_featured;
  $("newsStatus").value           = row.status || "draft";
  const d = toDate(row.published_at);
  $("newsPublishedAt").value      = d ? toLocalInputValue(d) : toLocalInputValue(new Date());

  uploadedImageUrl = row.image_url || null;
  if (uploadedImageUrl) { $("imagePreview").src = uploadedImageUrl; $("imagePreview").style.display = "block"; }
  else                  { $("imagePreview").style.display = "none"; }
  $("newsImage").value = "";
  switchTab("editor");
  $("newsFormTitle").innerHTML = '<i class="fas fa-edit"></i> Edit News';
}

// ---------------------------------------------------------- Image ----

$("newsImage").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const errEl = $("uploadError");
  errEl.textContent = ""; errEl.className = "upload-error";

  if (!file.type.startsWith("image/")) { errEl.textContent = "Image file එකක් select කරන්න."; e.target.value = ""; return; }
  if (file.size > 5 * 1024 * 1024)     { errEl.textContent = "Image 5MB ට වැඩියි."; e.target.value = ""; return; }

  const input = e.target;
  input.disabled = true;
  errEl.textContent = "Uploading... (Supabase Storage)";

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = Date.now() + "_" + safeName;

  const { error } = await supabase.storage.from("news").upload(path, file, {
    contentType: file.type,
    cacheControl: "3600"
  });
  input.disabled = false;

  if (error) {
    uploadedImageUrl = null;
    errEl.textContent = "Image upload අසාර්ථකයි: " + error.message;
    return;
  }

  const { data: pub } = supabase.storage.from("news").getPublicUrl(path);
  uploadedImageUrl = pub.publicUrl;
  $("imagePreview").src = uploadedImageUrl;
  $("imagePreview").style.display = "block";
  errEl.textContent = "Upload සාර්ථකයි."; errEl.className = "upload-error upload-ok";

  // delete old image if replacing
  if (editingDocId && newsCache[editingDocId] && newsCache[editingDocId].image_url && newsCache[editingDocId].image_url !== uploadedImageUrl) {
    await removeStorageFile(newsCache[editingDocId].image_url);
  }
});

// ---------------------------------------------------------- Save ----

async function saveNews(statusOverride) {
  const title = $("newsTitle").value.trim();
  if (!title) { alert("Title අවශ්‍යයි."); return; }

  const pubInput = $("newsPublishedAt").value;
  const pubDate  = pubInput ? new Date(pubInput).toISOString() : null;

  const payload = {
    title,
    short_description: $("newsShortDescription").value.trim(),
    content:           $("newsContent").value.trim(),
    category:          $("newsCategory").value,
    language:          $("newsLanguage").value,
    author:            ($("newsAuthor").value.trim() || "News Sri Lanka 24"),
    is_breaking:       $("newsBreaking").checked,
    is_featured:       $("newsFeatured").checked,
    status:            statusOverride || $("newsStatus").value,
    image_url:         uploadedImageUrl || ""
  };

  let result;
  if (editingDocId) {
    if (pubDate) payload.published_at = pubDate;
    // Preserve existing slug — don't break URLs
    payload.slug = newsCache[editingDocId]?.slug || generateSlug(title);
    result = await supabase.from("news").update(payload).eq("id", editingDocId);
  } else {
    payload.published_at = pubDate || new Date().toISOString();
    payload.source = "manual";
    payload.slug = generateSlug(title);
    result = await supabase.from("news").insert(payload);
  }

  if (result.error) { showSaveStatus("Save error: " + result.error.message, true); return; }

  const finalSlug = payload.slug || (editingDocId && newsCache[editingDocId] && newsCache[editingDocId].slug) || generateSlug(title);
  const liveUrl = "https://newssrilanka24.com.lk/article/" + finalSlug + "/";
  const liveStatus = (statusOverride || payload.status) === "published";

  resetEditor();
  switchTab("list");
  loadNews();

  showSaveStatus(
    (liveStatus ? "Article published." : "Draft saved.") +
    (liveStatus
      ? ' Live URL: <a href="' + liveUrl + '" target="_blank" rel="noopener">' + liveUrl + "</a><br>" +
        "<small>Static page එක GitHub Actions මඟින් ස්වයංක්‍රීයව සෑදේ (උපරිම ~5–7 මිනිත්තු). URL එක සූදානම් වූ විට මෙතනින් දැනුම් දෙයි.</small>"
      : ""),
    false
  );

  if (liveStatus) {
    pollArticleReadiness(finalSlug);
    triggerInstantRegeneration();
  }
}

$("publishBtn").addEventListener("click", () => saveNews("published"));
$("saveDraftBtn").addEventListener("click", () => saveNews("draft"));

// ---------------------------------------------------------- Preview ----

$("previewBtn").addEventListener("click", () => {
  const title = $("newsTitle").value.trim();
  if (!title) { alert("Preview සඳහා title අවශ්‍යයි."); return; }
  const img = uploadedImageUrl || "https://via.placeholder.com/800x400?text=News";
  $("previewBody").innerHTML = `
    <h2 style="color:var(--primary);">${escapeHtml(title)}</h2>
    <p style="color:var(--text-secondary);margin:8px 0;">
      ${CATEGORY_LABELS[$("newsCategory").value]} •
      ${$("newsLanguage").value === "en" ? "English" : "සිංහල"} •
      ${$("newsPublishedAt").value ? new Date($("newsPublishedAt").value).toLocaleString("si-LK") : ""}
    </p>
    <img src="${escapeHtml(img)}" style="width:100%;border-radius:16px;margin:12px 0;">
    <p>${escapeHtml($("newsShortDescription").value)}</p>
    <div style="margin-top:12px;line-height:1.8;">${($("newsContent").value || "").replace(/\n/g, "<br>")}</div>`;
  $("previewModal").style.display = "flex";
});

// ---------------------------------------------------------- Clear ----

$("clearBtn").addEventListener("click", resetEditor);

function resetEditor() {
  editingDocId   = null;
  uploadedImageUrl = null;
  $("docId").value = "";
  $("newsForm").reset();
  $("newsAuthor").value   = "News Sri Lanka 24";
  $("newsStatus").value   = "draft";
  $("newsPublishedAt").value = toLocalInputValue(new Date());
  $("imagePreview").style.display = "none"; $("imagePreview").src = "";
  $("uploadError").textContent = ""; $("uploadError").className = "upload-error";
  $("newsImage").value = "";
  const st = $("saveStatus");
  if (st) st.style.display = "none";
}

// ---------------------------------------------------------- Modal ----

function closeModal(id) { $(id).style.display = "none"; }
$("closeViewModal").addEventListener("click",   () => closeModal("viewModal"));
$("closePreviewModal").addEventListener("click", () => closeModal("previewModal"));
["viewModal","previewModal"].forEach((id) => {
  $(id).addEventListener("click", (e) => { if (e.target === $(id)) closeModal(id); });
});

// --------------------------------------------------------- Helpers ----

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function generateSlug(title) {
  const base = String(title).toLowerCase().replace(/[^a-z0-9\u0D80-\u0DFF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return (base || "news") + "-" + Date.now().toString(36);
}

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function publicUrlToRelPath(publicUrl) {
  const marker = "/object/public/news/";
  const i = publicUrl.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(publicUrl.slice(i + marker.length).split("?")[0]);
}

async function removeStorageFile(publicUrl) {
  const rel = publicUrlToRelPath(publicUrl);
  if (!rel) return;
  await supabase.storage.from("news").remove([rel]);
}

// =======================================================
// SUBMISSIONS MODERATION SYSTEM
// =======================================================

let submissionsCache = {};
let currentSubFilter = "pending";

async function updatePendingCount() {
  try {
    const { count, error } = await supabase
      .from("submissions")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (!error && count !== null) {
      const badge = $("pendingBadge");
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? "inline-block" : "none";
      }
    }
  } catch (e) {}
}

async function loadSubmissions(filter = currentSubFilter) {
  currentSubFilter = filter;
  const tbody = $("submissionsTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">පූරණය වෙමින්...</td></tr>';

  try {
    let query = supabase.from("submissions").select("*").order("created_at", { ascending: false });
    if (filter !== "all") {
      query = query.eq("status", filter);
    }
    const { data, error } = await query;
    if (error) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:var(--red);">Submissions table load error: ' + escapeHtml(error.message) + '<br><small>Supabase SQL Editor හි අදාළ schema update එක run කර ඇත්දැයි තහවුරු කරන්න.</small></td></tr>';
      return;
    }
    submissionsCache = {};
    tbody.innerHTML = "";
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">"${filter}" යටතේ කිසිදු submission එකක් නැත.</td></tr>`;
      updatePendingCount();
      return;
    }
    data.forEach((row) => {
      submissionsCache[row.id] = row;
      tbody.appendChild(buildSubmissionRow(row));
    });
    updatePendingCount();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--red);">Error: ' + escapeHtml(err.message) + '</td></tr>';
  }
}

function buildSubmissionRow(row) {
  const tr = document.createElement("tr");
  const d = toDate(row.created_at);
  const dateStr = d ? d.toLocaleString("si-LK") : "-";
  const typeBadge = row.type === "ad" ? "📢 දැන්වීම් (Ad)" : "📰 පුවත් (News)";
  const status = row.status || "pending";
  const statusLabel = status === "approved" ? "Approved" : (status === "rejected" ? "Rejected" : "Pending");

  tr.innerHTML = `
    <td><span style="font-size:0.8rem; font-weight:700;">${typeBadge}</span></td>
    <td><strong>${escapeHtml(row.title || "")}</strong></td>
    <td>${CATEGORY_LABELS[row.category] || row.category || "-"}</td>
    <td>${escapeHtml(row.contact_info || "Anonymous")}</td>
    <td>${dateStr}</td>
    <td><span class="status-badge ${status}">${statusLabel}</span></td>
    <td class="actions-cell">
      <button class="btn btn-info btn-sm" data-sub-action="view" data-id="${row.id}">View</button>
      <button class="btn btn-secondary btn-sm" data-sub-action="edit" data-id="${row.id}">Edit</button>
      ${status !== "approved" ? `<button class="btn btn-primary btn-sm" data-sub-action="approve" data-id="${row.id}"><i class="fas fa-check"></i> Approve</button>` : `<span style="color:var(--green);font-size:0.8rem;font-weight:600;"><i class="fas fa-check-circle"></i> Live</span>`}
      <button class="btn btn-danger btn-sm" data-sub-action="delete" data-id="${row.id}">Delete</button>
    </td>
  `;
  return tr;
}

const subTableBody = $("submissionsTableBody");
if (subTableBody) {
  subTableBody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sub-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const row = submissionsCache[id];
    const act = btn.dataset.subAction;
    if (act === "view") viewSubmission(row);
    else if (act === "edit") editSubmission(row);
    else if (act === "approve") approveSubmission(row);
    else if (act === "delete") deleteSubmission(id);
  });
}

document.querySelectorAll("button[data-sub-filter]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("button[data-sub-filter]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadSubmissions(btn.dataset.subFilter);
  });
});

const refreshSubBtn = $("refreshSubmissionsBtn");
if (refreshSubBtn) refreshSubBtn.addEventListener("click", () => loadSubmissions());

function viewSubmission(row) {
  if (!row) return;
  const body = $("submissionViewBody");
  const d = toDate(row.created_at);
  const typeBadge = row.type === "ad" ? "📢 දැන්වීමක් (Advertisement)" : "📰 පුවතක් (News Article)";
  body.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:14px;">
      <div>
        <span class="status-badge ${row.status}">${row.status.toUpperCase()}</span>
        <span style="font-weight:700; margin-left:8px;">${typeBadge}</span>
      </div>
      <small style="color:var(--text-secondary);">${d ? d.toLocaleString("si-LK") : ""}</small>
    </div>
    <h2 style="color:var(--primary); margin-bottom:10px;">${escapeHtml(row.title)}</h2>
    <p style="color:var(--text-secondary); margin-bottom:12px;">
      <strong>Category:</strong> ${CATEGORY_LABELS[row.category] || row.category || "-"} &nbsp;|&nbsp;
      <strong>Contact / Submitter:</strong> ${escapeHtml(row.contact_info || "Not provided")}
    </p>
    ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" style="width:100%; max-height:400px; object-fit:cover; border-radius:16px; margin:12px 0;">` : ""}
    <div style="background:var(--bg); padding:16px; border-radius:14px; margin-top:14px; line-height:1.8; white-space:pre-wrap;">${escapeHtml(row.description || row.content || "No description provided.")}</div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
      <button class="btn btn-secondary" onclick="document.getElementById('submissionViewModal').style.display='none'">Close</button>
      ${row.status !== "approved" ? `<button class="btn btn-primary" onclick="approveFromModal('${row.id}')"><i class="fas fa-check-circle"></i> Approve &amp; Publish</button>` : ""}
    </div>
  `;
  $("submissionViewModal").style.display = "flex";
}

window.approveFromModal = (id) => {
  closeModal("submissionViewModal");
  approveSubmission(submissionsCache[id]);
};

function editSubmission(row) {
  if (!row) return;
  $("editSubId").value = row.id;
  $("editSubType").value = row.type || "ad";
  $("editSubCategory").value = row.category || "general";
  $("editSubTitle").value = row.title || "";
  $("editSubDescription").value = row.description || row.content || "";
  $("editSubImageUrl").value = row.image_url || "";
  $("editSubContact").value = row.contact_info || "";
  const prevEl = $("editSubImagePreview");
  if (row.image_url) {
    prevEl.innerHTML = `<img src="${escapeHtml(row.image_url)}" style="max-width:240px; border-radius:10px;">`;
  } else {
    prevEl.innerHTML = "";
  }
  $("submissionEditModal").style.display = "flex";
}

const saveSubEditBtn = $("saveSubEditBtn");
if (saveSubEditBtn) {
  saveSubEditBtn.addEventListener("click", async () => {
    const id = $("editSubId").value;
    const title = $("editSubTitle").value.trim();
    const description = $("editSubDescription").value.trim();
    if (!title) { alert("Title is required."); return; }

    const payload = {
      type: $("editSubType").value,
      category: $("editSubCategory").value,
      title,
      description,
      content: description,
      image_url: $("editSubImageUrl").value.trim(),
      contact_info: $("editSubContact").value.trim()
    };

    const { error } = await supabase.from("submissions").update(payload).eq("id", id);
    if (error) { alert("Update error: " + error.message); return; }
    closeModal("submissionEditModal");
    loadSubmissions();
  });
}

const approveDirectlyBtn = $("approveDirectlyFromEditBtn");
if (approveDirectlyBtn) {
  approveDirectlyBtn.addEventListener("click", async () => {
    const id = $("editSubId").value;
    const title = $("editSubTitle").value.trim();
    const description = $("editSubDescription").value.trim();
    if (!title) { alert("Title is required."); return; }

    const payload = {
      type: $("editSubType").value,
      category: $("editSubCategory").value,
      title,
      description,
      content: description,
      image_url: $("editSubImageUrl").value.trim(),
      contact_info: $("editSubContact").value.trim()
    };

    const { error } = await supabase.from("submissions").update(payload).eq("id", id);
    if (error) { alert("Update error: " + error.message); return; }
    closeModal("submissionEditModal");
    await approveSubmission({ ...payload, id });
  });
}

async function approveSubmission(row) {
  if (!row) return;
  if (!confirm(`"${row.title}" පුවත/දැන්වීම සජීවීව අඩවියේ පළ කිරීමට අනුමත කරන්නද?`)) return;

  const article = {
    title: row.title,
    short_description: row.description ? row.description.slice(0, 200) : "",
    content: row.description || row.content || "",
    category: row.category || "general",
    language: "si",
    author: row.contact_info ? `News Sri Lanka 24 (පාඨක යොමුකිරීම්: ${row.contact_info})` : "News Sri Lanka 24",
    published_at: new Date().toISOString(),
    status: "published",
    is_breaking: false,
    is_featured: false,
    source: "manual",
    image_url: row.image_url || "",
    slug: generateSlug(row.title)
  };

  const { error: insErr } = await supabase.from("news").insert(article);
  if (insErr) {
    alert("Error publishing to news table: " + insErr.message);
    return;
  }

  const { error: updErr } = await supabase.from("submissions").update({ status: "approved" }).eq("id", row.id);
  if (updErr) {
    console.warn("Submissions status update error:", updErr.message);
  }

  alert("✅ පුවත/දැන්වීම සාර්ථකව අනුමත කර සජීවීව පළ කරන ලදී!");
  loadSubmissions();
  triggerInstantRegeneration();
}

async function deleteSubmission(id) {
  if (!confirm("මෙම Submission එක ස්ථිරවම මකා දමන්නද?")) return;
  const { error } = await supabase.from("submissions").delete().eq("id", id);
  if (error) { alert("Delete error: " + error.message); return; }
  loadSubmissions();
}

const closeSubView = $("closeSubViewModal");
if (closeSubView) closeSubView.addEventListener("click", () => closeModal("submissionViewModal"));
const closeSubEdit = $("closeSubEditModal");
if (closeSubEdit) closeSubEdit.addEventListener("click", () => closeModal("submissionEditModal"));
["submissionViewModal", "submissionEditModal"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("click", (e) => { if (e.target === el) closeModal(id); });
});

// =======================================================
// DAILY POLL MANAGEMENT
// =======================================================

let currentPollId = null;

async function loadPollAdmin() {
  const msgEl = $("pollStatusMsg");
  if (msgEl) msgEl.style.display = "none";

  try {
    const { data: polls, error } = await supabase
      .from("polls")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      if (msgEl) {
        msgEl.innerHTML = `<span style="color:var(--red);">Polls table load error: ${escapeHtml(error.message)}.<br><small>Supabase SQL editor හි polls table එක සාදා ඇත්දැයි තහවුරු කරන්න.</small></span>`;
        msgEl.style.display = "block";
      }
      renderDefaultPollBuilder();
      return;
    }

    renderPollsHistoryTable(polls || []);

    const activePoll = (polls || []).find(p => p.is_active) || (polls || [])[0];
    if (activePoll) {
      populatePollForm(activePoll);
    } else {
      renderDefaultPollBuilder();
    }
  } catch (err) {
    if (msgEl) {
      msgEl.innerHTML = `<span style="color:var(--red);">Error: ${escapeHtml(err.message)}</span>`;
      msgEl.style.display = "block";
    }
    renderDefaultPollBuilder();
  }
}

function renderDefaultPollBuilder() {
  currentPollId = null;
  $("pollId").value = "";
  $("pollQuestion").value = "ලබන වසරේ ශ්‍රී ලංකා ආර්ථිකයේ වර්ධනය පිළිබඳ ඔබගේ බලාපොරොත්තුව කුමක්ද?";
  $("pollIsActive").checked = true;
  const container = $("pollOptionsContainer");
  if (!container) return;
  container.innerHTML = "";
  addPollOptionRow("📈 ඉතා යහපත් (Positive)", 45, "positive");
  addPollOptionRow("⚖️ මධ්‍යස්ථයි (Moderate)", 35, "moderate");
  addPollOptionRow("📉 අභියෝගාත්මකයි (Challenging)", 20, "challenging");
}

function populatePollForm(poll) {
  currentPollId = poll.id;
  $("pollId").value = poll.id;
  $("pollQuestion").value = poll.question || "";
  $("pollIsActive").checked = !!poll.is_active;

  const container = $("pollOptionsContainer");
  if (!container) return;
  container.innerHTML = "";
  let options = poll.options;
  if (typeof options === "string") {
    try { options = JSON.parse(options); } catch (e) { options = []; }
  }
  if (Array.isArray(options) && options.length > 0) {
    options.forEach(opt => {
      addPollOptionRow(opt.text || "", opt.votes || 0, opt.id || generateOptId());
    });
  } else {
    addPollOptionRow("ඔව් (Yes)", 0, "yes");
    addPollOptionRow("නැත (No)", 0, "no");
  }
}

function generateOptId() {
  return "opt_" + Math.random().toString(36).substring(2, 8);
}

function addPollOptionRow(text = "", votes = 0, id = generateOptId()) {
  const container = $("pollOptionsContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "poll-option-row";
  row.dataset.optId = id;
  row.innerHTML = `
    <input type="text" class="poll-opt-text" placeholder="Option text (e.g. ඔව් / Yes)" value="${escapeHtml(text)}">
    <div style="display:flex; align-items:center; gap:4px;">
      <small style="color:var(--text-secondary);font-size:0.75rem;">Votes:</small>
      <input type="number" class="poll-opt-votes" min="0" value="${parseInt(votes) || 0}">
    </div>
    <button type="button" class="btn btn-danger btn-sm remove-opt-btn" title="Remove Option"><i class="fas fa-trash"></i></button>
  `;
  row.querySelector(".remove-opt-btn").addEventListener("click", () => {
    if (container.querySelectorAll(".poll-option-row").length <= 2) {
      alert("අවම වශයෙන් විකල්ප 2ක් තිබිය යුතුය (At least 2 options required).");
      return;
    }
    row.remove();
  });
  container.appendChild(row);
}

const addPollOptBtn = $("addPollOptionBtn");
if (addPollOptBtn) addPollOptBtn.addEventListener("click", () => addPollOptionRow("", 0));

const savePollBtn = $("savePollBtn");
if (savePollBtn) {
  savePollBtn.addEventListener("click", async () => {
    const question = $("pollQuestion").value.trim();
    if (!question) { alert("Poll question is required."); return; }

    const rows = $("pollOptionsContainer").querySelectorAll(".poll-option-row");
    if (rows.length < 2) { alert("At least 2 options are required."); return; }

    const options = [];
    rows.forEach((r, idx) => {
      const text = r.querySelector(".poll-opt-text").value.trim();
      const votes = parseInt(r.querySelector(".poll-opt-votes").value) || 0;
      const optId = r.dataset.optId || ("opt_" + idx);
      if (text) {
        options.push({ id: optId, text, votes });
      }
    });

    if (options.length < 2) { alert("Please provide text for at least 2 options."); return; }

    const isActive = $("pollIsActive").checked;
    const pollId = $("pollId").value;
    const msgEl = $("pollStatusMsg");

    try {
      if (isActive) {
        await supabase.from("polls").update({ is_active: false }).neq("id", pollId || "00000000-0000-0000-0000-000000000000");
      }

      let res;
      if (pollId) {
        res = await supabase.from("polls").update({
          question,
          options,
          is_active: isActive
        }).eq("id", pollId);
      } else {
        res = await supabase.from("polls").insert({
          question,
          options,
          is_active: isActive
        });
      }

      if (res.error) {
        alert("Error saving poll: " + res.error.message);
        return;
      }

      if (msgEl) {
        msgEl.innerHTML = `<span style="color:var(--green); font-weight:600;">✅ දවසේ මත විමසුම සාර්ථකව සුරකින ලදී! (Poll saved successfully)</span>`;
        msgEl.style.display = "block";
      }
      loadPollAdmin();
    } catch (err) {
      alert("Error: " + err.message);
    }
  });
}

const resetPollVotesBtn = $("resetPollVotesBtn");
if (resetPollVotesBtn) {
  resetPollVotesBtn.addEventListener("click", async () => {
    if (!confirm("මෙම මත විමසුමේ සියලු ඡන්ද ගණන් 0 (Zero) කිරීමට අවශ්‍යද?")) return;
    const rows = $("pollOptionsContainer").querySelectorAll(".poll-option-row");
    rows.forEach(r => {
      r.querySelector(".poll-opt-votes").value = 0;
    });
    const pollId = $("pollId").value;
    if (pollId) {
      const options = [];
      rows.forEach((r, idx) => {
        const text = r.querySelector(".poll-opt-text").value.trim();
        const optId = r.dataset.optId || ("opt_" + idx);
        options.push({ id: optId, text, votes: 0 });
      });
      await supabase.from("polls").update({ options }).eq("id", pollId);
      alert("ඡන්ද සංඛ්‍යා 0 ට reset කරන ලදී.");
      loadPollAdmin();
    }
  });
}

const newPollBtn = $("newPollBtn");
if (newPollBtn) {
  newPollBtn.addEventListener("click", () => {
    renderDefaultPollBuilder();
    $("pollQuestion").value = "";
    $("pollOptionsContainer").innerHTML = "";
    addPollOptionRow("", 0);
    addPollOptionRow("", 0);
  });
}

function renderPollsHistoryTable(polls) {
  const tbody = $("pollsHistoryTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!polls || polls.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No polls recorded yet.</td></tr>`;
    return;
  }
  polls.forEach(p => {
    const tr = document.createElement("tr");
    let opts = p.options;
    if (typeof opts === "string") { try { opts = JSON.parse(opts); } catch(e){ opts = []; } }
    const totalVotes = Array.isArray(opts) ? opts.reduce((acc, o) => acc + (parseInt(o.votes) || 0), 0) : 0;
    const d = toDate(p.created_at);
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.question || "")}</strong></td>
      <td>${Array.isArray(opts) ? opts.length : 0} options</td>
      <td><strong>${totalVotes}</strong></td>
      <td><span class="status-badge ${p.is_active ? 'approved' : 'pending'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>${d ? d.toLocaleDateString("si-LK") : "-"}</td>
      <td class="actions-cell">
        <button class="btn btn-secondary btn-sm" onclick="editPollHistory('${p.id}')">Edit</button>
        ${!p.is_active ? `<button class="btn btn-primary btn-sm" onclick="activatePollHistory('${p.id}')">Activate</button>` : ""}
        <button class="btn btn-danger btn-sm" onclick="deletePollHistory('${p.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.editPollHistory = async (id) => {
  const { data } = await supabase.from("polls").select("*").eq("id", id).maybeSingle();
  if (data) populatePollForm(data);
};

window.activatePollHistory = async (id) => {
  await supabase.from("polls").update({ is_active: false }).neq("id", id);
  await supabase.from("polls").update({ is_active: true }).eq("id", id);
  loadPollAdmin();
};

window.deletePollHistory = async (id) => {
  if (!confirm("මෙම Poll එක ස්ථිරවම මකා දමන්නද?")) return;
  await supabase.from("polls").delete().eq("id", id);
  loadPollAdmin();
};

// Init
initAuth();
resetEditor();