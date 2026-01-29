const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "webnotes",
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err.message);
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      language VARCHAR(50) NOT NULL DEFAULT 'plaintext',
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      notebook VARCHAR(100) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add pinned column if missing (migration for existing DBs)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notes' AND column_name = 'pinned'
      ) THEN
        ALTER TABLE notes ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;
    END $$
  `);

  // Add notebook column if missing (migration for existing DBs)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notes' AND column_name = 'notebook'
      ) THEN
        ALTER TABLE notes ADD COLUMN notebook VARCHAR(100) NOT NULL DEFAULT '';
      END IF;
    END $$
  `);

  // Full-text search: generated tsvector column + GIN index
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notes' AND column_name = 'search_vector'
      ) THEN
        ALTER TABLE notes ADD COLUMN search_vector tsvector
          GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(content, '')), 'B')
          ) STORED;
        CREATE INDEX IF NOT EXISTS idx_notes_search ON notes USING GIN (search_vector);
      END IF;
    END $$
  `);
}

const NOTE_COLS = "id, title, content, language, pinned, notebook, created_at, updated_at";

async function listNotes(q, notebook) {
  const conditions = [];
  const params = [];
  let rankSelect = "";

  if (q) {
    const tokens = q
      .replace(/[&|!<>():*'"\\]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length) {
      const tsquery = tokens.map((t) => t + ":*").join(" & ");
      params.push(tsquery);
      conditions.push(`search_vector @@ to_tsquery('english', $${params.length})`);
      rankSelect = `, ts_rank(search_vector, to_tsquery('english', $${params.length})) AS rank`;
    }
  }

  if (notebook !== undefined && notebook !== null) {
    params.push(notebook);
    conditions.push(`notebook = $${params.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const orderBy = rankSelect
    ? "ORDER BY pinned DESC, rank DESC, updated_at DESC"
    : "ORDER BY pinned DESC, updated_at DESC";

  const { rows } = await pool.query(
    `SELECT ${NOTE_COLS}${rankSelect} FROM notes ${where} ${orderBy}`,
    params
  );
  return rows;
}

async function getNote(id) {
  const { rows } = await pool.query(`SELECT ${NOTE_COLS} FROM notes WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createNote({ title, content, language, notebook }) {
  const { rows } = await pool.query(
    `INSERT INTO notes (title, content, language, notebook) VALUES ($1, $2, $3, $4) RETURNING ${NOTE_COLS}`,
    [title || "Untitled", content || "", language || "plaintext", notebook || ""]
  );
  return rows[0];
}

async function updateNote(id, { title, content, language, pinned, notebook }) {
  const { rows } = await pool.query(
    `UPDATE notes SET
       title = COALESCE($1, title),
       content = COALESCE($2, content),
       language = COALESCE($3, language),
       pinned = COALESCE($4, pinned),
       notebook = COALESCE($5, notebook),
       updated_at = NOW()
     WHERE id = $6 RETURNING ${NOTE_COLS}`,
    [
      title !== undefined ? title : null,
      content !== undefined ? content : null,
      language !== undefined ? language : null,
      pinned !== undefined ? pinned : null,
      notebook !== undefined ? notebook : null,
      id,
    ]
  );
  return rows[0] || null;
}

async function deleteNote(id) {
  const { rowCount } = await pool.query("DELETE FROM notes WHERE id = $1", [id]);
  return rowCount > 0;
}

async function healthCheck() {
  await pool.query("SELECT 1");
  return { status: "ok", db: "connected" };
}

async function listNotebooks() {
  const { rows } = await pool.query(
    `SELECT notebook, COUNT(*)::int AS count FROM notes WHERE notebook != '' GROUP BY notebook ORDER BY notebook`
  );
  return rows;
}

async function close() {
  await pool.end();
}

module.exports = { initDb, listNotes, listNotebooks, getNote, createNote, updateNote, deleteNote, healthCheck, close };
