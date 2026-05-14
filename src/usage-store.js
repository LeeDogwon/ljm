const fs = require("node:fs/promises");

const { enqueueFileTask, writeJsonAtomic } = require("./json-store");

function createUsageStore({
  usagePath,
  model,
  dailyRequestLimit,
  isAuthError,
  isQuotaError,
  sanitizeErrorMessage,
}) {
  async function readUsage() {
    try {
      const raw = await fs.readFile(usagePath, "utf8");
      return normalizeUsage(JSON.parse(raw), { model, dailyRequestLimit });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return normalizeUsage({}, { model, dailyRequestLimit });
    }
  }

  async function writeUsage(usage) {
    await writeJsonAtomic(usagePath, normalizeUsage(usage, { model, dailyRequestLimit }));
  }

  async function updateUsage(mutator) {
    return enqueueFileTask(usagePath, async () => {
      const usage = await readUsage();
      const result = await mutator(usage);
      await writeUsage(usage);
      return result;
    });
  }

  async function recordApiUsage({ request, response, error, ok }) {
    await updateUsage((usage) => {
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
    });
  }

  function formatUsageReportForStore(usage) {
    return formatUsageReport(usage, { dailyRequestLimit });
  }

  return {
    readUsage,
    recordApiUsage,
    updateUsage,
    writeUsage,
    formatUsageReport: formatUsageReportForStore,
  };
}

function normalizeUsage(usage, { model = "gemini-2.5-flash", dailyRequestLimit = 20 } = {}) {
  return {
    version: 1,
    model: usage.model || model,
    dailyLimit: Number(usage.dailyLimit || dailyRequestLimit),
    days: usage.days || {},
    lastError: usage.lastError || null,
    lastSuccess: usage.lastSuccess || null,
  };
}

function formatUsageReport(usage, { dailyRequestLimit = 20 } = {}) {
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

module.exports = {
  createUsageStore,
  estimateRequestTokens,
  estimateTextTokens,
  formatUsageReport,
  getKoreaDateKey,
  normalizeUsage,
};
