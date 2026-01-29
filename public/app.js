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

let currentNoteId = null;
let saveTimeout = null;
let previewing = false;

// --- API helpers ---
async function api(path, opts = {}) {
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

// --- Note list ---
async function loadNotes() {
  const notes = await api("/notes");
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
  const note = await api("/notes/" + id);
  currentNoteId = note.id;
  titleInput.value = note.title;
  langSelect.value = note.language;
  contentArea.value = note.content;
  showEditor();
  updatePreview();
  loadNotes();
}

async function createNote() {
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
}

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNote, 600);
}

async function saveNote() {
  if (!currentNoteId) return;
  await api("/notes/" + currentNoteId, {
    method: "PUT",
    body: JSON.stringify({
      title: titleInput.value || "Untitled",
      content: contentArea.value,
      language: langSelect.value,
    }),
  });
  flashSaved();
  loadNotes();
}

async function deleteNote() {
  if (!currentNoteId) return;
  if (!confirm("Delete this note?")) return;
  await api("/notes/" + currentNoteId, { method: "DELETE" });
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

function flashSaved() {
  saveIndicator.textContent = "Saved";
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
loadNotes();
