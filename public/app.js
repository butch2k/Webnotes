const noteList = document.getElementById("note-list");
const editorArea = document.getElementById("editor-area");
const emptyState = document.getElementById("empty-state");
const titleInput = document.getElementById("note-title");
const langSelect = document.getElementById("note-lang");
const contentArea = document.getElementById("note-content");
const previewEl = document.getElementById("note-preview");
const mdPreviewEl = document.getElementById("md-preview");
const btnNew = document.getElementById("btn-new");
const btnPreview = document.getElementById("btn-preview");
const btnCopy = document.getElementById("btn-copy");
const btnExport = document.getElementById("btn-export");
const btnDelete = document.getElementById("btn-delete");
const btnPin = document.getElementById("btn-pin");
const btnTheme = document.getElementById("btn-theme");
const themeIcon = document.getElementById("theme-icon");
const saveIndicator = document.querySelector(".save-indicator");
const offlineBanner = document.getElementById("offline-banner");
const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const statusStats = document.getElementById("status-stats");
const dropZone = document.getElementById("drop-zone");
const notebookInput = document.getElementById("note-notebook");
const notebookList = document.getElementById("notebook-list");
const notebookBar = document.getElementById("notebook-bar");

let currentNoteId = null;
let currentNotePinned = false;
let currentNotebook = null; // null = all, "" = unfiled, "name" = specific
let saveTimeout = null;
let searchTimeout = null;
let dirty = false;
let previewing = false;
let online = navigator.onLine;
let searchQuery = "";
let lastNotes = [];
let sortOrder = localStorage.getItem("webnotes_sort") || "updated";

// === Theme ===
const THEME_KEY = "webnotes_theme";

function getTheme() {
  return localStorage.getItem(THEME_KEY) || "dark";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);

  const darkSheet = document.getElementById("hljs-dark");
  const lightSheet = document.getElementById("hljs-light");
  if (theme === "light") {
    darkSheet.disabled = true;
    lightSheet.disabled = false;
  } else {
    darkSheet.disabled = false;
    lightSheet.disabled = true;
  }

  themeIcon.textContent = theme === "dark" ? "\u2600" : "\u263E";
  btnTheme.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");

  if (previewing) updatePreview();
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

// === Offline queue (localStorage-backed) ===
const QUEUE_KEY = "webnotes_pending";
const CACHE_KEY = "webnotes_cache";

function getPendingQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
  catch { return []; }
}
function setPendingQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}
function getCachedNotes() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; }
  catch { return []; }
}
function setCachedNotes(notes) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(notes));
}

function enqueue(entry) {
  const q = getPendingQueue();
  if (entry.type === "save") {
    const idx = q.findIndex((e) => e.type === "save" && e.noteId === entry.noteId);
    if (idx !== -1) q.splice(idx, 1);
  }
  q.push(entry);
  setPendingQueue(q);
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    while (true) {
      const q = getPendingQueue();
      if (!q.length) break;
      const entry = q[0];
      try {
        if (entry.type === "save") {
          await apiRaw("/notes/" + entry.noteId, {
            method: "PUT",
            body: JSON.stringify(entry.data),
          });
        } else if (entry.type === "delete") {
          await apiRaw("/notes/" + entry.noteId, { method: "DELETE" });
        } else if (entry.type === "create") {
          const created = await apiRaw("/notes", {
            method: "POST",
            body: JSON.stringify(entry.data),
          });
          if (created) {
            const tempId = entry.tempId;
            const realId = created.id;
            if (currentNoteId === tempId) {
              currentNoteId = realId;
            }
            for (let i = 1; i < q.length; i++) {
              if (q[i].noteId === tempId) {
                q[i].noteId = realId;
              }
            }
          }
        }
        q.shift();
        setPendingQueue(q);
      } catch {
        break;
      }
    }
    if (!getPendingQueue().length) {
      loadNotes();
    }
  } finally {
    flushing = false;
  }
}

// === Connection status ===
function setOnline(value) {
  online = value;
  offlineBanner.classList.toggle("hidden", online);
  if (online) flushQueue();
}

window.addEventListener("online", () => setOnline(true));
window.addEventListener("offline", () => setOnline(false));

// === API helpers ===
async function apiRaw(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }
  return res.json();
}

async function api(path, opts = {}) {
  try {
    const result = await apiRaw(path, opts);
    if (!online) setOnline(true);
    return result;
  } catch (err) {
    if (err instanceof TypeError) {
      setOnline(false);
    }
    throw err;
  }
}

// === Search ===
function filterNotesLocal(notes) {
  if (!searchQuery) return notes;
  const q = searchQuery.toLowerCase();
  return notes.filter(
    (n) =>
      (n.title && n.title.toLowerCase().includes(q)) ||
      (n.content && n.content.toLowerCase().includes(q)) ||
      (n.language && n.language.toLowerCase().includes(q))
  );
}

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  renderNoteList(lastNotes);
  clearTimeout(searchTimeout);
  if (online && searchQuery) {
    searchTimeout = setTimeout(serverSearch, 300);
  }
});

async function serverSearch() {
  if (!searchQuery) return;
  try {
    const notes = await api("/notes?q=" + encodeURIComponent(searchQuery));
    if (searchQuery === searchInput.value.trim()) {
      lastNotes = notes;
      renderNoteList(notes);
    }
  } catch {
    // Fall back to local filter
  }
}

// === Sort ===
function sortNotes(notes) {
  const sorted = [...notes];
  // Pinned always first
  sorted.sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    switch (sortOrder) {
      case "created":
        return new Date(b.created_at) - new Date(a.created_at);
      case "title":
        return (a.title || "").localeCompare(b.title || "");
      case "title-desc":
        return (b.title || "").localeCompare(a.title || "");
      default: // "updated"
        return new Date(b.updated_at) - new Date(a.updated_at);
    }
  });
  return sorted;
}

sortSelect.value = sortOrder;
sortSelect.addEventListener("change", () => {
  sortOrder = sortSelect.value;
  localStorage.setItem("webnotes_sort", sortOrder);
  renderNoteList(lastNotes);
});

// === Notebooks ===
let notebooks = [];

async function loadNotebooks() {
  try {
    notebooks = await api("/notebooks");
  } catch {
    notebooks = [];
  }
  renderNotebookTabs();
  updateNotebookDatalist();
}

function renderNotebookTabs() {
  // Keep "All" and "Unfiled" buttons, remove dynamic tabs
  const existing = notebookBar.querySelectorAll(".nb-tab-dynamic");
  existing.forEach((el) => el.remove());

  notebooks.forEach((nb) => {
    const btn = document.createElement("button");
    btn.className = "nb-tab nb-tab-dynamic";
    btn.textContent = nb.notebook + " (" + nb.count + ")";
    btn.setAttribute("aria-pressed", currentNotebook === nb.notebook ? "true" : "false");
    if (currentNotebook === nb.notebook) btn.classList.add("active");
    btn.onclick = () => selectNotebook(nb.notebook);
    notebookBar.appendChild(btn);
  });

  // Update All/Unfiled active state
  document.getElementById("nb-all").classList.toggle("active", currentNotebook === null);
  document.getElementById("nb-all").setAttribute("aria-pressed", String(currentNotebook === null));
  document.getElementById("nb-uncategorized").classList.toggle("active", currentNotebook === "");
  document.getElementById("nb-uncategorized").setAttribute("aria-pressed", String(currentNotebook === ""));
}

function updateNotebookDatalist() {
  notebookList.innerHTML = "";
  notebooks.forEach((nb) => {
    const opt = document.createElement("option");
    opt.value = nb.notebook;
    notebookList.appendChild(opt);
  });
}

function selectNotebook(nb) {
  currentNotebook = nb;
  renderNotebookTabs();
  loadNotes();
}

document.getElementById("nb-all").addEventListener("click", () => selectNotebook(null));
document.getElementById("nb-uncategorized").addEventListener("click", () => selectNotebook(""));

// === Note list ===
async function loadNotes() {
  try {
    let path = "/notes";
    const params = [];
    if (searchQuery) params.push("q=" + encodeURIComponent(searchQuery));
    if (currentNotebook !== null) params.push("notebook=" + encodeURIComponent(currentNotebook));
    if (params.length) path += "?" + params.join("&");
    const notes = await api(path);
    setCachedNotes(notes);
    lastNotes = notes;
    renderNoteList(notes);
  } catch {
    lastNotes = getCachedNotes();
    renderNoteList(lastNotes);
  }
}

function renderNoteList(notes) {
  const filtered = searchQuery && online ? notes : filterNotesLocal(notes);
  const sorted = sortNotes(filtered);
  noteList.innerHTML = "";
  if (!sorted.length) {
    const p = document.createElement("li");
    p.className = "note-list-empty";
    p.setAttribute("role", "presentation");
    p.textContent = searchQuery ? "No matching notes" : "No notes yet";
    noteList.appendChild(p);
    return;
  }
  sorted.forEach((n) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-selected", n.id === currentNoteId ? "true" : "false");
    if (n.id === currentNoteId) li.classList.add("active");
    const date = new Date(n.updated_at).toLocaleDateString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const pinIcon = n.pinned ? '<span class="pin-icon" aria-label="Pinned">&#x1F4CC;</span> ' : "";
    const nbLabel = n.notebook ? ' &middot; <span class="note-item-nb">' + escapeHtml(n.notebook) + '</span>' : "";
    li.innerHTML = `
      <span class="note-item-title">${pinIcon}${escapeHtml(n.title)}</span>
      <span class="note-item-meta">${escapeHtml(n.language)} &middot; ${date}${nbLabel}</span>
    `;
    li.onclick = () => openNote(n.id);
    li.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openNote(n.id);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = li.nextElementSibling;
        if (next && next.getAttribute("role") === "option") next.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = li.previousElementSibling;
        if (prev && prev.getAttribute("role") === "option") prev.focus();
      }
    };
    noteList.appendChild(li);
  });
}

// === Open / Create / Save / Delete ===
async function openNote(id) {
  try {
    const note = await api("/notes/" + id);
    currentNoteId = note.id;
    currentNotePinned = note.pinned || false;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    notebookInput.value = note.notebook || "";
    showEditor();
    updatePinButton();
    updateStats();
    if (note.content) togglePreview();
    loadNotes();
  } catch {
    const cached = getCachedNotes().find((n) => n.id === id);
    if (cached) {
      currentNoteId = cached.id;
      currentNotePinned = cached.pinned || false;
      titleInput.value = cached.title;
      langSelect.value = cached.language || "plaintext";
      contentArea.value = cached.content || "";
      notebookInput.value = cached.notebook || "";
      showEditor();
      updatePinButton();
      updateStats();
      if (cached.content) togglePreview();
      renderNoteList(getCachedNotes());
    }
  }
}

async function createNote() {
  try {
    const nb = currentNotebook && currentNotebook !== "" ? currentNotebook : "";
    const note = await api("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Untitled", content: "", language: "plaintext", notebook: nb }),
    });
    currentNoteId = note.id;
    currentNotePinned = false;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    notebookInput.value = note.notebook || "";
    showEditor();
    updatePinButton();
    updateStats();
    titleInput.focus();
    titleInput.select();
    await loadNotes();
    loadNotebooks();
  } catch {
    const nb = currentNotebook && currentNotebook !== "" ? currentNotebook : "";
    const tempId = "temp_" + Date.now();
    const tempNote = {
      id: tempId,
      title: "Untitled",
      content: "",
      language: "plaintext",
      pinned: false,
      notebook: nb,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    enqueue({ type: "create", tempId, data: { title: "Untitled", content: "", language: "plaintext", notebook: nb } });
    const cached = getCachedNotes();
    cached.unshift(tempNote);
    setCachedNotes(cached);
    currentNoteId = tempId;
    currentNotePinned = false;
    titleInput.value = tempNote.title;
    langSelect.value = tempNote.language;
    contentArea.value = tempNote.content;
    notebookInput.value = nb;
    showEditor();
    updatePinButton();
    updateStats();
    titleInput.focus();
    titleInput.select();
    lastNotes = getCachedNotes();
    renderNoteList(lastNotes);
  }
}

async function createNoteFromFile(filename, content, language) {
  try {
    const note = await api("/notes", {
      method: "POST",
      body: JSON.stringify({ title: filename, content, language, notebook: currentNotebook && currentNotebook !== "" ? currentNotebook : "" }),
    });
    currentNoteId = note.id;
    currentNotePinned = false;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    notebookInput.value = note.notebook || "";
    showEditor();
    updatePinButton();
    updateStats();
    if (note.content) togglePreview();
    await loadNotes();
    loadNotebooks();
  } catch {
    const nb = currentNotebook && currentNotebook !== "" ? currentNotebook : "";
    const tempId = "temp_" + Date.now();
    const tempNote = {
      id: tempId,
      title: filename,
      content,
      language,
      pinned: false,
      notebook: nb,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    enqueue({ type: "create", tempId, data: { title: filename, content, language, notebook: nb } });
    const cached = getCachedNotes();
    cached.unshift(tempNote);
    setCachedNotes(cached);
    currentNoteId = tempId;
    currentNotePinned = false;
    titleInput.value = tempNote.title;
    langSelect.value = tempNote.language;
    contentArea.value = tempNote.content;
    notebookInput.value = nb;
    showEditor();
    updatePinButton();
    updateStats();
    if (content) togglePreview();
    lastNotes = getCachedNotes();
    renderNoteList(lastNotes);
  }
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNote, 600);
}

async function saveNote() {
  if (!currentNoteId) return;
  const data = {
    title: titleInput.value || "Untitled",
    content: contentArea.value,
    language: langSelect.value,
    notebook: notebookInput.value.trim(),
  };
  try {
    await api("/notes/" + currentNoteId, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    dirty = false;
    flashSaved();
    loadNotes();
  } catch {
    enqueue({ type: "save", noteId: currentNoteId, data });
    const cached = getCachedNotes();
    const idx = cached.findIndex((n) => n.id === currentNoteId);
    if (idx !== -1) {
      Object.assign(cached[idx], data, { updated_at: new Date().toISOString() });
      setCachedNotes(cached);
    }
    dirty = false;
    flashSaved("Saved locally");
    lastNotes = getCachedNotes();
    renderNoteList(lastNotes);
  }
}

async function togglePin() {
  if (!currentNoteId) return;
  currentNotePinned = !currentNotePinned;
  updatePinButton();
  try {
    await api("/notes/" + currentNoteId, {
      method: "PUT",
      body: JSON.stringify({ pinned: currentNotePinned }),
    });
    loadNotes();
  } catch {
    enqueue({ type: "save", noteId: currentNoteId, data: { pinned: currentNotePinned } });
    const cached = getCachedNotes();
    const idx = cached.findIndex((n) => n.id === currentNoteId);
    if (idx !== -1) {
      cached[idx].pinned = currentNotePinned;
      setCachedNotes(cached);
    }
    lastNotes = getCachedNotes();
    renderNoteList(lastNotes);
  }
}

function updatePinButton() {
  btnPin.classList.toggle("active", currentNotePinned);
  btnPin.setAttribute("aria-pressed", String(currentNotePinned));
  btnPin.title = currentNotePinned ? "Unpin note" : "Pin note";
}

async function deleteNote() {
  if (!currentNoteId) return;
  if (!confirm("Delete \"" + (titleInput.value || "Untitled") + "\"?")) return;
  try {
    await api("/notes/" + currentNoteId, { method: "DELETE" });
  } catch {
    enqueue({ type: "delete", noteId: currentNoteId });
    const cached = getCachedNotes().filter((n) => n.id !== currentNoteId);
    setCachedNotes(cached);
  }
  currentNoteId = null;
  hideEditor();
  loadNotes();
  btnNew.focus();
}

// === Copy to clipboard ===
async function copyToClipboard() {
  if (!contentArea.value) return;
  try {
    await navigator.clipboard.writeText(contentArea.value);
    flashSaved("Copied!");
  } catch {
    contentArea.select();
    document.execCommand("copy");
    flashSaved("Copied!");
  }
}

// === Export / download note ===
const LANG_TO_EXT = {
  javascript: "js", typescript: "ts", python: "py", java: "java",
  c: "c", cpp: "cpp", csharp: "cs", go: "go", rust: "rs", ruby: "rb",
  php: "php", sql: "sql", bash: "sh", html: "html", css: "css",
  json: "json", yaml: "yml", xml: "xml", markdown: "md",
  ini: "ini", nginx: "conf", properties: "properties",
  dockerfile: "Dockerfile", plaintext: "txt",
};

function exportNote() {
  if (!currentNoteId || !contentArea.value) return;
  const lang = langSelect.value === "auto" ? "plaintext" : langSelect.value;
  const ext = LANG_TO_EXT[lang] || "txt";
  const title = titleInput.value || "Untitled";
  const filename = lang === "dockerfile" ? "Dockerfile" : title.replace(/[^a-zA-Z0-9_\-. ]/g, "_") + "." + ext;
  const blob = new Blob([contentArea.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  flashSaved("Downloaded!");
}

// === Word / char / line count ===
function updateStats() {
  const text = contentArea.value;
  const chars = text.length;
  const lines = text ? text.split("\n").length : 0;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  statusStats.textContent = `${lines} lines \u00B7 ${words} words \u00B7 ${chars} chars`;
}

// === Lightweight Markdown renderer ===
function renderMarkdown(src) {
  // Sanitize HTML entities first
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const lines = src.split("\n");
  const out = [];
  let i = 0;
  let inList = false;
  let listType = "";

  function closeList() {
    if (inList) {
      out.push(listType === "ol" ? "</ol>" : "</ul>");
      inList = false;
    }
  }

  function inline(text) {
    // Sanitize URLs — only allow http(s) and relative paths
    function safeUrl(url) {
      const decoded = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
      if (/^https?:\/\//i.test(decoded) || /^[/#.]/.test(decoded)) return url;
      return "";
    }
    // Images before links
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      const safe = safeUrl(url);
      return safe ? '<img src="' + safe + '" alt="' + alt + '" style="max-width:100%">' : alt;
    });
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = safeUrl(url);
      return safe ? '<a href="' + safe + '" rel="noopener">' + label + '</a>' : label;
    });
    // Bold + italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    text = text.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
    // Italic
    text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
    text = text.replace(/_(.+?)_/g, "<em>$1</em>");
    // Strikethrough
    text = text.replace(/~~(.+?)~~/g, "<del>$1</del>");
    // Inline code
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    return text;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      closeList();
      const lang = fenceMatch[1];
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(esc(lines[i]));
        i++;
      }
      i++; // skip closing ```
      let codeHtml = codeLines.join("\n");
      if (lang && typeof hljs !== "undefined") {
        try {
          codeHtml = hljs.highlight(codeHtml, { language: lang }).value;
        } catch { /* ignore unknown language */ }
      }
      out.push('<pre><code class="' + (lang ? "language-" + esc(lang) : "") + '">' + codeHtml + "</code></pre>");
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push("<h" + level + ">" + inline(esc(headingMatch[2])) + "</h" + level + ">");
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      closeList();
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].substring(2));
        i++;
      }
      out.push("<blockquote>" + inline(esc(quoteLines.join("\n"))) + "</blockquote>");
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[\-\*\+]\s+(.+)/);
    if (ulMatch) {
      if (!inList || listType !== "ul") {
        closeList();
        out.push("<ul>");
        inList = true;
        listType = "ul";
      }
      out.push("<li>" + inline(esc(ulMatch[1])) + "</li>");
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      if (!inList || listType !== "ol") {
        closeList();
        out.push("<ol>");
        inList = true;
        listType = "ol";
      }
      out.push("<li>" + inline(esc(olMatch[1])) + "</li>");
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Paragraph
    closeList();
    out.push("<p>" + inline(esc(line)) + "</p>");
    i++;
  }

  closeList();
  return out.join("\n");
}

// === Preview with line numbers ===
function isMarkdownMode() {
  return langSelect.value === "markdown";
}

function togglePreview() {
  previewing = !previewing;
  btnPreview.classList.toggle("active", previewing);
  btnPreview.setAttribute("aria-pressed", String(previewing));
  contentArea.classList.toggle("hidden", previewing);
  if (isMarkdownMode()) {
    previewEl.classList.add("hidden");
    mdPreviewEl.classList.toggle("hidden", !previewing);
  } else {
    mdPreviewEl.classList.add("hidden");
    previewEl.classList.toggle("hidden", !previewing);
  }
  if (previewing) updatePreview();
}

function updatePreview() {
  if (!previewing) return;

  if (isMarkdownMode()) {
    previewEl.classList.add("hidden");
    mdPreviewEl.classList.remove("hidden");
    mdPreviewEl.innerHTML = renderMarkdown(contentArea.value);
    return;
  }

  mdPreviewEl.classList.add("hidden");
  previewEl.classList.remove("hidden");

  const code = previewEl.querySelector("code");
  code.textContent = contentArea.value;
  code.className = "";
  previewEl.classList.remove("line-numbers");

  const lang = langSelect.value;
  if (typeof hljs !== "undefined") {
    if (lang === "auto") {
      const result = hljs.highlightAuto(contentArea.value);
      code.innerHTML = result.value;
    } else if (lang !== "plaintext") {
      code.classList.add("language-" + lang);
      hljs.highlightElement(code);
    }
  }

  addLineNumbers(code);
  previewEl.classList.add("line-numbers");
}

function addLineNumbers(codeEl) {
  const html = codeEl.innerHTML;
  const lines = html.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  codeEl.innerHTML = lines
    .map((line) => `<span class="line">${line || " "}</span>`)
    .join("");
}

// === Drag & drop file import ===
const EXT_TO_LANG = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", pyw: "python",
  java: "java", kt: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  sql: "sql",
  sh: "bash", bash: "bash", zsh: "bash",
  html: "html", htm: "html",
  css: "css", scss: "css", less: "css",
  json: "json",
  yaml: "yaml", yml: "yaml",
  xml: "xml", svg: "xml",
  md: "markdown", markdown: "markdown",
  ini: "ini", conf: "ini", cfg: "ini", toml: "ini",
  dockerfile: "dockerfile",
  properties: "properties",
};

function detectLanguage(filename) {
  const name = filename.toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "nginx.conf" || name.endsWith(".nginx")) return "nginx";
  const ext = name.split(".").pop();
  return EXT_TO_LANG[ext] || "plaintext";
}

function handleFileDrop(file) {
  if (file.size > 5 * 1024 * 1024) {
    alert("File too large (max 5 MB)");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const lang = detectLanguage(file.name);
    createNoteFromFile(file.name, reader.result, lang);
  };
  reader.onerror = () => {
    alert("Could not read file");
  };
  reader.readAsText(file);
}

function setupDragDrop(el) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", () => {
    el.classList.remove("drag-over");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => handleFileDrop(file));
  });
}

// === UI helpers ===
function showEditor() {
  dirty = false;
  editorArea.classList.remove("hidden");
  emptyState.classList.add("hidden");
  previewing = false;
  btnPreview.classList.remove("active");
  btnPreview.setAttribute("aria-pressed", "false");
  contentArea.classList.remove("hidden");
  previewEl.classList.add("hidden");
  mdPreviewEl.classList.add("hidden");
}

function hideEditor() {
  editorArea.classList.add("hidden");
  emptyState.classList.remove("hidden");
}

function flashSaved(text) {
  saveIndicator.textContent = text || "Saved";
  saveIndicator.classList.add("show");
  setTimeout(() => saveIndicator.classList.remove("show"), 1500);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Handle tab key in textarea (Escape releases the tab trap)
let tabTrapped = true;
contentArea.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    tabTrapped = false;
    return;
  }
  if (e.key === "Tab" && tabTrapped) {
    e.preventDefault();
    const start = contentArea.selectionStart;
    const end = contentArea.selectionEnd;
    contentArea.value =
      contentArea.value.substring(0, start) + "  " + contentArea.value.substring(end);
    contentArea.selectionStart = contentArea.selectionEnd = start + 2;
    scheduleSave();
  }
});
contentArea.addEventListener("focus", () => { tabTrapped = true; });

// === Keyboard shortcuts ===
document.addEventListener("keydown", (e) => {
  if (e.altKey && e.key === "n") {
    e.preventDefault();
    createNote();
    return;
  }

  if (e.altKey && e.key === "s") {
    e.preventDefault();
    clearTimeout(saveTimeout);
    saveNote();
    return;
  }

  if (e.altKey && e.key === "p") {
    e.preventDefault();
    if (currentNoteId) togglePreview();
    return;
  }

  if (e.altKey && e.key === "c") {
    e.preventDefault();
    if (currentNoteId) copyToClipboard();
    return;
  }

  if (e.key === "Escape") {
    if (searchQuery) {
      searchInput.value = "";
      searchQuery = "";
      loadNotes();
      return;
    }
    if (currentNoteId) {
      clearTimeout(saveTimeout);
      saveNote().then(() => {
        currentNoteId = null;
        hideEditor();
        renderNoteList(lastNotes);
      });
    }
    return;
  }

  if (e.altKey && e.key === "d") {
    e.preventDefault();
    if (currentNoteId) exportNote();
    return;
  }

  if (e.altKey && e.key === "f") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

// === File upload via input ===
const fileInput = document.getElementById("file-input");
const btnUpload = document.getElementById("btn-upload");
btnUpload.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  Array.from(fileInput.files).forEach((file) => handleFileDrop(file));
  fileInput.value = "";
});

// === Events ===
btnNew.addEventListener("click", createNote);
btnDelete.addEventListener("click", deleteNote);
btnPreview.addEventListener("click", togglePreview);
btnCopy.addEventListener("click", copyToClipboard);
btnExport.addEventListener("click", exportNote);
btnPin.addEventListener("click", togglePin);
btnTheme.addEventListener("click", toggleTheme);
titleInput.addEventListener("input", scheduleSave);
contentArea.addEventListener("input", () => {
  scheduleSave();
  updateStats();
});
langSelect.addEventListener("change", () => {
  scheduleSave();
  updatePreview();
});
notebookInput.addEventListener("change", () => {
  scheduleSave();
  loadNotebooks();
});

// === Unsaved changes warning ===
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// === Init ===
setTheme(getTheme());
setOnline(navigator.onLine);
loadNotes();
loadNotebooks();
flushQueue();
setupDragDrop(dropZone);
setupDragDrop(contentArea);
