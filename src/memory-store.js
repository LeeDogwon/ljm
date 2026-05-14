const fs = require("node:fs/promises");

const { enqueueFileTask, writeJsonAtomic } = require("./json-store");

function createMemoryStore(memoryPath) {
  async function readMemory() {
    try {
      const raw = await fs.readFile(memoryPath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeMemory(parsed);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return normalizeMemory({});
    }
  }

  async function writeMemory(memory) {
    await writeJsonAtomic(memoryPath, normalizeMemory(memory));
  }

  async function updateMemory(mutator) {
    return enqueueFileTask(memoryPath, async () => {
      const memory = await readMemory();
      const result = await mutator(memory);
      await writeMemory(memory);
      return result;
    });
  }

  return {
    readMemory,
    updateMemory,
    writeMemory,
  };
}

function normalizeMemory(memory) {
  return {
    serverInstructions: memory.serverInstructions || {},
    userInstructions: memory.userInstructions || {},
  };
}

function addMemoryItem(bucket, key, text, by) {
  const items = bucket[key] || [];
  items.push({
    text,
    by,
    at: new Date().toISOString(),
  });
  bucket[key] = items.slice(-30);
}

function formatMemory(memory, guildId, userId) {
  const normalized = normalizeMemory(memory);
  const serverItems = normalized.serverInstructions[guildId] || [];
  const userItems = normalized.userInstructions[userId] || [];
  const lines = [];

  if (serverItems.length) {
    lines.push("[Server instructions]");
    lines.push(...serverItems.map((item) => `- ${item.text}`));
  }

  if (userItems.length) {
    lines.push("[User instructions]");
    lines.push(...userItems.map((item) => `- ${item.text}`));
  }

  return lines.length ? lines.join("\n") : "저장된 장기 기억이 없습니다.";
}

module.exports = {
  addMemoryItem,
  createMemoryStore,
  formatMemory,
  normalizeMemory,
};
