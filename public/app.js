const noteList = document.getElementById("note-list");
const editorArea = document.getElementById("editor-area");
const emptyState = document.getElementById("empty-state");
const titleInput = document.getElementById("note-title");
const langSelect = document.getElementById("note-lang");
const contentArea = document.getElementById("note-content");
const previewEl = document.getElementById("note-preview");
const btnNew = document.getElementById("btn-new");
const btnPreview = document.getElementById("btn-preview");
const btnCopy = document.getElementById("btn-copy");
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

let currentNoteId = null;
let currentNotePinned = false;
let saveTimeout = null;
let searchTimeout = null;
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

// === Note list ===
async function loadNotes() {
  try {
    const path = searchQuery
      ? "/notes?q=" + encodeURIComponent(searchQuery)
      : "/notes";
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
    li.innerHTML = `
      <span class="note-item-title">${pinIcon}${escapeHtml(n.title)}</span>
      <span class="note-item-meta">${escapeHtml(n.language)} &middot; ${date}</span>
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
    const note = await api("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Untitled", content: "", language: "plaintext" }),
    });
    currentNoteId = note.id;
    currentNotePinned = false;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    showEditor();
    updatePinButton();
    updateStats();
    titleInput.focus();
    titleInput.select();
    await loadNotes();
  } catch {
    const tempId = "temp_" + Date.now();
    const tempNote = {
      id: tempId,
      title: "Untitled",
      content: "",
      language: "plaintext",
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    enqueue({ type: "create", tempId, data: { title: "Untitled", content: "", language: "plaintext" } });
    const cached = getCachedNotes();
    cached.unshift(tempNote);
    setCachedNotes(cached);
    currentNoteId = tempId;
    currentNotePinned = false;
    titleInput.value = tempNote.title;
    langSelect.value = tempNote.language;
    contentArea.value = tempNote.content;
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
      body: JSON.stringify({ title: filename, content, language }),
    });
    currentNoteId = note.id;
    currentNotePinned = false;
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    showEditor();
    updatePinButton();
    updateStats();
    if (note.content) togglePreview();
    await loadNotes();
  } catch {
    const tempId = "temp_" + Date.now();
    const tempNote = {
      id: tempId,
      title: filename,
      content,
      language,
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    enqueue({ type: "create", tempId, data: { title: filename, content, language } });
    const cached = getCachedNotes();
    cached.unshift(tempNote);
    setCachedNotes(cached);
    currentNoteId = tempId;
    currentNotePinned = false;
    titleInput.value = tempNote.title;
    langSelect.value = tempNote.language;
    contentArea.value = tempNote.content;
    showEditor();
    updatePinButton();
    updateStats();
    if (content) togglePreview();
    lastNotes = getCachedNotes();
    renderNoteList(lastNotes);
  }
}

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNote, 600);
}

async function saveNote() {
  if (!currentNoteId) return;
  const data = {
    title: titleInput.value || "Untitled",
    content: contentArea.value,
    language: langSelect.value,
  };
  try {
    await api("/notes/" + currentNoteId, {
      method: "PUT",
      body: JSON.stringify(data),
    });
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
  if (!confirm("Delete this note?")) return;
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

// === Word / char / line count ===
function updateStats() {
  const text = contentArea.value;
  const chars = text.length;
  const lines = text ? text.split("\n").length : 0;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  statusStats.textContent = `${lines} lines \u00B7 ${words} words \u00B7 ${chars} chars`;
}

// === Preview with line numbers ===
function togglePreview() {
  previewing = !previewing;
  btnPreview.classList.toggle("active", previewing);
  btnPreview.setAttribute("aria-pressed", String(previewing));
  contentArea.classList.toggle("hidden", previewing);
  previewEl.classList.toggle("hidden", !previewing);
  if (previewing) updatePreview();
}

function updatePreview() {
  if (!previewing) return;
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
    const file = e.dataTransfer.files[0];
    if (file) handleFileDrop(file);
  });
}

// === UI helpers ===
function showEditor() {
  editorArea.classList.remove("hidden");
  emptyState.classList.add("hidden");
  previewing = false;
  btnPreview.classList.remove("active");
  btnPreview.setAttribute("aria-pressed", "false");
  contentArea.classList.remove("hidden");
  previewEl.classList.add("hidden");
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

  if (e.altKey && e.key === "f") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

// === Events ===
btnNew.addEventListener("click", createNote);
btnDelete.addEventListener("click", deleteNote);
btnPreview.addEventListener("click", togglePreview);
btnCopy.addEventListener("click", copyToClipboard);
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

// === Init ===
setTheme(getTheme());
setOnline(navigator.onLine);
loadNotes();
flushQueue();
setupDragDrop(dropZone);
setupDragDrop(contentArea);
