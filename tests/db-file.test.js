const fs = require("fs");
const os = require("os");
const path = require("path");

// Use a single temp directory for all tests in this file
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webnotes-dbtest-"));
process.env.WEBNOTES_DATA_DIR = tmpDir;

// Require db-file ONCE with the test DATA_DIR set
const dbModule = require("../db-file");

// Helper to reset db state by reinitializing from empty file
async function resetDb() {
  const notesFile = path.join(tmpDir, "notes.json");
  if (fs.existsSync(notesFile)) {
    fs.unlinkSync(notesFile);
  }

  // Force module to reload by writing empty data and calling load indirectly via initDb
  // This won't work because load() is not exported. We need another approach.
  // The only way is to delete the cache and re-require with fresh DATA_DIR
  // But that's what we tried and it didn't work.

  // HACK: Manually reset the module's internal state by clearing the file
  // and relying on the module to reload it. Since load() reads from disk,
  // deleting the file should cause initDb to start fresh.

  // Actually, looking at db-file.js, when we call initDb(), it calls load()
  // which reads from disk. If the file doesn't exist, it starts with empty arrays.
  // But the problem is notes/nextId/versions are module-level variables that persist!

  // We need to directly manipulate those variables, but they're not exported.
  // The ONLY solution is to make db-file.js export a reset function, or use
  // a different architecture.

  // For now, let's just accept that we can't fully reset and work with accumulated state.
  // Actually no - let me check if deleting the file and re-requiring works now.
}

const dbFile = require("../db-file");

beforeEach(async () => {
  // Reset module state
  dbFile.resetForTesting();

  // Delete notes file
  const notesFile = path.join(tmpDir, "notes.json");
  if (fs.existsSync(notesFile)) {
    fs.unlinkSync(notesFile);
  }

  // Re-initialize
  await dbFile.initDb();
});

afterAll(() => {
  dbFile.resetForTesting();
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("db-file.js unit tests", () => {
  describe("initDb", () => {
    test("creates data directory", async () => {
      await dbFile.initDb();
      expect(fs.existsSync(tmpDir)).toBe(true);
    });
  });

  describe("createNote", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("returns note with defaults", async () => {
      const note = await dbFile.createNote({});
      expect(note).toMatchObject({
        id: 1,
        title: "Untitled",
        content: "",
        language: "plaintext",
        pinned: false,
        tags: [],
      });
      expect(note.created_at).toBeDefined();
      expect(note.updated_at).toBeDefined();
    });

    test("auto-increments id", async () => {
      const note1 = await dbFile.createNote({});
      const note2 = await dbFile.createNote({});
      expect(note1.id).toBe(1);
      expect(note2.id).toBe(2);
    });

    test("accepts custom values", async () => {
      const note = await dbFile.createNote({
        title: "Test Note",
        content: "Test content",
        language: "javascript",
        tags: ["work", "urgent"],
      });
      expect(note).toMatchObject({
        id: 1,
        title: "Test Note",
        content: "Test content",
        language: "javascript",
        tags: ["work", "urgent"],
      });
    });
  });

  describe("getNote", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("returns note by id", async () => {
      const created = await dbFile.createNote({ title: "Find me" });
      const found = await dbFile.getNote(created.id);
      expect(found.title).toBe("Find me");
    });

    test("returns null for missing id", async () => {
      const found = await dbFile.getNote(999);
      expect(found).toBeNull();
    });
  });

  describe("updateNote", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("does partial update", async () => {
      const note = await dbFile.createNote({ title: "Original", content: "Old" });
      const updated = await dbFile.updateNote(note.id, { title: "Updated" });
      expect(updated.title).toBe("Updated");
      expect(updated.content).toBe("Old");
    });

    test("returns null for missing id", async () => {
      const updated = await dbFile.updateNote(999, { title: "Nope" });
      expect(updated).toBeNull();
    });

    test("updates timestamp", async () => {
      const note = await dbFile.createNote({ title: "Test" });
      const originalTime = note.updated_at;

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await dbFile.updateNote(note.id, { title: "Modified" });
      expect(updated.updated_at).not.toBe(originalTime);
    });
  });

  describe("deleteNote", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("returns true then false", async () => {
      const note = await dbFile.createNote({ title: "Delete me" });
      const deleted1 = await dbFile.deleteNote(note.id);
      expect(deleted1).toBe(true);
      const deleted2 = await dbFile.deleteNote(note.id);
      expect(deleted2).toBe(false);
    });
  });

  describe("listNotes", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("returns all notes sorted by updated_at desc", async () => {
      await dbFile.createNote({ title: "First" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await dbFile.createNote({ title: "Second" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await dbFile.createNote({ title: "Third" });

      const notes = await dbFile.listNotes(null, undefined);
      expect(notes).toHaveLength(3);
      expect(notes[0].title).toBe("Third");
      expect(notes[1].title).toBe("Second");
      expect(notes[2].title).toBe("First");
    });

    test("filters by search query in title", async () => {
      await dbFile.createNote({ title: "JavaScript Guide", content: "Learn JS" });
      await dbFile.createNote({ title: "Python Tutorial", content: "Learn Python" });

      const notes = await dbFile.listNotes("JavaScript", undefined);
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("JavaScript Guide");
    });

    test("filters by search query in content", async () => {
      await dbFile.createNote({ title: "Guide", content: "JavaScript content" });
      await dbFile.createNote({ title: "Tutorial", content: "Python content" });

      const notes = await dbFile.listNotes("JavaScript", undefined);
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Guide");
    });

    test("filters by tag", async () => {
      await dbFile.createNote({ title: "Work Note", tags: ["work"] });
      await dbFile.createNote({ title: "Personal Note", tags: ["personal"] });

      const notes = await dbFile.listNotes(null, "work");
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Work Note");
    });

    test("filters for empty tag (untagged notes)", async () => {
      await dbFile.createNote({ title: "Tagged", tags: ["work"] });
      await dbFile.createNote({ title: "Untagged", tags: [] });

      const notes = await dbFile.listNotes(null, "");
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Untagged");
    });

    test("pinned notes appear first", async () => {
      await dbFile.createNote({ title: "Regular", pinned: false });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await dbFile.createNote({ title: "Pinned", pinned: true });

      const notes = await dbFile.listNotes(null, undefined);
      expect(notes[0].title).toBe("Pinned");
      expect(notes[1].title).toBe("Regular");
    });
  });

  describe("listTags", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("returns sorted tag counts", async () => {
      await dbFile.createNote({ tags: ["work", "urgent"] });
      await dbFile.createNote({ tags: ["work"] });
      await dbFile.createNote({ tags: ["personal"] });

      const tags = await dbFile.listTags();
      expect(tags).toEqual([
        { tag: "personal", count: 1 },
        { tag: "urgent", count: 1 },
        { tag: "work", count: 2 },
      ]);
    });

    test("returns empty array when no tags", async () => {
      await dbFile.createNote({ tags: [] });
      const tags = await dbFile.listTags();
      expect(tags).toEqual([]);
    });
  });

  describe("renameTag", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("renames tag across notes", async () => {
      await dbFile.createNote({ title: "Note 1", tags: ["oldtag"] });
      await dbFile.createNote({ title: "Note 2", tags: ["oldtag", "other"] });

      const count = await dbFile.renameTag("oldtag", "newtag");
      expect(count).toBe(2);

      const notes = await dbFile.listNotes(null, "newtag");
      expect(notes).toHaveLength(2);
    });
  });

  describe("deleteTag", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("removes tag from notes", async () => {
      await dbFile.createNote({ title: "Note 1", tags: ["remove"] });
      await dbFile.createNote({ title: "Note 2", tags: ["remove", "keep"] });

      const count = await dbFile.deleteTag("remove");
      expect(count).toBe(2);

      const tags = await dbFile.listTags();
      expect(tags).toEqual([{ tag: "keep", count: 1 }]);
    });
  });

  describe("bulkDelete", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("removes multiple notes", async () => {
      const note1 = await dbFile.createNote({ title: "Delete 1" });
      const note2 = await dbFile.createNote({ title: "Delete 2" });
      const note3 = await dbFile.createNote({ title: "Keep" });

      const count = await dbFile.bulkDelete([note1.id, note2.id]);
      expect(count).toBe(2);

      const remaining = await dbFile.listNotes(null, undefined);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].title).toBe("Keep");
    });
  });

  describe("bulkTag", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("adds tag to multiple notes", async () => {
      const note1 = await dbFile.createNote({ title: "Note 1" });
      const note2 = await dbFile.createNote({ title: "Note 2" });

      const count = await dbFile.bulkTag([note1.id, note2.id], "bulk");
      expect(count).toBe(2);

      const tagged = await dbFile.listNotes(null, "bulk");
      expect(tagged).toHaveLength(2);
    });

    test("does not add duplicate tags", async () => {
      const note = await dbFile.createNote({ title: "Note", tags: ["existing"] });

      await dbFile.bulkTag([note.id], "existing");

      const updated = await dbFile.getNote(note.id);
      expect(updated.tags).toEqual(["existing"]);
    });
  });

  describe("getVersions", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("version created on content update", async () => {
      const note = await dbFile.createNote({ title: "Test", content: "Original" });
      await dbFile.updateNote(note.id, { content: "Updated" });

      const versions = await dbFile.getVersions(note.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].content).toBe("Original");
    });

    test("max 20 versions kept", async () => {
      const note = await dbFile.createNote({ content: "v0" });

      // Create 25 versions
      for (let i = 1; i <= 25; i++) {
        await dbFile.updateNote(note.id, { content: `v${i}` });
      }

      const versions = await dbFile.getVersions(note.id);
      expect(versions).toHaveLength(20);
      // Should keep versions 5-24 (most recent 20)
      expect(versions[0].content).toBe("v5");
      expect(versions[19].content).toBe("v24");
    });

    test("no version created when content unchanged", async () => {
      const note = await dbFile.createNote({ title: "Test", content: "Same" });
      await dbFile.updateNote(note.id, { title: "Changed" });

      const versions = await dbFile.getVersions(note.id);
      expect(versions).toHaveLength(0);
    });
  });

  describe("healthCheck", () => {
    beforeEach(async () => {
      await dbFile.initDb();
    });

    test("returns ok status", async () => {
      const result = await dbFile.healthCheck();
      expect(result).toEqual({ status: "ok", db: "file" });
    });
  });
});
