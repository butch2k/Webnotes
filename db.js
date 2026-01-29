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

  // Add tags column and migrate from notebook
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notes' AND column_name = 'tags'
      ) THEN
        ALTER TABLE notes ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
        -- Migrate existing notebook values to tags
        UPDATE notes SET tags = ARRAY[notebook] WHERE notebook != '';
      END IF;
    END $$
  `);

  // GIN index on tags for fast lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes USING GIN (tags)
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

  // Note versions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id SERIAL PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      language VARCHAR(50) NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id)
  `);
}

const NOTE_COLS = "id, title, content, language, pinned, tags, created_at, updated_at";

async function listNotes(q, tag) {
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

  if (tag !== undefined && tag !== null) {
    if (tag === "") {
      // Untagged notes
      conditions.push(`tags = '{}'`);
    } else {
      params.push(tag);
      conditions.push(`$${params.length} = ANY(tags)`);
    }
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

async function createNote({ title, content, language, tags }) {
  const tagsArr = Array.isArray(tags) ? tags.filter(Boolean) : [];
  const { rows } = await pool.query(
    `INSERT INTO notes (title, content, language, tags) VALUES ($1, $2, $3, $4) RETURNING ${NOTE_COLS}`,
    [title || "Untitled", content || "", language || "plaintext", tagsArr]
  );
  return rows[0];
}

async function updateNote(id, { title, content, language, pinned, tags }) {
  // Save version before modifying if content changes
  if (content !== undefined) {
    const current = await getNote(id);
    if (current && current.content !== content) {
      await pool.query(
        `INSERT INTO note_versions (note_id, title, content, language, saved_at) VALUES ($1, $2, $3, $4, $5)`,
        [id, current.title, current.content, current.language, current.updated_at]
      );
      // Keep only last 20 versions
      await pool.query(
        `DELETE FROM note_versions WHERE note_id = $1 AND id NOT IN (
          SELECT id FROM note_versions WHERE note_id = $1 ORDER BY saved_at DESC LIMIT 20
        )`,
        [id]
      );
    }
  }

  const tagsVal = tags !== undefined ? (Array.isArray(tags) ? tags.filter(Boolean) : []) : null;

  const { rows } = await pool.query(
    `UPDATE notes SET
       title = COALESCE($1, title),
       content = COALESCE($2, content),
       language = COALESCE($3, language),
       pinned = COALESCE($4, pinned),
       tags = COALESCE($5, tags),
       updated_at = NOW()
     WHERE id = $6 RETURNING ${NOTE_COLS}`,
    [
      title !== undefined ? title : null,
      content !== undefined ? content : null,
      language !== undefined ? language : null,
      pinned !== undefined ? pinned : null,
      tagsVal,
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

async function listTags() {
  const { rows } = await pool.query(
    `SELECT unnest(tags) AS tag, COUNT(*)::int AS count FROM notes WHERE tags != '{}' GROUP BY tag ORDER BY tag`
  );
  return rows;
}

async function renameTag(oldName, newName) {
  const { rowCount } = await pool.query(
    `UPDATE notes SET tags = array_replace(tags, $1, $2), updated_at = NOW() WHERE $1 = ANY(tags)`,
    [oldName, newName]
  );
  return rowCount;
}

async function deleteTag(name) {
  const { rowCount } = await pool.query(
    `UPDATE notes SET tags = array_remove(tags, $1), updated_at = NOW() WHERE $1 = ANY(tags)`,
    [name]
  );
  return rowCount;
}

async function bulkDelete(ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const { rowCount } = await pool.query(
    `DELETE FROM notes WHERE id IN (${placeholders})`,
    ids.map(Number)
  );
  return rowCount;
}

async function bulkTag(ids, tag) {
  if (!ids.length) return 0;
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
  const { rowCount } = await pool.query(
    `UPDATE notes SET tags = CASE WHEN NOT ($1 = ANY(tags)) THEN array_append(tags, $1) ELSE tags END, updated_at = NOW() WHERE id IN (${placeholders})`,
    [tag, ...ids.map(Number)]
  );
  return rowCount;
}

async function getVersions(id) {
  const { rows } = await pool.query(
    `SELECT title, content, language, saved_at FROM note_versions WHERE note_id = $1 ORDER BY saved_at DESC`,
    [id]
  );
  return rows;
}

async function close() {
  await pool.end();
}

module.exports = {
  initDb, listNotes, listTags, getNote, createNote, updateNote, deleteNote,
  healthCheck, close, renameTag, deleteTag, bulkDelete, bulkTag, getVersions,
};
