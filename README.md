# Webnotes

Simple no-login note-taking web app with syntax highlighting. Paste text, pick a language, get colored output.

## Features

- Create, edit and delete notes with auto-save
- Syntax highlighting for 20+ languages (JavaScript, Python, YAML, SQL, Bash, Conf/INI, Nginx, Dockerfile, etc.)
- Auto-detect language option
- Preview mode with line numbers
- Full-text search (PostgreSQL-backed with ranked results)
- Light / dark theme (Catppuccin Mocha & Latte palettes, persisted in localStorage)
- Copy to clipboard
- Keyboard shortcuts: Alt+N (new), Alt+S (save), Alt+P (preview), Alt+C (copy), Alt+F (search), Escape (close/clear)
- Offline resilience with localStorage queue that syncs when reconnected
- Health check endpoint at `GET /health`

## Quick start with Docker Compose

```bash
docker compose up -d
```

This starts both PostgreSQL and the app. Webnotes is available at `http://localhost:3000`.

Data is persisted in a Docker volume (`pgdata`). To stop:

```bash
docker compose down
```

To stop and remove all data:

```bash
docker compose down -v
```

## Manual install

### Requirements

- Node.js 18+
- PostgreSQL (optional — falls back to file-based JSON storage in `./data/`)

### Setup

```bash
# Create the database
createdb webnotes

# Install dependencies
npm install

# (Optional) Create a .env file for configuration
cat > .env <<EOF
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=webnotes
PORT=3000
EOF

# Start the server
npm start

# Or start in development mode (auto-reload on changes)
npm run dev
```

The app runs at `http://localhost:3000`. The database table and full-text search index are created automatically on first launch.

## Environment variables

| Variable     | Default      | Description              |
|--------------|--------------|--------------------------|
| `PGHOST`     | `localhost`  | PostgreSQL host          |
| `PGPORT`     | `5432`       | PostgreSQL port          |
| `PGUSER`     | `postgres`   | PostgreSQL user          |
| `PGPASSWORD` | `postgres`   | PostgreSQL password      |
| `PGDATABASE` | `webnotes`   | PostgreSQL database name |
| `PORT`       | `3000`       | HTTP server port         |
| `WEBNOTES_DATA_DIR` | `./data` | Directory for file-based storage |

If none of `PGHOST`, `PGDATABASE`, or `PGUSER` are set, the app uses file-based JSON storage instead of PostgreSQL. If PostgreSQL is configured but unreachable, it also falls back to file storage automatically.
