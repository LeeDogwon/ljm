const { GoogleGenAI } = require("@google/genai");
const { loadRuntimeEnv, resolveDiscordToken, resolveGeminiApiKey } = require("../src/runtime-config");

loadRuntimeEnv();

const discordToken = resolveDiscordToken();
const geminiApiKey = resolveGeminiApiKey();
const geminiModel = resolveGeminiModel();
const enableGoogleSearch = process.env.ENABLE_GOOGLE_SEARCH !== "0";

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  console.log("Discord Gemini Agent doctor");
  console.log(`DISCORD_TOKEN: ${discordToken ? "loaded" : "missing"}`);
  console.log(`Gemini API key: ${geminiApiKey ? "loaded" : "missing"}`);
  console.log(`Gemini model: ${geminiModel}`);
  console.log(`Google Search grounding: ${enableGoogleSearch ? "on" : "off"}`);

  if (!discordToken || !geminiApiKey) {
    process.exitCode = 1;
    return;
  }

  const bot = await fetchDiscordBot();
  console.log(`Discord bot: ${bot.username}#${bot.discriminator} (${bot.id})`);
  console.log(`Invite URL: ${buildInviteUrl(bot.id)}`);

  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const request = {
    model: geminiModel,
    contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
  };
  if (enableGoogleSearch) {
    request.config = {
      tools: [{ googleSearch: {} }],
    };
  }

  const response = await ai.models.generateContent(request);
  console.log(`Gemini test: ${(response.text || "").trim()}`);
  const grounded = Boolean(response.candidates?.[0]?.groundingMetadata);
  console.log(`Grounding metadata: ${grounded ? "present" : "not used for this test"}`);
}

async function fetchDiscordBot() {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bot ${discordToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord token check failed: ${response.status} ${text}`);
  }

  return response.json();
}

function buildInviteUrl(clientId) {
  const permissions = 1024 + 2048 + 65536;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", String(permissions));
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("scope", "bot");
  return url.toString();
}

function resolveGeminiModel() {
  const candidate = process.env.GEMINI_MODEL || process.env.GOOGLE_MODEL || process.env.OPENAI_MODEL;
  if (candidate && !candidate.toLowerCase().startsWith("gpt-")) {
    return candidate;
  }

  return "gemini-2.5-flash";
}
