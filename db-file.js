const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.WEBNOTES_DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "notes.json");

let notes = [];
let nextId = 1;
let versions = {}; // { noteId: [{ content, title, language, saved_at }] }
const MAX_VERSIONS = 20;

function load() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      const data = JSON.parse(raw);
      notes = Array.isArray(data.notes) ? data.notes : [];
      nextId = data.nextId || 1;
      versions = data.versions || {};
    } catch (err) {
      console.warn("Corrupted data file, starting fresh:", err.message);
      notes = [];
      nextId = 1;
      versions = {};
    }
  }
}

function save() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ notes, nextId, versions }, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

async function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  load();
  console.log(`File-based storage: ${DB_FILE} (${notes.length} notes)`);
}

async function listNotes(q, notebook) {
  let result = [...notes].sort((a, b) => {
    if ((a.pinned || false) !== (b.pinned || false)) return a.pinned ? -1 : 1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
  if (notebook !== undefined && notebook !== null) {
    result = result.filter((n) => (n.notebook || "") === notebook);
  }
  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    result = result.filter((n) => {
      const hay = (n.title + " " + n.content).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  return result;
}

async function getNote(id) {
  return notes.find((n) => n.id === Number(id)) || null;
}

async function createNote({ title, content, language, notebook }) {
  const now = new Date().toISOString();
  const note = {
    id: nextId++,
    title: title || "Untitled",
    content: content || "",
    language: language || "plaintext",
    pinned: false,
    notebook: notebook || "",
    created_at: now,
    updated_at: now,
  };
  notes.push(note);
  save();
  return note;
}

function pushVersion(id, note) {
  const key = String(id);
  if (!versions[key]) versions[key] = [];
  versions[key].push({
    title: note.title,
    content: note.content,
    language: note.language,
    saved_at: note.updated_at,
  });
  if (versions[key].length > MAX_VERSIONS) {
    versions[key] = versions[key].slice(-MAX_VERSIONS);
  }
}

async function updateNote(id, { title, content, language, pinned, notebook }) {
  const note = notes.find((n) => n.id === Number(id));
  if (!note) return null;
  // Save version before modifying if content changes
  if (content !== undefined && content !== note.content) {
    pushVersion(id, note);
  }
  if (title !== undefined) note.title = title;
  if (content !== undefined) note.content = content;
  if (language !== undefined) note.language = language;
  if (pinned !== undefined) note.pinned = pinned;
  if (notebook !== undefined) note.notebook = notebook;
  note.updated_at = new Date().toISOString();
  save();
  return note;
}

async function deleteNote(id) {
  const idx = notes.findIndex((n) => n.id === Number(id));
  if (idx === -1) return false;
  notes.splice(idx, 1);
  delete versions[String(id)];
  save();
  return true;
}

async function listNotebooks() {
  const counts = {};
  notes.forEach((n) => {
    const nb = n.notebook || "";
    if (nb) {
      counts[nb] = (counts[nb] || 0) + 1;
    }
  });
  return Object.entries(counts)
    .map(([notebook, count]) => ({ notebook, count }))
    .sort((a, b) => a.notebook.localeCompare(b.notebook));
}

async function renameNotebook(oldName, newName) {
  let count = 0;
  notes.forEach((n) => {
    if (n.notebook === oldName) {
      n.notebook = newName;
      count++;
    }
  });
  if (count > 0) save();
  return count;
}

async function deleteNotebook(name) {
  let count = 0;
  notes.forEach((n) => {
    if (n.notebook === name) {
      n.notebook = "";
      count++;
    }
  });
  if (count > 0) save();
  return count;
}

async function bulkDelete(ids) {
  const idSet = new Set(ids.map(Number));
  const before = notes.length;
  notes = notes.filter((n) => !idSet.has(n.id));
  idSet.forEach((id) => delete versions[String(id)]);
  if (notes.length !== before) save();
  return before - notes.length;
}

async function bulkMove(ids, notebook) {
  const idSet = new Set(ids.map(Number));
  let count = 0;
  notes.forEach((n) => {
    if (idSet.has(n.id)) {
      n.notebook = notebook;
      count++;
    }
  });
  if (count > 0) save();
  return count;
}

async function getVersions(id) {
  return versions[String(id)] || [];
}

async function healthCheck() {
  return { status: "ok", db: "file" };
}

module.exports = {
  initDb, listNotes, listNotebooks, getNote, createNote, updateNote, deleteNote,
  healthCheck, renameNotebook, deleteNotebook, bulkDelete, bulkMove, getVersions,
};
