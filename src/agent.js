const fs = require("node:fs/promises");

const { generateGroqFallback } = require("./groq-fallback");
const { isGeminiFallbackError } = require("./error-format");

function createAgent({
  ai,
  authCooldownMs,
  currentContextPath,
  enableGoogleSearch,
  formatMemory,
  groqModel,
  memoryStore,
  model,
  personaPath,
  recordApiUsage,
  sourcesPath,
  usageStore,
  wakePhrase,
  strings,
}) {
  async function askAgent({ guildId, userId, userName, channelName, prompt, context }) {
    const contextText = context.length
      ? context.map((item) => `${item.author}: ${item.content}`).join("\n")
      : strings.noContext;
    const needsSearch = shouldUseGoogleSearch(prompt);
    const needsReferenceContext = shouldUseReferenceContext(prompt);
    const [persona, sources, currentContext, memory] = await Promise.all([
      readTextFile(personaPath),
      needsReferenceContext ? readTextFile(sourcesPath) : Promise.resolve("Not included for this request."),
      needsSearch || needsReferenceContext
        ? readTextFile(currentContextPath)
        : Promise.resolve("Not included for this request."),
      memoryStore.readMemory(),
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

    return withGroundingSources(response.text?.trim() || strings.noAnswer, response);
  }

  async function generateWithFallback(request) {
    await assertApiNotInAuthCooldown();

    try {
      const response = await ai.models.generateContent(request);
      await recordApiUsage({ request, response, ok: true });
      return response;
    } catch (error) {
      await recordApiUsage({ request, error, ok: false });
      if (!isGeminiFallbackError(error)) {
        throw error;
      }

      console.warn("Gemini quota, rate limit, or transient availability failed. Falling back to Groq.");
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
    const usage = await usageStore.readUsage();
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

  return {
    askAgent,
    assertApiNotInAuthCooldown,
    generateWithFallback,
  };
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "";
  }
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

module.exports = {
  createAgent,
  readTextFile,
  shouldUseGoogleSearch,
  shouldUseReferenceContext,
  withGroundingSources,
};
