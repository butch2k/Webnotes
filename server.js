const express = require("express");
const helmet = require("helmet");
const path = require("path");
const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
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

// List all notes (summary only)
app.get("/api/notes", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, language, created_at, updated_at FROM notes ORDER BY updated_at DESC"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Get single note
app.get("/api/notes/:id", validateId, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM notes WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Create note
app.post("/api/notes", validateNote, async (req, res, next) => {
  try {
    const { title, content, language } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO notes (title, content, language) VALUES ($1, $2, $3) RETURNING *",
      [title || "Untitled", content || "", language || "plaintext"]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Update note
app.put("/api/notes/:id", validateId, validateNote, async (req, res, next) => {
  try {
    const { title, content, language } = req.body;
    const { rows } = await pool.query(
      `UPDATE notes SET title = $1, content = $2, language = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [title, content, language, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Delete note
app.delete("/api/notes/:id", validateId, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM notes WHERE id = $1", [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Error handler — don't leak internals
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

initDb()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`Webnotes running on http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
