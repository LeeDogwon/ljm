const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GROQ_CHAT_COMPLETIONS_URL,
  geminiRequestToGroqMessages,
  generateGroqFallback,
  resolveGroqApiKey,
  resolveGroqModel,
} = require("../src/groq-fallback");

test("supports GROQ and GORQ environment names", () => {
  assert.equal(resolveGroqApiKey({ GROQ_API_KEY: "groq-key" }), "groq-key");
  assert.equal(resolveGroqApiKey({ GORQ_API_KEY: "gorq-key" }), "gorq-key");
  assert.equal(resolveGroqModel({ GROQ_MODEL: "llama-3.1-8b-instant" }), "llama-3.1-8b-instant");
  assert.equal(resolveGroqModel({ GORQ_MODEL: "qwen/qwen3-32b" }), "qwen/qwen3-32b");
});

test("converts Gemini request contents to Groq chat messages", () => {
  const messages = geminiRequestToGroqMessages({
    contents: [
      {
        role: "user",
        parts: [{ text: "hello" }, { text: "world" }],
      },
      {
        role: "model",
        parts: [{ text: "answer" }],
      },
    ],
  });

  assert.deepEqual(messages, [
    { role: "user", content: "hello\nworld" },
    { role: "assistant", content: "answer" },
  ]);
});

test("calls Groq OpenAI-compatible chat completions endpoint", async () => {
  const calls = [];
  const response = await generateGroqFallback(
    {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    },
    {
      env: {
        GROQ_API_KEY: "test-key",
        GROQ_MODEL: "llama-3.1-8b-instant",
      },
      fetch: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              choices: [{ message: { content: "groq answer" } }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            });
          },
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GROQ_CHAT_COMPLETIONS_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.7,
  });
  assert.equal(response.text, "groq answer");
  assert.equal(response.provider, "groq");
  assert.equal(response.model, "llama-3.1-8b-instant");
  assert.deepEqual(response.usageMetadata, {
    promptTokenCount: 10,
    candidatesTokenCount: 5,
    totalTokenCount: 15,
  });
});
