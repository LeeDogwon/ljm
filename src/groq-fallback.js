const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";

function resolveGroqApiKey(env = process.env) {
  return env.GROQ_API_KEY || env.GORQ_API_KEY || "";
}

function resolveGroqModel(env = process.env) {
  return env.GROQ_MODEL || env.GORQ_MODEL || DEFAULT_GROQ_MODEL;
}

function geminiRequestToGroqMessages(request) {
  const messages = [];

  for (const content of request.contents || []) {
    const text = (content.parts || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) continue;

    messages.push({
      role: content.role === "model" ? "assistant" : "user",
      content: text,
    });
  }

  return messages.length ? messages : [{ role: "user", content: "" }];
}

async function generateGroqFallback(request, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const apiKey = resolveGroqApiKey(env);
  const model = resolveGroqModel(env);

  if (!apiKey) {
    const error = new Error("Missing required environment variable: GROQ_API_KEY");
    error.code = "GROQ_API_KEY_MISSING";
    throw error;
  }

  const response = await fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: geminiRequestToGroqMessages(request),
      temperature: 0.7,
    }),
  });

  const bodyText = await response.text();
  let body = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }
  }

  if (!response.ok) {
    const error = new Error(
      body?.error?.message || body?.message || bodyText || `Groq request failed: ${response.status}`,
    );
    error.status = response.status;
    error.code = body?.error?.code || response.status;
    throw error;
  }

  const text = body.choices?.[0]?.message?.content || "";
  return {
    text,
    provider: "groq",
    model,
    usageMetadata: {
      promptTokenCount: body.usage?.prompt_tokens || 0,
      candidatesTokenCount: body.usage?.completion_tokens || 0,
      totalTokenCount: body.usage?.total_tokens || 0,
    },
  };
}

module.exports = {
  DEFAULT_GROQ_MODEL,
  GROQ_CHAT_COMPLETIONS_URL,
  geminiRequestToGroqMessages,
  generateGroqFallback,
  resolveGroqApiKey,
  resolveGroqModel,
};
