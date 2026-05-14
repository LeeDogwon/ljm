const path = require("node:path");
const fs = require("node:fs/promises");

const {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
} = require("discord.js");
const { GoogleGenAI } = require("@google/genai");
const { autoExpandCustomEmojiMessage } = require("./emoji-expand");
const { generateGroqFallback, resolveGroqModel } = require("./groq-fallback");
const { handleMusicInteraction, syncMusicCommands } = require("./music-commands");
const { formatLastProviderReport, isLastProviderPrompt } = require("./provider-status");
const { loadRuntimeEnv, resolveDiscordToken, resolveGeminiApiKey } = require("./runtime-config");

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

    const context = await buildChannelContext(message);
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
    await safeReply(message, getUserFacingError(error));
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

function extractPrompt(content) {
  const trimmed = content.trim();
  const lowerContent = trimmed.toLocaleLowerCase("ko-KR");
  const lowerWakePhrase = wakePhrase.toLocaleLowerCase("ko-KR");

  if (lowerContent === lowerWakePhrase) {
    return KOREAN.calledOnly;
  }

  if (!lowerContent.startsWith(lowerWakePhrase)) return null;

  return (
    trimmed
      .slice(wakePhrase.length)
      .replace(/^[\s,:;!?-]+/, "")
      .trim() || KOREAN.calledOnly
  );
}

async function buildChannelContext(message) {
  if (!message.channel || maxContextMessages <= 0) return [];
  if (message.channel.type === ChannelType.DM) return [];

  const fetched = await message.channel.messages.fetch({
    limit: Math.min(maxContextMessages + 1, 50),
  });

  return Array.from(fetched.values())
    .filter((item) => item.id !== message.id)
    .filter((item) => item.content && !item.author.bot)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((item) => ({
      author: item.member?.displayName || item.author.displayName || item.author.username,
      content: item.content,
    }));
}

async function askAgent({ guildId, userId, userName, channelName, prompt, context }) {
  const contextText = context.length
    ? context.map((item) => `${item.author}: ${item.content}`).join("\n")
    : KOREAN.noContext;
  const needsSearch = shouldUseGoogleSearch(prompt);
  const needsReferenceContext = shouldUseReferenceContext(prompt);
  const [persona, sources, currentContext, memory] = await Promise.all([
    readTextFile(personaPath),
    needsReferenceContext ? readTextFile(sourcesPath) : Promise.resolve("Not included for this request."),
    needsSearch || needsReferenceContext
      ? readTextFile(currentContextPath)
      : Promise.resolve("Not included for this request."),
    readMemory(),
  ]);
  const memoryText = formatMemory(memory, guildId, userId);

  const request = {
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "[Persona]",
              persona,
              "",
              "[Reference notes]",
              sources,
              "",
              "[Current context snapshot]",
              currentContext,
              "",
              "[Long-term memory]",
              memoryText,
              "",
              "[Runtime rules]",
              `Current date: ${new Date().toISOString()}`,
              `The application already verified that the user called you with the wake phrase "${wakePhrase}".`,
              "The user request below is the text after that wake phrase.",
              "Never say that the wake phrase was not used.",
              "Use Google Search grounding for current facts, news, people, prices, schedules, politics, law, economy, technology trends, and any fact that may have changed.",
              "When Google Search grounding is available, prefer it over memory for factual recency.",
              "If Search grounding does not provide enough evidence, say that live verification is still needed.",
              "Use the recent chat context only when it is relevant.",
              "Do not repeat private or sensitive details unless necessary.",
              "Answer in Korean, concisely, and in a Discord-friendly format.",
              "Default to 3 short sentences or fewer unless the user asks for detail.",
              "",
              `Channel: ${channelName}`,
              `Caller: ${userName}`,
              "",
              "[Recent chat context]",
              contextText,
              "",
              "[User request]",
              prompt,
            ].join("\n"),
          },
        ],
      },
    ],
  };

  if (enableGoogleSearch && needsSearch) {
    request.config = {
      tools: [{ googleSearch: {} }],
    };
  }

  const response = await generateWithFallback(request);

  return withGroundingSources(response.text?.trim() || KOREAN.noAnswer, response);
}

async function generateWithFallback(request) {
  await assertApiNotInAuthCooldown();

  try {
    const response = await ai.models.generateContent(request);
    await recordApiUsage({ request, response, ok: true });
    return response;
  } catch (error) {
    await recordApiUsage({ request, error, ok: false });
    if (!isQuotaError(error)) {
      throw error;
    }

    console.warn("Gemini quota or rate limit failed. Falling back to Groq.");
    try {
      const response = await generateGroqFallback(request);
      await recordApiUsage({
        request: { ...request, model: response.model, provider: "groq" },
        response,
        ok: true,
      });
      return response;
    } catch (groqError) {
      await recordApiUsage({
        request: { ...request, model: groqModel, provider: "groq" },
        error: groqError,
        ok: false,
      });
      throw groqError;
    }
  }
}

async function assertApiNotInAuthCooldown() {
  const usage = await readUsage();
  const lastError = usage.lastError;
  if (!lastError || lastError.type !== "auth") return;

  const lastAt = Date.parse(lastError.at || "");
  if (!Number.isFinite(lastAt)) return;

  const elapsed = Date.now() - lastAt;
  if (elapsed >= authCooldownMs) return;

  const error = new Error(
    `Gemini API auth cooldown active after ${lastError.status}: ${lastError.message}`,
  );
  error.status = lastError.status || 403;
  error.code = "AUTH_COOLDOWN";
  throw error;
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

  const usage = await readUsage();
  return formatUsageReport(usage);
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

  const usage = await readUsage();
  return formatLastProviderReport(usage.lastSuccess);
}

async function handleMemoryCommand(message, prompt) {
  const normalized = prompt.trim();
  const guildId = message.guildId || "dm";
  const userId = message.author.id;

  if (["기억 보여줘", "기억 목록", "학습 목록"].includes(normalized)) {
    const memory = await readMemory();
    return formatMemory(memory, guildId, userId);
  }

  if (["기억 삭제", "학습 삭제", "기억 초기화"].includes(normalized)) {
    const memory = await readMemory();
    delete memory.serverInstructions[guildId];
    await writeMemory(memory);
    return "이 서버에서 배운 지침을 초기화했습니다.";
  }

  const serverPrefixes = ["앞으로 ", "기억해 ", "학습해 "];
  const userPrefixes = ["내 설정 기억해 ", "내 말투 기억해 "];
  const serverInstruction = stripPrefix(normalized, serverPrefixes);
  const userInstruction = stripPrefix(normalized, userPrefixes);

  if (!serverInstruction && !userInstruction) return null;

  const memory = await readMemory();
  if (serverInstruction) {
    addMemoryItem(memory.serverInstructions, guildId, serverInstruction, message.author.username);
    await writeMemory(memory);
    return `이 서버 지침으로 기억했습니다: ${serverInstruction}`;
  }

  addMemoryItem(memory.userInstructions, userId, userInstruction, message.author.username);
  await writeMemory(memory);
  return `개인 지침으로 기억했습니다: ${userInstruction}`;
}

function stripPrefix(text, prefixes) {
  const prefix = prefixes.find((candidate) => text.startsWith(candidate));
  return prefix ? text.slice(prefix.length).trim() : null;
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

async function readMemory() {
  try {
    const raw = await fs.readFile(memoryPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      serverInstructions: parsed.serverInstructions || {},
      userInstructions: parsed.userInstructions || {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { serverInstructions: {}, userInstructions: {} };
  }
}

async function readUsage() {
  try {
    const raw = await fs.readFile(usagePath, "utf8");
    return normalizeUsage(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return normalizeUsage({});
  }
}

async function writeUsage(usage) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(usagePath, `${JSON.stringify(normalizeUsage(usage), null, 2)}\n`, "utf8");
}

function normalizeUsage(usage) {
  return {
    version: 1,
    model: usage.model || model,
    dailyLimit: Number(usage.dailyLimit || dailyRequestLimit),
    days: usage.days || {},
    lastError: usage.lastError || null,
    lastSuccess: usage.lastSuccess || null,
  };
}

async function recordApiUsage({ request, response, error, ok }) {
  const usage = await readUsage();
  const dayKey = getKoreaDateKey();
  const day = usage.days[dayKey] || {
    requests: 0,
    successes: 0,
    failures: 0,
    searchRequests: 0,
    quotaErrors: 0,
    authErrors: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  const usageMetadata = response?.usageMetadata || {};
  const estimatedInputTokens =
    usageMetadata.promptTokenCount || estimateRequestTokens(request);
  const outputTokens = usageMetadata.candidatesTokenCount || estimateTextTokens(response?.text || "");
  const totalTokens = usageMetadata.totalTokenCount || estimatedInputTokens + outputTokens;

  day.requests += 1;
  day.searchRequests += request.config?.tools ? 1 : 0;
  day.inputTokens += estimatedInputTokens;
  day.outputTokens += outputTokens;
  day.totalTokens += totalTokens;

  if (ok) {
    day.successes += 1;
    usage.lastSuccess = {
      at: new Date().toISOString(),
      provider: request.provider || "gemini",
      model: request.model || model,
    };
  } else {
    day.failures += 1;
    if (isQuotaError(error)) day.quotaErrors += 1;
    if (isAuthError(error)) day.authErrors += 1;
    usage.lastError = {
      at: new Date().toISOString(),
      type: isQuotaError(error) ? "quota" : isAuthError(error) ? "auth" : "other",
      status: error?.status || error?.code || "unknown",
      message: sanitizeErrorMessage(error?.message || String(error || "")),
    };
  }

  usage.model = request.model || model;
  usage.dailyLimit = dailyRequestLimit;
  usage.days[dayKey] = day;
  await writeUsage(usage);
}

function formatUsageReport(usage) {
  const dayKey = getKoreaDateKey();
  const day = usage.days[dayKey] || {};
  const requests = Number(day.requests || 0);
  const successes = Number(day.successes || 0);
  const failures = Number(day.failures || 0);
  const quotaErrors = Number(day.quotaErrors || 0);
  const totalTokens = Number(day.totalTokens || 0);
  const limit = Number(usage.dailyLimit || dailyRequestLimit);
  const remaining = Math.max(0, limit - requests);
  const avgTokens = requests > 0 ? Math.round(totalTokens / requests) : 0;
  const lastError = usage.lastError;
  const lastErrorText = lastError
    ? `\n최근 오류: ${lastError.type} / ${lastError.status}`
    : "";

  return [
    "그건 핵심을 봐야 합니다. 내가 볼 수 있는 건 Gemini가 알려주는 공식 잔여량이 아니라, 이 봇이 직접 기록한 추정치입니다.",
    `오늘 기록: ${requests}/${limit}회 사용, 남은 대화 약 ${remaining}회`,
    `성공 ${successes}회, 실패 ${failures}회, 쿼터 오류 ${quotaErrors}회`,
    `추정 토큰: 총 ${totalTokens}개, 평균 ${avgTokens}개/요청${lastErrorText}`,
  ].join("\n");
}


function getKoreaDateKey() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function estimateRequestTokens(request) {
  const text = JSON.stringify(request.contents || "");
  return estimateTextTokens(text);
}

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 3);
}

async function writeMemory(memory) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(memoryPath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "";
  }
}

function formatMemory(memory, guildId, userId) {
  const serverItems = memory.serverInstructions[guildId] || [];
  const userItems = memory.userInstructions[userId] || [];
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

function getChannelName(channel) {
  if (!channel) return "unknown";
  if (channel.type === ChannelType.DM) return "DM";
  return channel.name || channel.id;
}

async function replyInChunks(message, text) {
  const chunks = splitDiscordMessage(text);
  for (const chunk of chunks) {
    await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
  }
}

function splitDiscordMessage(text) {
  const limit = 1900;
  const normalized = text.trim() || KOREAN.emptyReply;
  const chunks = [];

  for (let index = 0; index < normalized.length; index += limit) {
    chunks.push(normalized.slice(index, index + limit));
  }

  return chunks;
}

function withGroundingSources(text, response) {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = chunks
    .map((chunk) => chunk.web)
    .filter((web) => web?.uri)
    .map((web) => ({
      title: web.title || "source",
      uri: web.uri,
    }));

  const uniqueSources = [];
  const seen = new Set();
  for (const source of sources) {
    if (seen.has(source.uri)) continue;
    seen.add(source.uri);
    uniqueSources.push(source);
    if (uniqueSources.length >= 3) break;
  }

  if (!uniqueSources.length) return text;

  const sourceText = uniqueSources
    .map((source, index) => `${index + 1}. ${source.title}: ${source.uri}`)
    .join("\n");

  return `${text}\n\n출처:\n${sourceText}`;
}

function shouldUseGoogleSearch(prompt) {
  const normalized = prompt.toLocaleLowerCase("ko-KR");
  const keywords = [
    "최신",
    "오늘",
    "요즘",
    "현재",
    "지금",
    "최근",
    "뉴스",
    "속보",
    "가격",
    "주가",
    "환율",
    "날씨",
    "일정",
    "대통령",
    "총리",
    "장관",
    "법",
    "규정",
    "여론조사",
    "지지율",
    "경제",
    "ai",
    "인공지능",
    "gemini",
    "gpt",
  ];

  return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldUseReferenceContext(prompt) {
  const normalized = prompt.toLocaleLowerCase("ko-KR");
  const keywords = [
    "정치",
    "대통령",
    "이재명",
    "민생",
    "경제",
    "복지",
    "노동",
    "지역균형",
    "행정",
    "개혁",
    "정책",
    "공약",
    "뉴스",
    "토론",
    "찬반",
    "반박",
    "ai",
    "인공지능",
    "반도체",
  ];

  return keywords.some((keyword) => normalized.includes(keyword));
}

async function safeReply(message, content) {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } });
  } catch (error) {
    console.error("Failed to send error reply:", error);
  }
}

function getUserFacingError(error) {
  if (isQuotaError(error)) {
    return buildQuotaFallbackReply(error);
  }

  if (isAuthError(error)) {
    return [
      "AI API 인증에 실패했습니다.",
      "현재 원인은 Gemini API 프로젝트 접근 거부입니다. 로그상 `PERMISSION_DENIED / Your project has been denied access`가 확인됐습니다.",
      "방금까지 작동했더라도 Google 쪽에서 프로젝트 접근이 막히면 같은 키로는 generateContent가 전부 실패합니다.",
      "해결은 Google AI Studio/Cloud에서 해당 프로젝트 접근 상태를 풀거나, 정상 프로젝트의 새 Gemini API 키로 교체하는 것입니다.",
    ].join("\n");
  }

  if (isDiscordPermissionError(error)) {
    return [
      "Discord 권한 문제로 답장을 보내지 못했습니다.",
      "이 채널에서 `Send Messages`, `Read Message History`, `View Channel` 권한을 확인해야 합니다.",
    ].join("\n");
  }

  if (isNetworkError(error)) {
    return [
      "외부 API 연결에 실패했습니다.",
      "Gemini 또는 Google Search 쪽 네트워크가 불안정하거나, VM의 outbound HTTPS 연결에 문제가 있을 수 있습니다.",
      "잠시 후 다시 불러주세요.",
    ].join("\n");
  }

  const code = error?.status || error?.code || "unknown";
  const message = sanitizeErrorMessage(error?.message || String(error || ""));
  if (message) {
    return `처리 중 오류가 났습니다.\n원인 코드: ${code}\n원인: ${message}`;
  }

  return KOREAN.error;
}

function isQuotaError(error) {
  return error?.status === 429 || String(error?.message || "").includes("RESOURCE_EXHAUSTED");
}

function getRetrySeconds(error) {
  const text = String(error?.message || "");
  const match = text.match(/retryDelay\\":\\"(\\d+)s/);
  return match ? Number(match[1]) : null;
}

function buildQuotaFallbackReply(error) {
  const retrySeconds = getRetrySeconds(error);
  const retryText = retrySeconds ? `\n재시도 권장: 약 ${retrySeconds}초 뒤` : "";
  return [
    "Gemini API 사용량 한도에 걸렸습니다.",
    "원인: 토큰/요청 쿼터 부족입니다.",
    "코드 문제가 아니라 현재 API 키의 무료 또는 설정된 사용량 한도를 넘은 상태입니다.",
    "해결: 잠시 뒤 다시 부르거나, Google AI Studio에서 결제/한도 상향 또는 다른 API 키를 설정해야 합니다.",
    retryText,
  ].join("\n");
}

function isAuthError(error) {
  const text = String(error?.message || "");
  return error?.status === 401 || error?.status === 403 || text.includes("API_KEY") || text.includes("PERMISSION_DENIED");
}

function isDiscordPermissionError(error) {
  const code = error?.code;
  const status = error?.status;
  return code === 50013 || code === 50001 || status === 403;
}

function isNetworkError(error) {
  const text = String(error?.message || "");
  return ["fetch failed", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].some((pattern) =>
    text.includes(pattern),
  );
}

function sanitizeErrorMessage(message) {
  return message
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted-api-key]")
    .replace(/gsk_[0-9A-Za-z_-]+/g, "[redacted-api-key]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    .slice(0, 900);
}
