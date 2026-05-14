const path = require("node:path");

const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), ".env.example"), override: false });

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.OPENAI_API_KEY;
const model = resolveGeminiModel();

if (!apiKey) {
  console.error("Gemini API key is missing.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await runTest("plain", {
    model,
    contents: [{ role: "user", parts: [{ text: "OK라고만 답해" }] }],
  });

  await runTest("search", {
    model,
    contents: [{ role: "user", parts: [{ text: "대한민국 대통령 최신 확인" }] }],
    config: { tools: [{ googleSearch: {} }] },
  });
}

async function runTest(name, request) {
  try {
    const response = await ai.models.generateContent(request);
    console.log(`${name}: ok`);
    console.log((response.text || "").trim().slice(0, 200));
  } catch (error) {
    console.log(`${name}: fail`);
    console.log(`status: ${error.status || "unknown"}`);
    console.log(error.message || String(error));
  }
}

function resolveGeminiModel() {
  const candidate = process.env.GEMINI_MODEL || process.env.GOOGLE_MODEL || process.env.OPENAI_MODEL;
  if (candidate && !candidate.toLowerCase().startsWith("gpt-")) {
    return candidate;
  }

  return "gemini-2.5-flash";
}
