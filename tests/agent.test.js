const assert = require("node:assert/strict");
const test = require("node:test");

const { createAgent } = require("../src/agent");

test("tries fallback Gemini API clients before Groq fallback", async () => {
  const calls = [];
  const records = [];
  const quotaError = new Error("RESOURCE_EXHAUSTED");
  quotaError.status = 429;
  const request = { model: "gemini-2.5-flash", contents: [] };

  const agent = createAgent({
    ai: createFakeAi("primary", calls, quotaError),
    authCooldownMs: 0,
    fallbackGeminiAis: [
      createFakeAi("fallback-1", calls, quotaError),
      createFakeAi("fallback-2", calls, null, { text: "ok" }),
    ],
    groqModel: "llama-3.1-8b-instant",
    recordApiUsage: async (record) => records.push(record),
    usageStore: { readUsage: async () => ({}) },
  });

  const response = await agent.generateWithFallback(request);

  assert.equal(response.text, "ok");
  assert.deepEqual(calls, ["primary", "fallback-1", "fallback-2"]);
  assert.equal(records[0].ok, false);
  assert.equal(records[1].request.provider, "gemini-fallback-1");
  assert.equal(records[1].ok, false);
  assert.equal(records[2].request.provider, "gemini-fallback-2");
  assert.equal(records[2].ok, true);
});

function createFakeAi(name, calls, error, response = {}) {
  return {
    models: {
      generateContent: async () => {
        calls.push(name);
        if (error) throw error;
        return response;
      },
    },
  };
}
