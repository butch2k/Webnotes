const fs = require("fs");
const os = require("os");
const path = require("path");

// Set env BEFORE requiring any modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webnotes-valtest-"));
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

describe("Validation tests", () => {
  describe("ID validation", () => {
    test("GET /api/notes/abc returns 400 (invalid id)", async () => {
      const res = await request(app).get("/api/notes/abc");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid id");
    });

    test("PUT /api/notes/invalid returns 400", async () => {
      const res = await request(app).put("/api/notes/invalid").send({ title: "Test" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid id");
    });

    test("DELETE /api/notes/bad-id returns 400", async () => {
      const res = await request(app).delete("/api/notes/bad-id");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid id");
    });
  });

  describe("Title validation", () => {
    test("title too long (256 chars) returns 400", async () => {
      const longTitle = "a".repeat(256);
      const res = await request(app).post("/api/notes").send({ title: longTitle });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("title too long (max 255)");
    });

    test("title exactly 255 chars is accepted", async () => {
      const maxTitle = "a".repeat(255);
      const res = await request(app).post("/api/notes").send({ title: maxTitle });
      expect(res.status).toBe(201);
    });
  });

  describe("Content validation", () => {
    test("content >1MB returns 400", async () => {
      const largeContent = "a".repeat(1024 * 1024 + 1);
      const res = await request(app).post("/api/notes").send({ content: largeContent });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("content too long (max 1 MB)");
    });

    test("content exactly 1MB is accepted", async () => {
      const maxContent = "a".repeat(1024 * 1024);
      const res = await request(app).post("/api/notes").send({ content: maxContent });
      expect(res.status).toBe(201);
    });
  });

  describe("Tags validation", () => {
    test("tags not array returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ tags: "not-array" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tags must be an array");
    });

    test("empty string tag returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ tags: [""] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("each tag must be a non-empty string (max 100)");
    });

    test("whitespace tag returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ tags: [" foo "] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tags cannot have leading/trailing whitespace");
    });

    test("leading whitespace tag returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ tags: [" foo"] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tags cannot have leading/trailing whitespace");
    });

    test("trailing whitespace tag returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ tags: ["foo "] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tags cannot have leading/trailing whitespace");
    });

    test("duplicate tags returns 400", async () => {
      const res = await request(app)
        .post("/api/notes")
        .send({ tags: ["work", "urgent", "work"] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("duplicate tags not allowed");
    });

    test("more than 20 tags returns 400", async () => {
      const tooManyTags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      const res = await request(app).post("/api/notes").send({ tags: tooManyTags });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("too many tags (max 20)");
    });

    test("exactly 20 tags is accepted", async () => {
      const maxTags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
      const res = await request(app).post("/api/notes").send({ tags: maxTags });
      expect(res.status).toBe(201);
    });

    test("tag longer than 100 chars returns 400", async () => {
      const longTag = "a".repeat(101);
      const res = await request(app).post("/api/notes").send({ tags: [longTag] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("each tag must be a non-empty string (max 100)");
    });

    test("tag exactly 100 chars is accepted", async () => {
      const maxTag = "a".repeat(100);
      const res = await request(app).post("/api/notes").send({ tags: [maxTag] });
      expect(res.status).toBe(201);
    });

    test("non-string tag returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ tags: [123] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("each tag must be a non-empty string (max 100)");
    });
  });

  describe("Pinned validation", () => {
    test("pinned as string returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ pinned: "true" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("pinned must be a boolean");
    });

    test("pinned as number returns 400", async () => {
      const res = await request(app).post("/api/notes").send({ pinned: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("pinned must be a boolean");
    });

    test("pinned as true is accepted", async () => {
      const res = await request(app).post("/api/notes").send({ pinned: true });
      expect(res.status).toBe(201);
      expect(res.body.pinned).toBe(true);
    });

    test("pinned as false is accepted", async () => {
      const res = await request(app).post("/api/notes").send({ pinned: false });
      expect(res.status).toBe(201);
      expect(res.body.pinned).toBe(false);
    });
  });

  describe("Bulk operations validation", () => {
    test("missing ids returns 400", async () => {
      const res = await request(app).post("/api/notes/bulk").send({ action: "delete" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ids must be a non-empty array");
    });

    test("empty ids array returns 400", async () => {
      const res = await request(app)
        .post("/api/notes/bulk")
        .send({ action: "delete", ids: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ids must be a non-empty array");
    });

    test("invalid ids returns 400", async () => {
      const res = await request(app)
        .post("/api/notes/bulk")
        .send({ action: "delete", ids: ["abc", "def"] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid ids");
    });

    test("invalid action returns 400", async () => {
      const res = await request(app)
        .post("/api/notes/bulk")
        .send({ action: "invalid", ids: [1, 2] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unknown action");
    });

    test("tag action with missing tag returns 400", async () => {
      const res = await request(app)
        .post("/api/notes/bulk")
        .send({ action: "tag", ids: [1, 2] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tag must be a string");
    });

    test("tag action with non-string tag returns 400", async () => {
      const res = await request(app)
        .post("/api/notes/bulk")
        .send({ action: "tag", ids: [1, 2], tag: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tag must be a string");
    });
  });

  describe("Tag rename validation", () => {
    test("missing newName returns 400", async () => {
      const res = await request(app).put("/api/tags/oldtag").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid newName");
    });

    test("empty newName returns 400", async () => {
      const res = await request(app).put("/api/tags/oldtag").send({ newName: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid newName");
    });

    test("newName too long returns 400", async () => {
      const longName = "a".repeat(101);
      const res = await request(app).put("/api/tags/oldtag").send({ newName: longName });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid newName");
    });

    test("newName is trimmed", async () => {
      await request(app).post("/api/notes").send({ tags: ["oldtag"] });
      const res = await request(app)
        .put("/api/tags/oldtag")
        .send({ newName: "  newtag  " });

      expect(res.status).toBe(200);
      const tagsRes = await request(app).get("/api/tags");
      expect(tagsRes.body).toEqual([{ tag: "newtag", count: 1 }]);
    });
  });
});
