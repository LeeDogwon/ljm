const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPromptExtractor,
  splitDiscordMessage,
} = require("../src/channel-context");

test("extracts prompts after the wake phrase", () => {
  const extractPrompt = createPromptExtractor({
    wakePhrase: "재명아",
    calledOnly: "called",
  });

  assert.equal(extractPrompt("재명아 오늘 뭐해?"), "오늘 뭐해?");
  assert.equal(extractPrompt("재명아, 오늘 뭐해?"), "오늘 뭐해?");
  assert.equal(extractPrompt("재명아"), "called");
  assert.equal(extractPrompt("다른 말 재명아"), null);
});

test("extracts prompts case-insensitively for mixed wake phrases", () => {
  const extractPrompt = createPromptExtractor({
    wakePhrase: "Bot",
    calledOnly: "called",
  });

  assert.equal(extractPrompt("bot hello"), "hello");
  assert.equal(extractPrompt("BOT"), "called");
});

test("splits Discord replies into safe chunks", () => {
  const chunks = splitDiscordMessage("a".repeat(4001), "empty");
  assert.deepEqual(chunks.map((chunk) => chunk.length), [1900, 1900, 201]);
  assert.deepEqual(splitDiscordMessage("   ", "empty"), ["empty"]);
});
