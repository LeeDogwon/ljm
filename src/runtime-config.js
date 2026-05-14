const path = require("node:path");

const dotenv = require("dotenv");

const PLACEHOLDER_VALUES = new Set([
  "changeme",
  "change_me",
  "example",
  "placeholder",
  "todo",
]);

function loadRuntimeEnv(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  return dotenv.config({
    path: path.join(cwd, ".env"),
    override: false,
    processEnv: env,
  });
}

function isPlaceholderEnvValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  if (PLACEHOLDER_VALUES.has(normalized)) return true;
  if (normalized.startsWith("your_")) return true;
  if (normalized.startsWith("replace_")) return true;
  return false;
}

function resolveEnvValue(env, name) {
  const value = env[name];
  return isPlaceholderEnvValue(value) ? "" : String(value).trim();
}

function resolveFirstEnvValue(env, names) {
  for (const name of names) {
    const value = resolveEnvValue(env, name);
    if (value) return value;
  }
  return "";
}

function resolveDiscordToken(env = process.env) {
  return resolveEnvValue(env, "DISCORD_TOKEN");
}

function resolveGeminiApiKey(env = process.env) {
  return resolveFirstEnvValue(env, ["GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY"]);
}

module.exports = {
  isPlaceholderEnvValue,
  loadRuntimeEnv,
  resolveDiscordToken,
  resolveEnvValue,
  resolveFirstEnvValue,
  resolveGeminiApiKey,
};
