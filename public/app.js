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
const btnHistory = document.getElementById("btn-history");
const themeIcon = document.getElementById("theme-icon");
const saveIndicator = document.querySelector(".save-indicator");
const offlineBanner = document.getElementById("offline-banner");
const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const statusStats = document.getElementById("status-stats");
const statusTimestamps = document.getElementById("status-timestamps");
const dropZone = document.getElementById("drop-zone");
const notebookInput = document.getElementById("note-notebook");
const notebookSuggestions = document.getElementById("notebook-suggestions");
const notebookBar = document.getElementById("notebook-bar");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const resizeHandle = document.getElementById("resize-handle");
const versionPanel = document.getElementById("version-panel");
const versionListEl = document.getElementById("version-list");
const versionDiff = document.getElementById("version-diff");
const versionContent = document.getElementById("version-content");
const versionDiffDate = document.getElementById("version-diff-date");
const bulkBar = document.getElementById("bulk-bar");
const bulkCountEl = document.getElementById("bulk-count");
const bulkSelectAll = document.getElementById("bulk-select-all");

let currentNoteId = null;
let currentNotePinned = false;
let currentNoteCreatedAt = null;
let currentNoteUpdatedAt = null;
let currentNotebook = null; // null = all, "" = unfiled, "name" = specific
let saveTimeout = null;
let searchTimeout = null;
let dirty = false;
let previewing = false;
let online = navigator.onLine;
let searchQuery = "";
let lastNotes = [];
let sortOrder = localStorage.getItem("webnotes_sort") || "updated";
let bulkMode = false;
let selectedIds = new Set();
let currentVersions = [];
let selectedVersionIdx = -1;

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
  const headers = opts.body ? { "Content-Type": "application/json", ...opts.headers } : { ...opts.headers };
  const res = await fetch("/api" + path, {
    ...opts,
    headers,
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
  } else if (!searchQuery) {
    loadNotes();
  }
});

async function serverSearch() {
  if (!searchQuery) return;
  try {
    const params = ["q=" + encodeURIComponent(searchQuery)];
    if (currentNotebook !== null) params.push("notebook=" + encodeURIComponent(currentNotebook));
    const notes = await api("/notes?" + params.join("&"));
    if (searchQuery === searchInput.value.trim()) {
      lastNotes = notes;
      renderNoteList(notes);
    }
  } catch {
    // Fall back to local filter
  }
}

// === Search highlight ===
function highlightText(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(" + q + ")", "gi");
  return escaped.replace(re, '<span class="search-hl">$1</span>');
}

function contentSnippet(content, query) {
  if (!query || !content) return "";
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(q, "i");
  const idx = content.search(re);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + query.length + 60);
  let snippet = (start > 0 ? "…" : "") + content.slice(start, end).replace(/\n/g, " ") + (end < content.length ? "…" : "");
  return highlightText(snippet, query);
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
  updateNotebookSuggestions();
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
    btn.oncontextmenu = (e) => showNotebookContextMenu(e, nb.notebook);
    notebookBar.appendChild(btn);
  });

  // Update All/Unfiled active state
  document.getElementById("nb-all").classList.toggle("active", currentNotebook === null);
  document.getElementById("nb-all").setAttribute("aria-pressed", String(currentNotebook === null));
  document.getElementById("nb-uncategorized").classList.toggle("active", currentNotebook === "");
  document.getElementById("nb-uncategorized").setAttribute("aria-pressed", String(currentNotebook === ""));
}

// === Notebook context menu (rename/delete) ===
function showNotebookContextMenu(e, nbName) {
  e.preventDefault();
  closeNotebookContextMenu();
  const menu = document.createElement("div");
  menu.className = "nb-ctx-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  const renameBtn = document.createElement("button");
  renameBtn.textContent = "Rename";
  renameBtn.onclick = () => {
    closeNotebookContextMenu();
    const newName = prompt("Rename notebook \"" + nbName + "\" to:", nbName);
    if (newName && newName.trim() && newName.trim() !== nbName) {
      api("/notebooks/" + encodeURIComponent(nbName), {
        method: "PUT",
        body: JSON.stringify({ newName: newName.trim() }),
      }).then(() => {
        if (currentNotebook === nbName) currentNotebook = newName.trim();
        loadNotebooks();
        loadNotes();
      }).catch(() => alert("Failed to rename notebook"));
    }
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "danger";
  deleteBtn.textContent = "Delete notebook";
  deleteBtn.onclick = () => {
    closeNotebookContextMenu();
    if (!confirm("Delete notebook \"" + nbName + "\"? Notes will be moved to Unfiled.")) return;
    api("/notebooks/" + encodeURIComponent(nbName), { method: "DELETE" }).then(() => {
      if (currentNotebook === nbName) currentNotebook = null;
      loadNotebooks();
      loadNotes();
    }).catch(() => alert("Failed to delete notebook"));
  };

  menu.appendChild(renameBtn);
  menu.appendChild(deleteBtn);
  document.body.appendChild(menu);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener("click", closeNotebookContextMenu, { once: true });
  }, 0);
}

function closeNotebookContextMenu() {
  const existing = document.querySelector(".nb-ctx-menu");
  if (existing) existing.remove();
}

function updateNotebookSuggestions() {
  const val = notebookInput.value.trim().toLowerCase();
  const matches = notebooks.filter((nb) => nb.notebook.toLowerCase().includes(val));
  notebookSuggestions.innerHTML = "";
  if (!matches.length) {
    notebookSuggestions.classList.add("hidden");
    return;
  }
  matches.forEach((nb) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.textContent = nb.notebook;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      notebookInput.value = nb.notebook;
      notebookSuggestions.classList.add("hidden");
      notebookInput.dispatchEvent(new Event("change"));
    });
    notebookSuggestions.appendChild(li);
  });
}

function selectNotebook(nb) {
  currentNotebook = nb;
  renderNotebookTabs();
  loadNotes();
}

document.getElementById("nb-all").addEventListener("click", () => selectNotebook(null));
document.getElementById("nb-uncategorized").addEventListener("click", () => selectNotebook(""));

// === Bulk operations ===
function enterBulkMode() {
  bulkMode = true;
  selectedIds.clear();
  bulkBar.classList.remove("hidden");
  noteList.classList.add("bulk-mode");
  bulkSelectAll.checked = false;
  updateBulkCount();
  renderNoteList(lastNotes);
}

function exitBulkMode() {
  bulkMode = false;
  selectedIds.clear();
  bulkBar.classList.add("hidden");
  noteList.classList.remove("bulk-mode");
  renderNoteList(lastNotes);
}

function updateBulkCount() {
  bulkCountEl.textContent = selectedIds.size + " selected";
}

function toggleBulkSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  updateBulkCount();
}

bulkSelectAll.addEventListener("change", () => {
  const filtered = searchQuery && online ? lastNotes : filterNotesLocal(lastNotes);
  const sorted = sortNotes(filtered);
  if (bulkSelectAll.checked) {
    sorted.forEach((n) => selectedIds.add(n.id));
  } else {
    selectedIds.clear();
  }
  updateBulkCount();
  renderNoteList(lastNotes);
});

document.getElementById("bulk-cancel").addEventListener("click", exitBulkMode);

document.getElementById("bulk-delete").addEventListener("click", async () => {
  if (!selectedIds.size) return;
  if (!confirm("Delete " + selectedIds.size + " note(s)?")) return;
  try {
    await api("/notes/bulk", {
      method: "POST",
      body: JSON.stringify({ action: "delete", ids: Array.from(selectedIds) }),
    });
  } catch {
    // Offline — queue individual deletes
    let cached = getCachedNotes();
    selectedIds.forEach((id) => {
      enqueue({ type: "delete", noteId: id });
      cached = cached.filter((n) => n.id !== id);
    });
    setCachedNotes(cached);
  }
  if (selectedIds.has(currentNoteId)) {
    currentNoteId = null;
    hideEditor();
  }
  exitBulkMode();
  loadNotes();
  loadNotebooks();
});

document.getElementById("bulk-move").addEventListener("click", async () => {
  if (!selectedIds.size) return;
  const nbName = prompt("Move " + selectedIds.size + " note(s) to notebook (leave empty for Unfiled):", "");
  if (nbName === null) return;
  try {
    await api("/notes/bulk", {
      method: "POST",
      body: JSON.stringify({ action: "move", ids: Array.from(selectedIds), notebook: nbName.trim() }),
    });
  } catch {
    alert("Failed to move notes");
  }
  exitBulkMode();
  loadNotes();
  loadNotebooks();
});

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

    // Search highlight
    const titleHtml = searchQuery ? highlightText(n.title, searchQuery) : escapeHtml(n.title);
    const snippetHtml = searchQuery ? contentSnippet(n.content, searchQuery) : "";

    li.innerHTML = `
      <span class="note-item-title">${pinIcon}${titleHtml}</span>
      ${snippetHtml ? '<span class="note-item-snippet">' + snippetHtml + '</span>' : ''}
      <span class="note-item-meta">${escapeHtml(n.language)} &middot; ${date}${nbLabel}</span>
    `;

    // Unfile button when viewing a specific notebook
    if (currentNotebook && n.notebook && !bulkMode) {
      const unfile = document.createElement("button");
      unfile.className = "btn-unfile";
      unfile.title = "Remove from notebook";
      unfile.setAttribute("aria-label", "Remove from notebook");
      unfile.textContent = "\u00D7";
      unfile.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await api("/notes/" + n.id, {
            method: "PUT",
            body: JSON.stringify({ notebook: "" }),
          });
        } catch {
          enqueue({ type: "update", noteId: n.id, data: { notebook: "" } });
        }
        if (n.id === currentNoteId) {
          notebookInput.value = "";
        }
        loadNotes();
        loadNotebooks();
      });
      li.appendChild(unfile);
    }

    if (bulkMode) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "bulk-cb";
      cb.checked = selectedIds.has(n.id);
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        toggleBulkSelect(n.id);
      });
      li.prepend(cb);
      li.onclick = (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        toggleBulkSelect(n.id);
      };
    } else {
      li.onclick = () => {
        openNote(n.id);
        closeSidebar();
      };
      // Long-press to enter bulk mode on mobile
      let longPressTimer;
      li.addEventListener("pointerdown", (e) => {
        if (bulkMode || e.button !== 0) return;
        longPressTimer = setTimeout(() => {
          enterBulkMode();
          selectedIds.add(n.id);
          updateBulkCount();
          renderNoteList(lastNotes);
        }, 500);
      });
      li.addEventListener("pointerup", () => clearTimeout(longPressTimer));
      li.addEventListener("pointerleave", () => clearTimeout(longPressTimer));
    }
    li.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (bulkMode) {
          toggleBulkSelect(n.id);
          renderNoteList(lastNotes);
        } else {
          openNote(n.id);
          closeSidebar();
        }
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
    currentNoteCreatedAt = note.created_at;
    currentNoteUpdatedAt = note.updated_at;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    notebookInput.value = note.notebook || "";
    showEditor();
    updatePinButton();
    updateStats();
    updateTimestamps();
    if (note.content && !previewing) togglePreview();
    loadNotes();
  } catch {
    const cached = getCachedNotes().find((n) => n.id === id);
    if (cached) {
      currentNoteId = cached.id;
      currentNotePinned = cached.pinned || false;
      currentNoteCreatedAt = cached.created_at;
      currentNoteUpdatedAt = cached.updated_at;
      titleInput.value = cached.title;
      langSelect.value = cached.language || "plaintext";
      contentArea.value = cached.content || "";
      notebookInput.value = cached.notebook || "";
      showEditor();
      updatePinButton();
      updateStats();
      updateTimestamps();
      if (cached.content && !previewing) togglePreview();
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
    currentNoteCreatedAt = note.created_at;
    currentNoteUpdatedAt = note.updated_at;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    notebookInput.value = note.notebook || "";
    showEditor();
    updatePinButton();
    updateStats();
    updateTimestamps();
    titleInput.focus();
    titleInput.select();
    await loadNotes();
    loadNotebooks();
    closeSidebar();
  } catch {
    const nb = currentNotebook && currentNotebook !== "" ? currentNotebook : "";
    const tempId = "temp_" + Date.now();
    const now = new Date().toISOString();
    const tempNote = {
      id: tempId,
      title: "Untitled",
      content: "",
      language: "plaintext",
      pinned: false,
      notebook: nb,
      created_at: now,
      updated_at: now,
    };
    enqueue({ type: "create", tempId, data: { title: "Untitled", content: "", language: "plaintext", notebook: nb } });
    const cached = getCachedNotes();
    cached.unshift(tempNote);
    setCachedNotes(cached);
    currentNoteId = tempId;
    currentNotePinned = false;
    currentNoteCreatedAt = now;
    currentNoteUpdatedAt = now;
    titleInput.value = tempNote.title;
    langSelect.value = tempNote.language;
    contentArea.value = tempNote.content;
    notebookInput.value = nb;
    showEditor();
    updatePinButton();
    updateStats();
    updateTimestamps();
    titleInput.focus();
    titleInput.select();
    lastNotes = getCachedNotes();
    renderNoteList(lastNotes);
    closeSidebar();
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
    currentNoteCreatedAt = note.created_at;
    currentNoteUpdatedAt = note.updated_at;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    notebookInput.value = note.notebook || "";
    showEditor();
    updatePinButton();
    updateStats();
    updateTimestamps();
    if (note.content) togglePreview();
    await loadNotes();
    loadNotebooks();
  } catch {
    const nb = currentNotebook && currentNotebook !== "" ? currentNotebook : "";
    const tempId = "temp_" + Date.now();
    const now = new Date().toISOString();
    const tempNote = {
      id: tempId,
      title: filename,
      content,
      language,
      pinned: false,
      notebook: nb,
      created_at: now,
      updated_at: now,
    };
    enqueue({ type: "create", tempId, data: { title: filename, content, language, notebook: nb } });
    const cached = getCachedNotes();
    cached.unshift(tempNote);
    setCachedNotes(cached);
    currentNoteId = tempId;
    currentNotePinned = false;
    currentNoteCreatedAt = now;
    currentNoteUpdatedAt = now;
    titleInput.value = tempNote.title;
    langSelect.value = tempNote.language;
    contentArea.value = tempNote.content;
    notebookInput.value = nb;
    showEditor();
    updatePinButton();
    updateStats();
    updateTimestamps();
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
    const note = await api("/notes/" + currentNoteId, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    dirty = false;
    if (note) {
      currentNoteUpdatedAt = note.updated_at;
      updateTimestamps();
    }
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
    currentNoteUpdatedAt = new Date().toISOString();
    updateTimestamps();
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flashSaved("Downloaded!");
}

// === Word / char / line count + timestamps ===
function updateStats() {
  const text = contentArea.value;
  const chars = text.length;
  const lines = text ? text.split("\n").length : 0;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  statusStats.textContent = `${lines} lines \u00B7 ${words} words \u00B7 ${chars} chars`;
}

function updateTimestamps() {
  if (!currentNoteCreatedAt) {
    statusTimestamps.textContent = "";
    return;
  }
  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };
  const created = fmt(currentNoteCreatedAt);
  const updated = fmt(currentNoteUpdatedAt);
  statusTimestamps.textContent = "Created " + created + " \u00B7 Updated " + updated;
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
      const decoded = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
      if (/^https?:\/\//i.test(decoded)) return url;
      if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/i.test(decoded)) return "";
      if (/^[/#.]/.test(decoded)) return url;
      return "";
    }
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      const safe = safeUrl(url);
      return safe ? '<img src="' + safe + '" alt="' + alt + '" style="max-width:100%">' : alt;
    });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = safeUrl(url);
      return safe ? '<a href="' + safe + '" rel="noopener">' + label + '</a>' : label;
    });
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    text = text.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
    text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
    text = text.replace(/_(.+?)_/g, "<em>$1</em>");
    text = text.replace(/~~(.+?)~~/g, "<del>$1</del>");
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
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const codeRaw = codeLines.join("\n");
      let codeHtml = esc(codeRaw);
      if (lang && typeof hljs !== "undefined" && hljs.getLanguage(lang)) {
        codeHtml = hljs.highlight(codeRaw, { language: lang }).value;
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
    } else if (lang !== "plaintext" && hljs.getLanguage(lang)) {
      code.classList.add("language-" + lang);
      code.innerHTML = hljs.highlight(contentArea.value, { language: lang }).value;
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

// === Version history ===
async function openVersionHistory() {
  if (!currentNoteId) return;
  closeVersionHistory();
  try {
    currentVersions = await api("/notes/" + currentNoteId + "/versions");
  } catch {
    currentVersions = [];
  }
  versionPanel.classList.remove("hidden");
  contentArea.classList.add("hidden");
  previewEl.classList.add("hidden");
  mdPreviewEl.classList.add("hidden");
  versionDiff.classList.add("hidden");
  versionListEl.classList.remove("hidden");

  versionListEl.innerHTML = "";
  if (!currentVersions.length) {
    const li = document.createElement("li");
    li.className = "version-list-empty";
    li.textContent = "No previous versions";
    versionListEl.appendChild(li);
    return;
  }
  currentVersions.forEach((v, idx) => {
    const li = document.createElement("li");
    const date = new Date(v.saved_at).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    li.innerHTML = '<div class="ver-date">' + escapeHtml(date) + '</div>' +
      '<div class="ver-preview">' + escapeHtml((v.content || "").substring(0, 100)) + '</div>';
    li.onclick = () => showVersionDiff(idx);
    versionListEl.appendChild(li);
  });
}

function showVersionDiff(idx) {
  selectedVersionIdx = idx;
  const v = currentVersions[idx];
  versionListEl.classList.add("hidden");
  versionDiff.classList.remove("hidden");
  versionDiffDate.textContent = new Date(v.saved_at).toLocaleString();
  versionContent.textContent = v.content;
}

function closeVersionHistory() {
  versionPanel.classList.add("hidden");
  versionDiff.classList.add("hidden");
  versionListEl.classList.remove("hidden");
  currentVersions = [];
  selectedVersionIdx = -1;
  // Restore correct view
  if (previewing) {
    if (isMarkdownMode()) {
      mdPreviewEl.classList.remove("hidden");
    } else {
      previewEl.classList.remove("hidden");
    }
  } else {
    contentArea.classList.remove("hidden");
  }
}

function restoreVersion() {
  if (selectedVersionIdx < 0 || selectedVersionIdx >= currentVersions.length) return;
  const v = currentVersions[selectedVersionIdx];
  contentArea.value = v.content;
  if (v.title) titleInput.value = v.title;
  if (v.language) langSelect.value = v.language;
  closeVersionHistory();
  scheduleSave();
  updateStats();
  if (previewing) updatePreview();
  flashSaved("Restored!");
}

btnHistory.addEventListener("click", openVersionHistory);
document.getElementById("version-close").addEventListener("click", closeVersionHistory);
document.getElementById("version-diff-close").addEventListener("click", () => {
  versionDiff.classList.add("hidden");
  versionListEl.classList.remove("hidden");
});
document.getElementById("version-restore").addEventListener("click", restoreVersion);

// === Drag & drop file import ===
const EXT_TO_LANG = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", pyw: "python",
  java: "java",
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
  versionPanel.classList.add("hidden");
}

function hideEditor() {
  editorArea.classList.add("hidden");
  emptyState.classList.remove("hidden");
  statusTimestamps.textContent = "";
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

// === Mobile sidebar ===
function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.remove("hidden");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.add("hidden");
}

document.getElementById("btn-hamburger").addEventListener("click", openSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);

// === Resize handle (sidebar width) ===
const SIDEBAR_WIDTH_KEY = "webnotes_sidebar_width";
const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
if (savedWidth && window.innerWidth > 768) {
  sidebar.style.width = savedWidth + "px";
}

resizeHandle.addEventListener("mousedown", (e) => {
  e.preventDefault();
  resizeHandle.classList.add("dragging");
  const startX = e.clientX;
  const startWidth = sidebar.offsetWidth;

  function onMove(e2) {
    const newWidth = Math.max(180, Math.min(startWidth + (e2.clientX - startX), window.innerWidth * 0.5));
    sidebar.style.width = newWidth + "px";
  }

  function onUp() {
    resizeHandle.classList.remove("dragging");
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebar.offsetWidth);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

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

// === Find in note ===
const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findCount = document.getElementById("find-count");
let findMatches = [];
let findIdx = -1;

function openFindBar() {
  findBar.classList.remove("hidden");
  findInput.focus();
  const sel = contentArea.value.substring(contentArea.selectionStart, contentArea.selectionEnd);
  if (sel && sel.length < 200) {
    findInput.value = sel;
  }
  findInput.select();
  runFind();
}

function closeFindBar() {
  findBar.classList.add("hidden");
  findMatches = [];
  findIdx = -1;
  findCount.textContent = "";
  contentArea.focus();
}

function runFind() {
  const q = findInput.value;
  findMatches = [];
  findIdx = -1;
  if (!q) {
    findCount.textContent = "";
    return;
  }
  const text = contentArea.value.toLowerCase();
  const ql = q.toLowerCase();
  let pos = 0;
  while ((pos = text.indexOf(ql, pos)) !== -1) {
    findMatches.push(pos);
    pos += ql.length;
  }
  if (findMatches.length) {
    findIdx = 0;
    // Jump to nearest match from cursor
    const cursor = contentArea.selectionStart;
    for (let i = 0; i < findMatches.length; i++) {
      if (findMatches[i] >= cursor) { findIdx = i; break; }
    }
    selectMatch();
  }
  updateFindCount();
}

function selectMatch() {
  if (findIdx < 0 || !findMatches.length) return;
  const pos = findMatches[findIdx];
  contentArea.focus();
  contentArea.setSelectionRange(pos, pos + findInput.value.length);
  // Scroll textarea to selection — set cursor briefly to scroll, then restore selection
  const len = findInput.value.length;
  contentArea.blur();
  contentArea.setSelectionRange(pos, pos + len);
  contentArea.focus();
}

function updateFindCount() {
  if (!findMatches.length && findInput.value) {
    findCount.textContent = "No results";
  } else if (findMatches.length) {
    findCount.textContent = (findIdx + 1) + " of " + findMatches.length;
  } else {
    findCount.textContent = "";
  }
}

function findNext() {
  if (!findMatches.length) return;
  findIdx = (findIdx + 1) % findMatches.length;
  selectMatch();
  updateFindCount();
}

function findPrev() {
  if (!findMatches.length) return;
  findIdx = (findIdx - 1 + findMatches.length) % findMatches.length;
  selectMatch();
  updateFindCount();
}

findInput.addEventListener("input", runFind);
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) findPrev(); else findNext();
  }
  if (e.key === "Escape") {
    e.preventDefault();
    closeFindBar();
  }
});
document.getElementById("find-next").addEventListener("click", findNext);
document.getElementById("find-prev").addEventListener("click", findPrev);
document.getElementById("find-close").addEventListener("click", closeFindBar);

// === Keyboard shortcuts ===
document.addEventListener("keydown", (e) => {
  // Ctrl+F opens find bar when a note is open
  if ((e.ctrlKey || e.metaKey) && e.key === "f" && currentNoteId && !editorArea.classList.contains("hidden")) {
    e.preventDefault();
    openFindBar();
    return;
  }

  // Ctrl+A selects note content when a note is open and focus is not in an input
  if ((e.ctrlKey || e.metaKey) && e.key === "a" && currentNoteId && !editorArea.classList.contains("hidden")) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag !== "TEXTAREA" && tag !== "INPUT") {
      e.preventDefault();
      if (previewing) {
        const target = !mdPreviewEl.classList.contains("hidden") ? mdPreviewEl : previewEl;
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        contentArea.focus();
        contentArea.select();
      }
      return;
    }
  }

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
    if (!findBar.classList.contains("hidden")) {
      closeFindBar();
      return;
    }
    if (!versionPanel.classList.contains("hidden")) {
      const diffView = document.getElementById("version-diff");
      if (!diffView.classList.contains("hidden")) {
        diffView.classList.add("hidden");
      } else {
        versionPanel.classList.add("hidden");
      }
      return;
    }
    if (bulkMode) {
      exitBulkMode();
      return;
    }
    if (searchQuery) {
      searchInput.value = "";
      searchQuery = "";
      loadNotes();
      return;
    }
    // Close sidebar on mobile
    if (sidebar.classList.contains("open")) {
      closeSidebar();
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
  dirty = true;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveNote().then(() => loadNotebooks());
  }, 600);
});
notebookInput.addEventListener("input", () => {
  updateNotebookSuggestions();
  notebookSuggestions.classList.remove("hidden");
});
notebookInput.addEventListener("focus", () => {
  updateNotebookSuggestions();
  notebookSuggestions.classList.remove("hidden");
});
notebookInput.addEventListener("blur", () => {
  // Delay to allow mousedown on suggestion to fire first
  setTimeout(() => notebookSuggestions.classList.add("hidden"), 150);
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
