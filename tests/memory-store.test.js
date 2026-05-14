const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  addMemoryItem,
  createMemoryStore,
  formatMemory,
  normalizeMemory,
} = require("../src/memory-store");

test("normalizes missing memory buckets", () => {
  assert.deepEqual(normalizeMemory({}), {
    serverInstructions: {},
    userInstructions: {},
  });
});

test("formats server and user memory", () => {
  const text = formatMemory(
    {
      serverInstructions: { guild: [{ text: "server rule" }] },
      userInstructions: { user: [{ text: "user rule" }] },
    },
    "guild",
    "user",
  );

  assert.match(text, /Server instructions/);
  assert.match(text, /server rule/);
  assert.match(text, /User instructions/);
  assert.match(text, /user rule/);
});

test("updates memory with queued atomic writes", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-store-"));
  const memoryPath = path.join(tmpDir, "memory.json");
  const store = createMemoryStore(memoryPath);

  await Promise.all([
    store.updateMemory((memory) => addMemoryItem(memory.serverInstructions, "guild", "one", "a")),
    store.updateMemory((memory) => addMemoryItem(memory.serverInstructions, "guild", "two", "b")),
  ]);

  const memory = await store.readMemory();
  assert.deepEqual(memory.serverInstructions.guild.map((item) => item.text), ["one", "two"]);
  assert.equal(fs.readdirSync(tmpDir).some((name) => name.endsWith(".tmp")), false);
});
