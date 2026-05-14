const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createUsageStore,
  estimateRequestTokens,
  estimateTextTokens,
  formatUsageReport,
  getKoreaDateKey,
  normalizeUsage,
} = require("../src/usage-store");

test("normalizes usage defaults", () => {
  assert.deepEqual(normalizeUsage({}, { model: "model-a", dailyRequestLimit: 7 }), {
    version: 1,
    model: "model-a",
    dailyLimit: 7,
    days: {},
    lastError: null,
    lastSuccess: null,
  });
});

test("estimates tokens from text and request contents", () => {
  assert.equal(estimateTextTokens("abcdef"), 2);
  assert.equal(estimateRequestTokens({ contents: [{ parts: [{ text: "hello" }] }] }) > 0, true);
});

test("records API usage with queued atomic writes", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-store-"));
  const usagePath = path.join(tmpDir, "usage.json");
  const store = createUsageStore({
    usagePath,
    model: "gemini-test",
    dailyRequestLimit: 20,
    isAuthError: () => false,
    isQuotaError: () => false,
    sanitizeErrorMessage: (message) => message,
  });

  await Promise.all([
    store.recordApiUsage({
      request: { model: "gemini-test", contents: [{ parts: [{ text: "one" }] }] },
      response: { text: "ok", usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } },
      ok: true,
    }),
    store.recordApiUsage({
      request: { model: "gemini-test", contents: [{ parts: [{ text: "two" }] }] },
      error: new Error("failed"),
      ok: false,
    }),
  ]);

  const usage = await store.readUsage();
  const day = usage.days[getKoreaDateKey()];
  assert.equal(day.requests, 2);
  assert.equal(day.successes, 1);
  assert.equal(day.failures, 1);
  assert.equal(fs.readdirSync(tmpDir).some((name) => name.endsWith(".tmp")), false);
});

test("formats usage report", () => {
  const dayKey = getKoreaDateKey();
  const report = formatUsageReport(
    {
      dailyLimit: 5,
      days: {
        [dayKey]: {
          requests: 2,
          successes: 1,
          failures: 1,
          quotaErrors: 1,
          totalTokens: 100,
        },
      },
      lastError: { type: "quota", status: 429 },
    },
    { dailyRequestLimit: 20 },
  );

  assert.match(report, /오늘 기록: 2\/5회 사용/);
  assert.match(report, /최근 오류: quota \/ 429/);
});
