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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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

module.exports = { pool, initDb };
