const path = require("node:path");

const {
  Client,
  GatewayIntentBits,
  Partials,
} = require("discord.js");
const { GoogleGenAI } = require("@google/genai");
const { createAgent } = require("./agent");
const {
  buildChannelContext,
  createPromptExtractor,
  getChannelName,
  splitDiscordMessage,
} = require("./channel-context");
const { autoExpandCustomEmojiMessage } = require("./emoji-expand");
const { getUserFacingError } = require("./error-format");
const { resolveGroqModel } = require("./groq-fallback");
const { addMemoryItem, createMemoryStore, formatMemory } = require("./memory-store");
const { handleMusicInteraction, syncMusicCommands } = require("./music-commands");
const { formatLastProviderReport, isLastProviderPrompt } = require("./provider-status");
const { loadRuntimeEnv, resolveDiscordToken, resolveGeminiApiKey } = require("./runtime-config");
const { createUsageStore } = require("./usage-store");
const { isAuthError, isQuotaError, sanitizeErrorMessage } = require("./error-format");

loadRuntimeEnv();

const KOREAN = {
  wakePhrase: "\uC7AC\uBA85\uC544",
  calledOnly: "\uC0AC\uC6A9\uC790\uAC00 \uB098\uB97C \uBD88\uB800\uC2B5\uB2C8\uB2E4. \uBB34\uC5C7\uC744 \uB3C4\uC640\uC904 \uC218 \uC788\uB294\uC9C0 \uC9E7\uAC8C \uBB3C\uC5B4\uBD10 \uC8FC\uC138\uC694.",
  error: "\uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uB0AC\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uBD88\uB7EC\uC8FC\uC138\uC694.",
  noContext: "\uCD5C\uADFC \uB300\uD654 \uBB38\uB9E5 \uC5C6\uC74C",
  emptyReply: "\uBE48 \uC751\uB2F5\uC785\uB2C8\uB2E4.",
  noAnswer: "\uB2F5\uBCC0\uC744 \uC0DD\uC131\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
};

const discordToken = resolveDiscordToken();
const geminiApiKey = resolveGeminiApiKey();

if (!discordToken) {
  console.error("Missing required environment variable: DISCORD_TOKEN");
  process.exit(1);
}

if (!geminiApiKey) {
  console.error("Missing required environment variable: GEMINI_API_KEY");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

const wakePhrase = process.env.WAKE_PHRASE || KOREAN.wakePhrase;
const model = resolveGeminiModel();
const groqModel = resolveGroqModel();
const maxContextMessages = Number(process.env.MAX_CONTEXT_MESSAGES || 5);
const allowBotWake = process.env.ALLOW_BOT_WAKE === "1";
const enableGoogleSearch = process.env.ENABLE_GOOGLE_SEARCH !== "0";
const dataDir = path.join(process.cwd(), "data");
const personaPath = path.join(dataDir, "persona.md");
const sourcesPath = path.join(dataDir, "sources.md");
const currentContextPath = path.join(dataDir, "current_context.md");
const memoryPath = path.join(dataDir, "memory.json");
const usagePath = path.join(dataDir, "usage.json");
const dailyRequestLimit = Number(process.env.GEMINI_DAILY_REQUEST_LIMIT || 20);
const authCooldownMs = Number(process.env.GEMINI_AUTH_COOLDOWN_MS || 10 * 60 * 1000);
const allowedChannelIds = new Set(
  (process.env.DISCORD_ALLOWED_CHANNEL_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const memoryStore = createMemoryStore(memoryPath);
const usageStore = createUsageStore({
  usagePath,
  model,
  dailyRequestLimit,
  isAuthError,
  isQuotaError,
  sanitizeErrorMessage,
});
const extractPrompt = createPromptExtractor({
  wakePhrase,
  calledOnly: KOREAN.calledOnly,
});
const { askAgent } = createAgent({
  ai,
  authCooldownMs,
  currentContextPath,
  enableGoogleSearch,
  formatMemory,
  groqModel,
  memoryStore,
  model,
  personaPath,
  recordApiUsage: usageStore.recordApiUsage,
  sourcesPath,
  usageStore,
  wakePhrase,
  strings: KOREAN,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Wake phrase: ${wakePhrase}`);
  console.log(`Gemini model: ${model}`);
  console.log(`Groq fallback model: ${groqModel}`);
  console.log(`Google Search grounding: ${enableGoogleSearch ? "on" : "off"}`);
  await syncMusicCommands(client);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (await handleMusicInteraction(interaction)) return;
  } catch (error) {
    console.error("Unhandled interaction error:", error);
  }
});

client.on("messageCreate", async (message) => {
  try {
    if (await autoExpandCustomEmojiMessage(message, { isAllowedChannel })) return;
    if (message.author.bot && !allowBotWake) return;
    if (!isAllowedChannel(message.channelId)) return;

    const prompt = extractPrompt(message.content);
    if (!prompt) return;

    console.log(
      `Wake phrase received in ${getChannelName(message.channel)} from ${message.author.username}: ${prompt.slice(0, 120)}`,
    );
    await message.channel.sendTyping();

    const localHelpReply = handleLocalHelpCommand(prompt);
    if (localHelpReply) {
      await message.reply({ content: localHelpReply, allowedMentions: { repliedUser: false } });
      console.log(`Local help command handled for message ${message.id}`);
      return;
    }

    const usageCommandReply = await handleUsageCommand(prompt);
    if (usageCommandReply) {
      await message.reply({ content: usageCommandReply, allowedMentions: { repliedUser: false } });
      console.log(`Usage command handled for message ${message.id}`);
      return;
    }

    const lastProviderReply = await handleLastProviderCommand(prompt);
    if (lastProviderReply) {
      await message.reply({ content: lastProviderReply, allowedMentions: { repliedUser: false } });
      console.log(`Last provider command handled for message ${message.id}`);
      return;
    }

    const memoryCommandReply = await handleMemoryCommand(message, prompt);
    if (memoryCommandReply) {
      await message.reply({ content: memoryCommandReply, allowedMentions: { repliedUser: false } });
      console.log(`Memory command handled for message ${message.id}`);
      return;
    }

    const context = await buildChannelContext(message, maxContextMessages);
    const answer = await askAgent({
      guildId: message.guildId || "dm",
      userId: message.author.id,
      userName: message.member?.displayName || message.author.displayName || message.author.username,
      channelName: getChannelName(message.channel),
      prompt,
      context,
    });

    await replyInChunks(message, answer);
    console.log(`Reply sent to message ${message.id}`);
  } catch (error) {
    console.error(error);
    await safeReply(message, getUserFacingError(error, KOREAN.error));
  }
});

client.login(discordToken);

function resolveGeminiModel() {
  const candidate = process.env.GEMINI_MODEL || process.env.GOOGLE_MODEL || process.env.OPENAI_MODEL;
  if (candidate && !candidate.toLowerCase().startsWith("gpt-")) {
    return candidate;
  }

  return "gemini-2.5-flash";
}

function isAllowedChannel(channelId) {
  return allowedChannelIds.size === 0 || allowedChannelIds.has(channelId);
}

async function handleUsageCommand(prompt) {
  const normalized = prompt.trim().toLocaleLowerCase("ko-KR");
  const asksUsage =
    normalized.includes("사용량") ||
    normalized.includes("한도") ||
    normalized.includes("쿼터") ||
    normalized.includes("토큰") ||
    normalized.includes("몇번") ||
    normalized.includes("몇 번") ||
    normalized.includes("얼마나 더");

  if (!asksUsage) return null;

  const usage = await usageStore.readUsage();
  return usageStore.formatUsageReport(usage);
}

function handleLocalHelpCommand(prompt) {
  const normalized = prompt.trim().toLocaleLowerCase("ko-KR");
  const asksHelp =
    normalized === "명령어" ||
    normalized === "도움말" ||
    normalized === "help" ||
    normalized.includes("토큰 안쓰는") ||
    normalized.includes("토큰 안 쓰는") ||
    normalized.includes("토큰 없이") ||
    normalized.includes("로컬 명령어");

  if (!asksHelp) return null;

  return [
    "Gemini 토큰을 쓰지 않는 로컬 명령어입니다.",
    "",
    "사용량/쿼터:",
    "- 재명아 사용량 알려줘",
    "- 재명아 토큰 얼마나 남았어?",
    "- 재명아 앞으로 몇 번 더 대화 가능해?",
    "- 재명아 쿼터 상태 알려줘",
    "- 재명아 뭐썼어",
    "",
    "기억:",
    "- 재명아 기억 보여줘",
    "- 재명아 기억 삭제",
    "- 재명아 앞으로 이 서버에서는 답변을 더 짧게 해",
    "- 재명아 기억해 정치 밈은 가볍게 받아줘",
    "- 재명아 내 설정 기억해 나한테는 반말하지 마",
    "",
    "도움말:",
    "- 재명아 명령어",
    "- 재명아 도움말",
    "- 재명아 토큰 안 쓰는 명령어",
    "",
    "이 목록 밖의 일반 대화, 분석, 최신 검색 질문은 Gemini API를 사용합니다.",
  ].join("\n");
}

async function handleLastProviderCommand(prompt) {
  if (!isLastProviderPrompt(prompt)) return null;

  const usage = await usageStore.readUsage();
  return formatLastProviderReport(usage.lastSuccess);
}

async function handleMemoryCommand(message, prompt) {
  const normalized = prompt.trim();
  const guildId = message.guildId || "dm";
  const userId = message.author.id;

  if (["기억 보여줘", "기억 목록", "학습 목록"].includes(normalized)) {
    const memory = await memoryStore.readMemory();
    return formatMemory(memory, guildId, userId);
  }

  if (["기억 삭제", "학습 삭제", "기억 초기화"].includes(normalized)) {
    await memoryStore.updateMemory((memory) => {
      delete memory.serverInstructions[guildId];
    });
    return "이 서버에서 배운 지침을 초기화했습니다.";
  }

  const serverPrefixes = ["앞으로 ", "기억해 ", "학습해 "];
  const userPrefixes = ["내 설정 기억해 ", "내 말투 기억해 "];
  const serverInstruction = stripPrefix(normalized, serverPrefixes);
  const userInstruction = stripPrefix(normalized, userPrefixes);

  if (!serverInstruction && !userInstruction) return null;

  if (serverInstruction) {
    await memoryStore.updateMemory((memory) => {
      addMemoryItem(memory.serverInstructions, guildId, serverInstruction, message.author.username);
    });
    return `이 서버 지침으로 기억했습니다: ${serverInstruction}`;
  }

  await memoryStore.updateMemory((memory) => {
    addMemoryItem(memory.userInstructions, userId, userInstruction, message.author.username);
  });
  return `개인 지침으로 기억했습니다: ${userInstruction}`;
}

function stripPrefix(text, prefixes) {
  const prefix = prefixes.find((candidate) => text.startsWith(candidate));
  return prefix ? text.slice(prefix.length).trim() : null;
}

async function replyInChunks(message, text) {
  const chunks = splitDiscordMessage(text, KOREAN.emptyReply);
  for (const chunk of chunks) {
    await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
  }
}

async function safeReply(message, content) {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } });
  } catch (error) {
    console.error("Failed to send error reply:", error);
  }
}
