require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "'sha256-rK+Mx+8ZfQh6wMaytxOiKWAGb/f1Z9xO2jXMaczp21Q='"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      },
    },
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

function validateNote(req, res, next) {
  const { title, content, language } = req.body;
  if (title !== undefined && typeof title !== "string")
    return res.status(400).json({ error: "title must be a string" });
  if (content !== undefined && typeof content !== "string")
    return res.status(400).json({ error: "content must be a string" });
  if (language !== undefined && typeof language !== "string")
    return res.status(400).json({ error: "language must be a string" });
  if (title && title.length > 255)
    return res.status(400).json({ error: "title too long (max 255)" });
  if (language && language.length > 50)
    return res.status(400).json({ error: "language too long (max 50)" });
  next();
}

function validateId(req, res, next) {
  if (!/^\d+$/.test(req.params.id))
    return res.status(400).json({ error: "invalid id" });
  next();
}

// Storage backend — set after init
let db;

// Health check
app.get("/health", async (req, res) => {
  try {
    const result = await db.healthCheck();
    res.json(result);
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// List notes
app.get("/api/notes", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const notes = await db.listNotes(q || null);
    res.json(notes);
  } catch (err) {
    next(err);
  }
});

// Get single note
app.get("/api/notes/:id", validateId, async (req, res, next) => {
  try {
    const note = await db.getNote(req.params.id);
    if (!note) return res.status(404).json({ error: "Not found" });
    res.json(note);
  } catch (err) {
    next(err);
  }
});

// Create note
app.post("/api/notes", validateNote, async (req, res, next) => {
  try {
    const note = await db.createNote(req.body);
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
});

// Update note
app.put("/api/notes/:id", validateId, validateNote, async (req, res, next) => {
  try {
    const note = await db.updateNote(req.params.id, req.body);
    if (!note) return res.status(404).json({ error: "Not found" });
    res.json(note);
  } catch (err) {
    next(err);
  }
});

// Delete note
app.delete("/api/notes/:id", validateId, async (req, res, next) => {
  try {
    const deleted = await db.deleteNote(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Pick storage backend and start
async function start() {
  const pgConfigured = process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER;

  if (pgConfigured) {
    try {
      db = require("./db");
      await db.initDb();
      console.log("Storage: PostgreSQL");
    } catch (err) {
      console.warn("PostgreSQL unavailable, falling back to file storage:", err.message);
      db = require("./db-file");
      await db.initDb();
      console.log("Storage: file system");
    }
  } else {
    db = require("./db-file");
    await db.initDb();
    console.log("Storage: file system");
  }

  app.listen(PORT, () =>
    console.log(`Webnotes running on http://localhost:${PORT}`)
  );
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
