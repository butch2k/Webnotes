# Webnotes

Simple no-login note-taking web app with syntax highlighting, tags, version history, and offline support. Built with Express.js and vanilla JavaScript.

## Features

### Editor
- **CodeMirror 6 editor** with language-aware syntax highlighting for 30+ languages
- **Markdown preview** with fenced code block highlighting, inline formatting, and image/link support
- **Auto-save** with 600ms debounce — never lose your work
- **Version history** — browse and restore up to 20 previous versions per note
- **Export** notes as files with correct extensions (Alt+D)
- **Copy to clipboard** (Alt+C)

### Organization
- **Tags** — assign multiple tags per note, filter by tag, rename or delete tags in bulk
- **Pinned notes** — keep important notes at the top of the list
- **Sort** by recently updated, recently created, or title (A–Z / Z–A)
- **Full-text search** with result highlighting (PostgreSQL-backed ranked results, or local substring matching)
- **Bulk operations** — multi-select notes for batch delete or tagging (long-press on mobile)

### Interface
- **Light / dark theme** — Catppuccin Mocha & Latte palettes, persisted in localStorage
- **Resizable sidebar** with drag handle (width persisted)
- **Responsive mobile layout** with slide-out sidebar
- **Drag & drop file import** — drop text files onto the editor or empty state
- **PWA** — installable with service worker caching (stale-while-revalidate)
- **Offline resilience** — changes queue in localStorage and sync when reconnected

### Accessibility
- Skip-to-editor link, ARIA labels on all interactive elements
- Keyboard navigation for tag menus, suggestions, and version history panel
- Focus trapping in dialogs, `aria-live` regions for dynamic content
- Full keyboard shortcuts: Alt+N (new), Alt+S (save), Alt+P (preview), Alt+C (copy), Alt+F (search), Alt+D (export), Escape (close/clear)

### Security
- Helmet.js with CSP, referrer policy, and frame denial
- XSS sanitization on markdown preview output
- Rate limiting on API and bulk endpoints
- Input validation with size limits (title 255 chars, content 1MB, tags max 20)

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

## Security notes

- Notes are stored in plain text (no encryption at rest)
- Use HTTPS in production via a reverse proxy (e.g. nginx, Caddy)
- Change default PostgreSQL credentials for production deployments
- API endpoints are rate-limited (300 req/15min general, 10 req/min bulk)
- Bulk operations capped at 100 IDs per request
- Markdown preview sanitizes rendered HTML to block XSS (strips `on*` attributes, `javascript:`/`data:` URIs, script tags)

## Browser support

- Chrome / Edge 88+
- Firefox 87+
- Safari 14+
- Service Worker required for offline mode

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Alt+N | New note |
| Alt+S | Save |
| Alt+P | Toggle markdown preview |
| Alt+C | Copy to clipboard |
| Alt+D | Export/download note |
| Alt+F / Ctrl+F | Focus search / in-editor find |
| Escape | Close panel, exit bulk mode, or deselect note |

## Limitations

- Markdown preview is a lightweight renderer and does not support full CommonMark
- Full-text search with ranking only works with the PostgreSQL backend; file storage uses substring matching
- File uploads are limited to 5 MB text files

## Backup

```bash
# PostgreSQL
pg_dump -h localhost -U postgres webnotes > backup.sql

# File-based storage
cp -r data/ data.backup/
```
