const noteList = document.getElementById("note-list");
const editorArea = document.getElementById("editor-area");
const emptyState = document.getElementById("empty-state");
const titleInput = document.getElementById("note-title");
const langSelect = document.getElementById("note-lang");
const contentArea = document.getElementById("note-content");
const previewEl = document.getElementById("note-preview");
const btnNew = document.getElementById("btn-new");
const btnPreview = document.getElementById("btn-preview");
const btnDelete = document.getElementById("btn-delete");
const saveIndicator = document.querySelector(".save-indicator");
const offlineBanner = document.getElementById("offline-banner");

let currentNoteId = null;
let saveTimeout = null;
let previewing = false;
let online = navigator.onLine;

// --- Offline queue (localStorage-backed) ---
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
  // For saves, keep only the latest per noteId
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
          // Update currentNoteId if we were editing this temp note
          if (currentNoteId === entry.tempId && created) {
            currentNoteId = created.id;
          }
        }
        // Success — remove from queue
        q.shift();
        setPendingQueue(q);
      } catch {
        // Still offline — stop flushing
        break;
      }
    }
    // Refresh list after flush
    if (!getPendingQueue().length) {
      loadNotes();
    }
  } finally {
    flushing = false;
  }
}

// --- Connection status ---
function setOnline(value) {
  online = value;
  offlineBanner.classList.toggle("hidden", online);
  if (online) flushQueue();
}

window.addEventListener("online", () => setOnline(true));
window.addEventListener("offline", () => setOnline(false));

// --- API helpers ---
// Raw fetch — throws on network error, returns parsed body
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

// Wrapper that catches network errors and updates online status
async function api(path, opts = {}) {
  try {
    const result = await apiRaw(path, opts);
    if (!online) setOnline(true);
    return result;
  } catch (err) {
    if (err instanceof TypeError) {
      // Network error (fetch failed)
      setOnline(false);
    }
    throw err;
  }
}

// --- Note list ---
async function loadNotes() {
  try {
    const notes = await api("/notes");
    setCachedNotes(notes);
    renderNoteList(notes);
  } catch {
    // Offline — render from cache
    renderNoteList(getCachedNotes());
  }
}

function renderNoteList(notes) {
  noteList.innerHTML = "";
  notes.forEach((n) => {
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

// --- Open / Create / Save / Delete ---
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
    // Offline — try cache
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
    // Offline — create a temporary local note
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
    renderNoteList(getCachedNotes());
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
    // Offline — queue and update cache
    enqueue({ type: "save", noteId: currentNoteId, data });
    const cached = getCachedNotes();
    const idx = cached.findIndex((n) => n.id === currentNoteId);
    if (idx !== -1) {
      Object.assign(cached[idx], data, { updated_at: new Date().toISOString() });
      setCachedNotes(cached);
    }
    flashSaved("Saved locally");
    renderNoteList(getCachedNotes());
  }
}

async function deleteNote() {
  if (!currentNoteId) return;
  if (!confirm("Delete this note?")) return;
  try {
    await api("/notes/" + currentNoteId, { method: "DELETE" });
  } catch {
    // Offline — queue delete
    enqueue({ type: "delete", noteId: currentNoteId });
    const cached = getCachedNotes().filter((n) => n.id !== currentNoteId);
    setCachedNotes(cached);
  }
  currentNoteId = null;
  hideEditor();
  loadNotes();
}

// --- Preview ---
function togglePreview() {
  previewing = !previewing;
  btnPreview.classList.toggle("active", previewing);
  btnPreview.setAttribute("aria-pressed", previewing);
  contentArea.classList.toggle("hidden", previewing);
  previewEl.classList.toggle("hidden", !previewing);
  if (previewing) updatePreview();
}

function updatePreview() {
  if (!previewing) return;
  const code = previewEl.querySelector("code");
  code.textContent = contentArea.value;
  code.className = "";
  if (langSelect.value !== "plaintext") {
    code.classList.add("language-" + langSelect.value);
  }
  hljs.highlightElement(code);
}

// --- UI helpers ---
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

// --- Events ---
btnNew.addEventListener("click", createNote);
btnDelete.addEventListener("click", deleteNote);
btnPreview.addEventListener("click", togglePreview);
titleInput.addEventListener("input", scheduleSave);
contentArea.addEventListener("input", scheduleSave);
langSelect.addEventListener("change", () => {
  scheduleSave();
  updatePreview();
});

// --- Init ---
setOnline(navigator.onLine);
loadNotes();
// Flush any pending changes from a previous session
flushQueue();
