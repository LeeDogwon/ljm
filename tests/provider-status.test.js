const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatLastProviderReport,
  isLastProviderPrompt,
} = require("../src/provider-status");

test("formats the last successful Gemini provider", () => {
  assert.equal(
    formatLastProviderReport({ provider: "gemini", model: "gemini-2.5-flash" }),
    "방금 기록된 AI 답변은 Gemini로 생성했습니다. 모델: gemini-2.5-flash",
  );
});

test("formats the last successful Groq provider", () => {
  assert.equal(
    formatLastProviderReport({ provider: "groq", model: "llama-3.1-8b-instant" }),
    "방금 기록된 AI 답변은 Groq로 생성했습니다. 모델: llama-3.1-8b-instant",
  );
});

test("recognizes compact last provider questions", () => {
  assert.equal(isLastProviderPrompt("뭐썼어"), true);
  assert.equal(isLastProviderPrompt("뭐씀"), true);
  assert.equal(isLastProviderPrompt("모델"), true);
  assert.equal(isLastProviderPrompt("api"), true);
  assert.equal(isLastProviderPrompt("방금 뭐로 했어?"), true);
  assert.equal(isLastProviderPrompt("그냥 대화하자"), false);
});
