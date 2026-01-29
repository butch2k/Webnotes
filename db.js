const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "webnotes",
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      language VARCHAR(50) NOT NULL DEFAULT 'plaintext',
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
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

const NOTE_COLS = "id, title, content, language, pinned, created_at, updated_at";

async function listNotes(q) {
  if (q) {
    const tokens = q
      .replace(/[&|!<>():*'"\\]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length) {
      const tsquery = tokens.map((t) => t + ":*").join(" & ");
      const { rows } = await pool.query(
        `SELECT ${NOTE_COLS},
                ts_rank(search_vector, to_tsquery('english', $1)) AS rank
         FROM notes
         WHERE search_vector @@ to_tsquery('english', $1)
         ORDER BY pinned DESC, rank DESC, updated_at DESC`,
        [tsquery]
      );
      return rows;
    }
  }
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLS} FROM notes ORDER BY pinned DESC, updated_at DESC`
  );
  return rows;
}

async function getNote(id) {
  const { rows } = await pool.query(`SELECT ${NOTE_COLS} FROM notes WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createNote({ title, content, language }) {
  const { rows } = await pool.query(
    `INSERT INTO notes (title, content, language) VALUES ($1, $2, $3) RETURNING ${NOTE_COLS}`,
    [title || "Untitled", content || "", language || "plaintext"]
  );
  return rows[0];
}

async function updateNote(id, { title, content, language, pinned }) {
  const { rows } = await pool.query(
    `UPDATE notes SET
       title = COALESCE($1, title),
       content = COALESCE($2, content),
       language = COALESCE($3, language),
       pinned = COALESCE($4, pinned),
       updated_at = NOW()
     WHERE id = $5 RETURNING ${NOTE_COLS}`,
    [
      title !== undefined ? title : null,
      content !== undefined ? content : null,
      language !== undefined ? language : null,
      pinned !== undefined ? pinned : null,
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

module.exports = { initDb, listNotes, getNote, createNote, updateNote, deleteNote, healthCheck };
