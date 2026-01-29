# Webnotes

Simple no-login note-taking web app with syntax highlighting. Paste text, pick a language, get colored output.

## Requirements

- Node.js 18+
- PostgreSQL

## Setup

```bash
# Create the database
createdb webnotes

# Install dependencies
npm install

# (Optional) Configure via environment variables
export PGHOST=localhost
export PGUSER=postgres
export PGPASSWORD=postgres
export PGDATABASE=webnotes

# Start the server
npm start
```

The app runs at `http://localhost:3000`. The database table is created automatically on first launch.
