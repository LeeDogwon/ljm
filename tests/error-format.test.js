const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getUserFacingError,
  isAuthError,
  isDiscordPermissionError,
  isGeminiFallbackError,
  isNetworkError,
  isQuotaError,
  isTransientGeminiError,
  sanitizeErrorMessage,
} = require("../src/error-format");

test("classifies common runtime errors", () => {
  assert.equal(isQuotaError({ status: 429 }), true);
  assert.equal(isTransientGeminiError({ status: 503 }), true);
  assert.equal(isTransientGeminiError({ message: "UNAVAILABLE: high demand" }), true);
  assert.equal(isGeminiFallbackError({ status: 429 }), true);
  assert.equal(isGeminiFallbackError({ status: 503 }), true);
  assert.equal(isAuthError({ status: 403 }), true);
  assert.equal(isDiscordPermissionError({ code: 50013 }), true);
  assert.equal(isNetworkError(new Error("fetch failed")), true);
});

test("sanitizes API keys and Discord-like tokens", () => {
  const sanitized = sanitizeErrorMessage(
    "AIzaSyA2weygRUhe4kaM-tx0kv40VfjgBjpRIIM gsk_abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz.abcdef.abcdefghijklmnopqrstuvwxyz",
  );
  assert.equal(sanitized.includes("AIza"), false);
  assert.equal(sanitized.includes("gsk_"), false);
  assert.match(sanitized, /\[redacted-api-key\]/);
  assert.match(sanitized, /\[redacted-token\]/);
});

test("formats user-facing error messages", () => {
  assert.match(getUserFacingError({ status: 429 }), /Gemini API 사용량 한도/);
  assert.match(getUserFacingError({ status: 403, message: "PERMISSION_DENIED" }), /AI API 인증/);
  assert.match(getUserFacingError({ code: 50013 }), /Discord 권한/);
  assert.match(getUserFacingError(new Error("fetch failed")), /외부 API 연결/);
});
