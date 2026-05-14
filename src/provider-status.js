const COMPACT_LAST_PROVIDER_COMMANDS = new Set([
  "뭐썼어",
  "뭐썻어",
  "뭐씀",
  "뭐썼냐",
  "뭐썻냐",
  "모델",
  "api",
]);

function isLastProviderPrompt(prompt) {
  const normalized = prompt.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
  if (COMPACT_LAST_PROVIDER_COMMANDS.has(normalized)) return true;

  return (
    (normalized.includes("방금") || normalized.includes("지금") || normalized.includes("최근")) &&
    (normalized.includes("gemini") ||
      normalized.includes("제미나이") ||
      normalized.includes("groq") ||
      normalized.includes("gorq") ||
      normalized.includes("그록") ||
      normalized.includes("api") ||
      normalized.includes("모델") ||
      normalized.includes("뭐로") ||
      normalized.includes("무엇으로"))
  );
}

function formatLastProviderReport(lastSuccess) {
  if (!lastSuccess) {
    return "아직 기록된 AI 답변이 없습니다.";
  }

  const providerLabel = lastSuccess.provider === "groq" ? "Groq" : "Gemini";
  const modelLabel = lastSuccess.model || "unknown";
  return `방금 기록된 AI 답변은 ${providerLabel}로 생성했습니다. 모델: ${modelLabel}`;
}

module.exports = {
  formatLastProviderReport,
  isLastProviderPrompt,
};
