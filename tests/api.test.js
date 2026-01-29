const fs = require("fs");
const os = require("os");
const path = require("path");

// Set env BEFORE requiring any modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webnotes-apitest-"));
process.env.WEBNOTES_DATA_DIR = tmpDir;

const request = require("supertest");
const dbFile = require("../db-file");
const { createApp } = require("../server");

let app;

beforeEach(async () => {
  // Reset module state
  dbFile.resetForTesting();

  // Delete notes file to reset state
  const notesFile = path.join(tmpDir, "notes.json");
  if (fs.existsSync(notesFile)) {
    fs.unlinkSync(notesFile);
  }

  // Re-initialize db and create app
  await dbFile.initDb();
  app = createApp(dbFile);
});

afterAll(() => {
  dbFile.resetForTesting();
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("API integration tests", () => {
  describe("GET /health", () => {
    test("returns 200 with status", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok", db: "file" });
    });
  });

  describe("POST /api/notes", () => {
    test("creates note and returns 201", async () => {
      const res = await request(app)
        .post("/api/notes")
        .send({ title: "New Note", content: "Content" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 1,
        title: "New Note",
        content: "Content",
      });
      expect(res.body.created_at).toBeDefined();
    });

    test("creates note with defaults", async () => {
      const res = await request(app).post("/api/notes").send({});

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 1,
        title: "Untitled",
        content: "",
        language: "plaintext",
        tags: [],
      });
    });
  });

  describe("GET /api/notes", () => {
    test("returns 200 with array", async () => {
      await request(app).post("/api/notes").send({ title: "Note 1" });
      await request(app).post("/api/notes").send({ title: "Note 2" });

      const res = await request(app).get("/api/notes");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    test("filters by search query", async () => {
      await request(app).post("/api/notes").send({ title: "JavaScript Guide" });
      await request(app).post("/api/notes").send({ title: "Python Tutorial" });

      const res = await request(app).get("/api/notes?q=JavaScript");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe("JavaScript Guide");
    });

    test("filters by tag", async () => {
      await request(app).post("/api/notes").send({ title: "Work", tags: ["work"] });
      await request(app).post("/api/notes").send({ title: "Personal", tags: ["personal"] });

      const res = await request(app).get("/api/notes?tag=work");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe("Work");
    });
  });

  describe("GET /api/notes/:id", () => {
    test("returns 200 for existing note", async () => {
      const created = await request(app).post("/api/notes").send({ title: "Test" });
      const noteId = created.body.id;

      const res = await request(app).get(`/api/notes/${noteId}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Test");
    });

    test("returns 404 for missing note", async () => {
      const res = await request(app).get("/api/notes/999");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Not found");
    });
  });

  describe("PUT /api/notes/:id", () => {
    test("updates note and returns 200", async () => {
      const created = await request(app).post("/api/notes").send({ title: "Original" });
      const noteId = created.body.id;

      const res = await request(app)
        .put(`/api/notes/${noteId}`)
        .send({ title: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Updated");
    });

    test("partial update works", async () => {
      const created = await request(app)
        .post("/api/notes")
        .send({ title: "Title", content: "Content" });
      const noteId = created.body.id;

      const res = await request(app)
        .put(`/api/notes/${noteId}`)
        .send({ title: "New Title" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New Title");
      expect(res.body.content).toBe("Content");
    });

    test("returns 404 for missing note", async () => {
      const res = await request(app).put("/api/notes/999").send({ title: "Nope" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/notes/:id", () => {
    test("deletes note and returns 204", async () => {
      const created = await request(app).post("/api/notes").send({ title: "Delete me" });
      const noteId = created.body.id;

      const res = await request(app).delete(`/api/notes/${noteId}`);
      expect(res.status).toBe(204);

      const getRes = await request(app).get(`/api/notes/${noteId}`);
      expect(getRes.status).toBe(404);
    });

    test("returns 404 when deleting non-existent note", async () => {
      const res = await request(app).delete("/api/notes/999");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/notes/:id/versions", () => {
    test("returns version history array", async () => {
      const created = await request(app)
        .post("/api/notes")
        .send({ title: "Test", content: "v1" });
      const noteId = created.body.id;

      await request(app).put(`/api/notes/${noteId}`).send({ content: "v2" });

      const res = await request(app).get(`/api/notes/${noteId}/versions`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe("v1");
    });

    test("returns empty array for note with no versions", async () => {
      const created = await request(app).post("/api/notes").send({ title: "Test" });
      const noteId = created.body.id;

      const res = await request(app).get(`/api/notes/${noteId}/versions`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("POST /api/notes/bulk", () => {
    test("bulk delete action", async () => {
      const note1 = await request(app).post("/api/notes").send({ title: "Delete 1" });
      const note2 = await request(app).post("/api/notes").send({ title: "Delete 2" });

      const res = await request(app)
        .post("/api/notes/bulk")
        .send({ action: "delete", ids: [note1.body.id, note2.body.id] });

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);

      const listRes = await request(app).get("/api/notes");
      expect(listRes.body).toHaveLength(0);
    });

    test("bulk tag action", async () => {
      const note1 = await request(app).post("/api/notes").send({ title: "Note 1" });
      const note2 = await request(app).post("/api/notes").send({ title: "Note 2" });

      const res = await request(app)
        .post("/api/notes/bulk")
        .send({ action: "tag", ids: [note1.body.id, note2.body.id], tag: "bulk" });

      expect(res.status).toBe(200);
      expect(res.body.tagged).toBe(2);

      const listRes = await request(app).get("/api/notes?tag=bulk");
      expect(listRes.body).toHaveLength(2);
    });
  });

  describe("GET /api/tags", () => {
    test("returns tag list", async () => {
      await request(app).post("/api/notes").send({ tags: ["work", "urgent"] });
      await request(app).post("/api/notes").send({ tags: ["work"] });

      const res = await request(app).get("/api/tags");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { tag: "urgent", count: 1 },
        { tag: "work", count: 2 },
      ]);
    });
  });

  describe("PUT /api/tags/:name", () => {
    test("renames tag", async () => {
      await request(app).post("/api/notes").send({ tags: ["oldtag"] });

      const res = await request(app)
        .put("/api/tags/oldtag")
        .send({ newName: "newtag" });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(1);

      const tagsRes = await request(app).get("/api/tags");
      expect(tagsRes.body).toEqual([{ tag: "newtag", count: 1 }]);
    });
  });

  describe("DELETE /api/tags/:name", () => {
    test("removes tag from notes", async () => {
      await request(app).post("/api/notes").send({ tags: ["remove"] });

      const res = await request(app).delete("/api/tags/remove");
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(1);

      const tagsRes = await request(app).get("/api/tags");
      expect(tagsRes.body).toEqual([]);
    });
  });
});
