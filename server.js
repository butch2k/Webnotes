const express = require("express");
const path = require("path");
const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// List all notes (summary only)
app.get("/api/notes", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, title, language, created_at, updated_at FROM notes ORDER BY updated_at DESC"
  );
  res.json(rows);
});

// Get single note
app.get("/api/notes/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM notes WHERE id = $1", [
    req.params.id,
  ]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

// Create note
app.post("/api/notes", async (req, res) => {
  const { title, content, language } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO notes (title, content, language) VALUES ($1, $2, $3) RETURNING *",
    [title || "Untitled", content || "", language || "plaintext"]
  );
  res.status(201).json(rows[0]);
});

// Update note
app.put("/api/notes/:id", async (req, res) => {
  const { title, content, language } = req.body;
  const { rows } = await pool.query(
    `UPDATE notes SET title = $1, content = $2, language = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [title, content, language, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

// Delete note
app.delete("/api/notes/:id", async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM notes WHERE id = $1", [
    req.params.id,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
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
