function getUserFacingError(error, fallbackMessage = "처리 중 오류가 났습니다. 잠시 후 다시 불러주세요.") {
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

  return fallbackMessage;
}

function isQuotaError(error) {
  return error?.status === 429 || String(error?.message || "").includes("RESOURCE_EXHAUSTED");
}

function isTransientGeminiError(error) {
  const text = String(error?.message || "");
  return (
    error?.status === 503 ||
    text.includes("UNAVAILABLE") ||
    text.includes("high demand") ||
    text.includes("overloaded")
  );
}

function isGeminiFallbackError(error) {
  return isQuotaError(error) || isTransientGeminiError(error);
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

module.exports = {
  buildQuotaFallbackReply,
  getRetrySeconds,
  getUserFacingError,
  isAuthError,
  isDiscordPermissionError,
  isGeminiFallbackError,
  isNetworkError,
  isQuotaError,
  isTransientGeminiError,
  sanitizeErrorMessage,
};
