# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run with Docker (recommended)
docker compose up -d            # Start PostgreSQL + app at http://localhost:3000
docker compose down -v          # Stop and remove all data

# Run manually
npm install
npm start                       # Production start
npm run dev                     # Dev mode with auto-reload (node --watch)
```

No test suite or linter is configured.

The default branch is `main`. Create feature branches from `main` and PR back into it.

## Architecture

Webnotes is a note-taking app with syntax highlighting, built with Express.js backend and vanilla JavaScript frontend.

### Backend (server.js, db.js, db-file.js)

- **Storage abstraction**: `db.js` (PostgreSQL with full-text search) and `db-file.js` (JSON file fallback) share an identical interface. `server.js` tries PostgreSQL first, falls back to file storage automatically.
- **PostgreSQL schema**: `notes` table uses `TEXT[]` for tags and a `tsvector` column for search. `note_versions` stores last 20 versions per note.
- **API**: REST endpoints under `/api/notes`, `/api/tags`. Input validation middleware enforces limits (title 255 chars, content 1MB, tag 100 chars).
- **Security**: Helmet.js CSP with `cdnjs.cloudflare.com` allowlisted for highlight.js styles.

### Frontend (public/app.js — single file, ~1750 lines)

All UI logic lives in one file with module-level state variables (`currentNoteId`, `currentFilterTag`, `selectedIds`, `dirty`, etc.).

Key patterns:
- **Auto-save**: Debounced 500ms save on content change
- **Offline queue**: Pending operations stored in localStorage, flushed on reconnect
- **Tags system**: Replaced notebooks; tags stored as arrays, rendered as chips with autocomplete
- **Preview**: Syntax highlighting via highlight.js, custom markdown renderer for `.md` notes
- **Bulk operations**: Multi-select mode for delete/tag operations
- **Version history**: Panel showing past versions with restore capability

### Other

- **PWA**: Service worker (`sw.js`) with stale-while-revalidate caching
- **Themes**: Catppuccin Mocha (dark) and Latte (light), stored in localStorage
- **Keyboard shortcuts**: Alt+N (new), Alt+S (save), Alt+P (preview), Alt+C (copy), Alt+F / Ctrl+F (find), Alt+D (export), Escape (close panels)

## Environment Variables

Key env vars (all have defaults): `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PORT` (default 3000), `WEBNOTES_DATA_DIR` (default `./data`).
