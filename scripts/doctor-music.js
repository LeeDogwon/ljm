const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const { loadRuntimeEnv } = require("../src/runtime-config");

const DEFAULT_YOUTUBE_COOKIES_FILE = "/opt/discord-gpt-agent/data/youtube-cookies.txt";

loadRuntimeEnv();

function main() {
  console.log("Discord Gemini Agent music doctor");

  const ytDlpPath = resolveBinaryPath("yt-dlp", [
    process.env.YOUTUBE_DL_BINARY_PATH,
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ]);
  printBinaryStatus("yt-dlp", ytDlpPath);
  printBinaryStatus("ffmpeg", resolveBinaryPath("ffmpeg", ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]));

  printConfigured("YOUTUBE_API_KEY", process.env.YOUTUBE_API_KEY);
  printConfigured("LASTFM_API_KEY", process.env.LASTFM_API_KEY);
  printCookieStatus("YOUTUBE_COOKIES_FILE", process.env.YOUTUBE_COOKIES_FILE);
  printCookieStatus("default YouTube cookies", DEFAULT_YOUTUBE_COOKIES_FILE, { onlyIfPresent: true });

  console.log(`MUSIC_MAX_TRACK_DURATION_SECONDS: ${process.env.MUSIC_MAX_TRACK_DURATION_SECONDS || 900}`);
  console.log(`MUSIC_MIN_TRACK_DURATION_SECONDS: ${process.env.MUSIC_MIN_TRACK_DURATION_SECONDS || 60}`);
  console.log(`MUSIC_HISTORY_LIMIT: ${process.env.MUSIC_HISTORY_LIMIT || 20}`);
  console.log(`MUSIC_MAX_STREAM_FAILURES: ${process.env.MUSIC_MAX_STREAM_FAILURES || 3}`);
  console.log(`MUSIC_AUTOPLAY_SEARCH_FALLBACK: ${process.env.MUSIC_AUTOPLAY_SEARCH_FALLBACK || 1}`);
  console.log(`YOUTUBE_DL_BINARY_PATH: ${process.env.YOUTUBE_DL_BINARY_PATH || "(auto)"}`);
}

function resolveBinaryPath(command, candidates = []) {
  for (const candidate of candidates.filter(Boolean)) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    return execFileSync("which", [command], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function printBinaryStatus(name, binaryPath) {
  if (!binaryPath) {
    console.log(`${name}: missing`);
    return;
  }

  console.log(`${name}: ${binaryPath}`);
  try {
    const args = name === "ffmpeg" ? ["-version"] : ["--version"];
    const version = execFileSync(binaryPath, args, { encoding: "utf8" }).split("\n")[0];
    console.log(`${name} version: ${version}`);
  } catch (error) {
    console.log(`${name} version: unavailable (${error.message})`);
  }
}

function printConfigured(name, value) {
  console.log(`${name}: ${value ? "configured" : "missing"}`);
}

function printCookieStatus(name, filePath, options = {}) {
  if (!filePath) {
    if (!options.onlyIfPresent) console.log(`${name}: not configured`);
    return;
  }
  console.log(`${name}: ${filePath} (${fs.existsSync(filePath) ? "exists" : "missing"})`);
}

main();
