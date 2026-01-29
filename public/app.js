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
const btnTheme = document.getElementById("btn-theme");
const themeIcon = document.getElementById("theme-icon");
const saveIndicator = document.querySelector(".save-indicator");
const offlineBanner = document.getElementById("offline-banner");
const searchInput = document.getElementById("search-input");

let currentNoteId = null;
let saveTimeout = null;
let searchTimeout = null;
let previewing = false;
let online = navigator.onLine;
let searchQuery = "";
let lastNotes = [];

// === Theme ===
const THEME_KEY = "webnotes_theme";

function getTheme() {
  return localStorage.getItem(THEME_KEY) || "dark";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);

  // Toggle highlight.js stylesheets
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

  // Re-render preview if open
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
// Client-side filter for offline / instant fallback
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
  // Immediate client-side filter for responsiveness
  renderNoteList(lastNotes);
  // Debounced server-side search when online
  clearTimeout(searchTimeout);
  if (online && searchQuery) {
    searchTimeout = setTimeout(serverSearch, 300);
  }
});

async function serverSearch() {
  if (!searchQuery) return;
  try {
    const notes = await api("/notes?q=" + encodeURIComponent(searchQuery));
    // Only apply if the search query hasn't changed while waiting
    if (searchQuery === searchInput.value.trim()) {
      lastNotes = notes;
      renderNoteList(notes);
    }
  } catch {
    // Fall back to local filter (already rendered)
  }
}

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
  // Apply client-side filter (also covers offline and non-search case)
  const filtered = searchQuery && online ? notes : filterNotesLocal(notes);
  noteList.innerHTML = "";
  if (!filtered.length) {
    const p = document.createElement("li");
    p.className = "note-list-empty";
    p.setAttribute("role", "presentation");
    p.textContent = searchQuery ? "No matching notes" : "No notes yet";
    noteList.appendChild(p);
    return;
  }
  filtered.forEach((n) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-selected", n.id === currentNoteId ? "true" : "false");
    if (n.id === currentNoteId) li.classList.add("active");
    const date = new Date(n.updated_at).toLocaleDateString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    li.innerHTML = `
      <span class="note-item-title">${escapeHtml(n.title)}</span>
      <span class="note-item-meta">${escapeHtml(n.language)} &middot; ${date}</span>
    `;
    li.onclick = () => openNote(n.id);
    li.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openNote(n.id);
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
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    showEditor();
    updatePreview();
    loadNotes();
  } catch {
    const cached = getCachedNotes().find((n) => n.id === id);
    if (cached) {
      currentNoteId = cached.id;
      titleInput.value = cached.title;
      langSelect.value = cached.language || "plaintext";
      contentArea.value = cached.content || "";
      showEditor();
      updatePreview();
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
    titleInput.value = note.title;
    langSelect.value = note.language;
    contentArea.value = note.content;
    showEditor();
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    enqueue({ type: "create", tempId, data: { title: "Untitled", content: "", language: "plaintext" } });
    const cached = getCachedNotes();
    cached.unshift(tempNote);
    setCachedNotes(cached);
    currentNoteId = tempId;
    titleInput.value = tempNote.title;
    langSelect.value = tempNote.language;
    contentArea.value = tempNote.content;
    showEditor();
    titleInput.focus();
    titleInput.select();
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

// Handle tab key in textarea
contentArea.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const start = contentArea.selectionStart;
    const end = contentArea.selectionEnd;
    contentArea.value =
      contentArea.value.substring(0, start) + "  " + contentArea.value.substring(end);
    contentArea.selectionStart = contentArea.selectionEnd = start + 2;
    scheduleSave();
  }
});

// === Keyboard shortcuts ===
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key === "n") {
    e.preventDefault();
    createNote();
    return;
  }

  if (mod && e.key === "s") {
    e.preventDefault();
    clearTimeout(saveTimeout);
    saveNote();
    return;
  }

  if (mod && e.key === "p") {
    e.preventDefault();
    if (currentNoteId) togglePreview();
    return;
  }

  if (mod && e.shiftKey && e.key === "C") {
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

  if (mod && e.key === "f" && document.activeElement !== contentArea) {
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
btnTheme.addEventListener("click", toggleTheme);
titleInput.addEventListener("input", scheduleSave);
contentArea.addEventListener("input", scheduleSave);
langSelect.addEventListener("change", () => {
  scheduleSave();
  updatePreview();
});

// === Init ===
setTheme(getTheme());
setOnline(navigator.onLine);
loadNotes();
flushQueue();
