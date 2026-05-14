const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  isPlaceholderEnvValue,
  loadRuntimeEnv,
  resolveDiscordToken,
  resolveGeminiApiKey,
  resolveGeminiFallbackApiKeys,
} = require("../src/runtime-config");

test("rejects placeholder environment values", () => {
  assert.equal(isPlaceholderEnvValue("your_discord_bot_token"), true);
  assert.equal(isPlaceholderEnvValue("your_gemini_api_key"), true);
  assert.equal(isPlaceholderEnvValue("example"), true);
  assert.equal(isPlaceholderEnvValue("changeme"), true);
  assert.equal(resolveDiscordToken({ DISCORD_TOKEN: "your_discord_bot_token" }), "");
  assert.equal(resolveGeminiApiKey({ GEMINI_API_KEY: "your_gemini_api_key" }), "");
  assert.equal(resolveGeminiApiKey({ GEMINI_API_KEY: "real-gemini-key" }), "real-gemini-key");
  assert.deepEqual(
    resolveGeminiFallbackApiKeys({ GEMINI_FALLBACK_API_KEYS: "key-two, key-three,,key-four" }),
    ["key-two", "key-three", "key-four"],
  );
});

test(".env.example is documentation only and is not loaded at runtime", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-"));
  fs.writeFileSync(path.join(tmpDir, ".env.example"), "DISCORD_TOKEN=example-token\n", "utf8");

  const env = {};
  loadRuntimeEnv({ cwd: tmpDir, env });

  assert.equal(env.DISCORD_TOKEN, undefined);
  assert.equal(resolveDiscordToken(env), "");
});

test("loads only .env for runtime configuration", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-"));
  fs.writeFileSync(path.join(tmpDir, ".env"), "DISCORD_TOKEN=real-token\n", "utf8");
  fs.writeFileSync(path.join(tmpDir, ".env.example"), "DISCORD_TOKEN=example-token\n", "utf8");

  const env = {};
  loadRuntimeEnv({ cwd: tmpDir, env });

  assert.equal(resolveDiscordToken(env), "real-token");
});
