require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const PORT = process.env.PORT || 3000;

// Storage backend — set after init
let db;

/**
 * Create and configure Express app with a given database module
 * @param {Object} dbModule - Database module with methods like initDb, createNote, etc.
 * @returns {Object} Configured Express app
 */
function createApp(dbModule) {
  db = dbModule;
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://esm.sh", "'sha256-SNGGNs0Fj0qx1hYYbbNwH+xI7xjt+v10rkTxVCQ4Grw='", "'sha256-Nny8H/je5llKyTsleHxYL8feCRalb8GOIQ20BMZf8DE='", "'sha256-qnbl7ughnhiwU+erhELQjfSnGqj3thjsxYq9/zMMZXo='"],
          workerSrc: ["'self'"],
          imgSrc: ["'self'", "https:", "data:"],
          styleSrc: ["'self'", "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
        },
      },
    })
  );

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: "Too many requests, please try again later" },
  });
  const bulkLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: "Too many bulk requests, please try again later" },
  });

  app.use(express.json({ limit: "5mb" }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/api/", apiLimiter);

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
    if (content && content.length > 1024 * 1024)
      return res.status(400).json({ error: "content too long (max 1 MB)" });
    const { pinned, tags } = req.body;
    if (pinned !== undefined && typeof pinned !== "boolean")
      return res.status(400).json({ error: "pinned must be a boolean" });
    if (tags !== undefined) {
      if (!Array.isArray(tags))
        return res.status(400).json({ error: "tags must be an array" });
      if (tags.length > 20)
        return res.status(400).json({ error: "too many tags (max 20)" });
      const seen = new Set();
      for (const t of tags) {
        if (typeof t !== "string" || t.length === 0 || t.length > 100)
          return res.status(400).json({ error: "each tag must be a non-empty string (max 100)" });
        if (t.trim() !== t)
          return res.status(400).json({ error: "tags cannot have leading/trailing whitespace" });
        if (seen.has(t))
          return res.status(400).json({ error: "duplicate tags not allowed" });
        seen.add(t);
      }
    }
    next();
  }

  function validateId(req, res, next) {
    if (!/^\d+$/.test(req.params.id))
      return res.status(400).json({ error: "invalid id" });
    next();
  }

  // Health check
  app.get("/health", async (req, res) => {
    try {
      const result = await db.healthCheck();
      res.json(result);
    } catch {
      res.status(503).json({ status: "error", db: "disconnected" });
    }
  });

  // List tags
  app.get("/api/tags", async (req, res, next) => {
    try {
      const tags = await db.listTags();
      res.json(tags);
    } catch (err) {
      next(err);
    }
  });

  // Rename tag
  app.put("/api/tags/:name", async (req, res, next) => {
    try {
      const oldName = req.params.name;
      const { newName } = req.body;
      if (!newName || typeof newName !== "string" || newName.length > 100) {
        return res.status(400).json({ error: "invalid newName" });
      }
      const count = await db.renameTag(oldName, newName.trim());
      res.json({ updated: count });
    } catch (err) {
      next(err);
    }
  });

  // Delete tag (remove from all notes)
  app.delete("/api/tags/:name", async (req, res, next) => {
    try {
      const count = await db.deleteTag(req.params.name);
      res.json({ updated: count });
    } catch (err) {
      next(err);
    }
  });

  // List notes
  app.get("/api/notes", async (req, res, next) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
      const notes = await db.listNotes(q || null, tag);
      res.json(notes);
    } catch (err) {
      next(err);
    }
  });

  // Bulk operations
  app.post("/api/notes/bulk", bulkLimiter, async (req, res, next) => {
    try {
      const { action, ids, tag } = req.body;
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      if (!ids.every((id) => typeof id === "number" || /^\d+$/.test(id))) {
        return res.status(400).json({ error: "invalid ids" });
      }
      if (action === "delete") {
        const count = await db.bulkDelete(ids);
        return res.json({ deleted: count });
      }
      if (action === "tag") {
        if (typeof tag !== "string") {
          return res.status(400).json({ error: "tag must be a string" });
        }
        const count = await db.bulkTag(ids, tag);
        return res.json({ tagged: count });
      }
      res.status(400).json({ error: "unknown action" });
    } catch (err) {
      next(err);
    }
  });

  // Get single note
  app.get("/api/notes/:id", validateId, async (req, res, next) => {
    try {
      const note = await db.getNote(req.params.id);
      if (!note) return res.status(404).json({ error: "Not found" });
      res.json(note);
    } catch (err) {
      next(err);
    }
  });

  // Get note versions
  app.get("/api/notes/:id/versions", validateId, async (req, res, next) => {
    try {
      const versions = await db.getVersions(req.params.id);
      res.json(versions);
    } catch (err) {
      next(err);
    }
  });

  // Create note
  app.post("/api/notes", validateNote, async (req, res, next) => {
    try {
      const note = await db.createNote(req.body);
      res.status(201).json(note);
    } catch (err) {
      next(err);
    }
  });

  // Update note
  app.put("/api/notes/:id", validateId, validateNote, async (req, res, next) => {
    try {
      const note = await db.updateNote(req.params.id, req.body);
      if (!note) return res.status(404).json({ error: "Not found" });
      res.json(note);
    } catch (err) {
      next(err);
    }
  });

  // Delete note
  app.delete("/api/notes/:id", validateId, async (req, res, next) => {
    try {
      const deleted = await db.deleteNote(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Error handler
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

// Pick storage backend and start
async function start() {
  const pgConfigured = process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER;

  let dbModule;
  if (pgConfigured) {
    try {
      dbModule = require("./db");
      await dbModule.initDb();
      console.log("Storage: PostgreSQL");
    } catch (err) {
      console.warn("PostgreSQL unavailable, falling back to file storage:", err.message);
      dbModule = require("./db-file");
      await dbModule.initDb();
      console.log("Storage: file system");
    }
  } else {
    dbModule = require("./db-file");
    await dbModule.initDb();
    console.log("Storage: file system");
  }

  const app = createApp(dbModule);

  const server = app.listen(PORT, () =>
    console.log(`Webnotes running on http://localhost:${PORT}`)
  );

  function shutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      if (dbModule.close) dbModule.close().then(() => process.exit(0)).catch(() => process.exit(1));
      else process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createApp };
