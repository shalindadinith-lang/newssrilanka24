import { supabase } from "./supabase-config.js";

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
    $("tab-list").style.display   = tab === "list" ? "block" : "none";
    $("tab-editor").style.display = tab === "editor" ? "block" : "none";
    if (tab === "list") loadNews();
    if (tab === "editor") $("newsFormTitle").innerHTML = '<i class="fas fa-edit"></i> Add News';
  });
});

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("tab-list").style.display   = tab === "list" ? "block" : "none";
  $("tab-editor").style.display = tab === "editor" ? "block" : "none";
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

  if (result.error) { alert("Save error: " + result.error.message); return; }
  resetEditor();
  switchTab("list");
  loadNews();
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

// Init
initAuth();
resetEditor();