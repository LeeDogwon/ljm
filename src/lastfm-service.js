const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_SIMILAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const similarCache = new Map();

function resolveLastFmApiKey(env = process.env) {
  return env.LASTFM_API_KEY || "";
}

function isLastFmConfigured(env = process.env) {
  return Boolean(resolveLastFmApiKey(env));
}

async function getSimilarTracks(seedTrack, options = {}) {
  const env = options.env || process.env;
  const apiKey = resolveLastFmApiKey(env);
  if (!apiKey) return [];

  const seed = parseTrackArtistAndTitle(seedTrack);
  if (!seed.artist || !seed.title) return [];

  const limit = Number(options.limit || env.LASTFM_SIMILAR_LIMIT || 20);
  const cacheKey = `${seed.artist.toLocaleLowerCase("ko-KR")}::${seed.title.toLocaleLowerCase("ko-KR")}::${limit}`;
  const cached = readSimilarCache(cacheKey);
  if (cached) return cached;

  const url = new URL(LASTFM_API_URL);
  url.searchParams.set("method", "track.getSimilar");
  url.searchParams.set("artist", seed.artist);
  url.searchParams.set("track", seed.title);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  if (env.LASTFM_AUTOCORRECT !== "0") url.searchParams.set("autocorrect", "1");

  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const error = new Error(body.message || `Last.fm API failed: ${response.status}`);
    error.status = response.status;
    error.code = body.error || response.status;
    throw error;
  }

  const tracks = normalizeSimilarTracks(body);
  writeSimilarCache(cacheKey, tracks);
  return tracks;
}

function normalizeSimilarTracks(body) {
  const rawTracks = body.similartracks?.track || [];
  const tracks = Array.isArray(rawTracks) ? rawTracks : [rawTracks];
  return tracks
    .map((track) => ({
      artist: normalizeText(track.artist?.name || track.artist || ""),
      title: normalizeText(track.name || ""),
      match: Number(track.match || 0),
      url: track.url || "",
      query: buildYouTubeQuery(track.artist?.name || track.artist || "", track.name || ""),
    }))
    .filter((track) => track.artist && track.title && track.query);
}

function buildYouTubeQuery(artist, title) {
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(title);
  if (!normalizedArtist || !normalizedTitle) return "";
  return `${normalizedArtist} ${normalizedTitle} official audio`;
}

function parseTrackArtistAndTitle(track) {
  const title = normalizeVideoTitle(track?.title || "");
  const channelArtist = normalizeArtistName(track?.channelTitle || "");
  const separators = [" - ", " – ", " — ", "_", "|", ":"];

  for (const separator of separators) {
    const parts = title.split(separator).map((part) => normalizeText(part)).filter(Boolean);
    if (parts.length >= 2) {
      return {
        artist: parts[0],
        title: parts.slice(1).join(" "),
      };
    }
  }

  return {
    artist: channelArtist,
    title: normalizeText(title),
  };
}

function normalizeVideoTitle(value) {
  return normalizeText(value)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/【[^】]*】/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:official|music|video|mv|m\/v|audio|lyrics?|lyric video|가사|자막|한글자막|live|라이브|stage|performance|cover|remaster(?:ed)?|hd|4k)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArtistName(value) {
  return normalizeText(value)
    .replace(/\b(?:official|topic|vevo|youtube|music|channel)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readSimilarCache(key) {
  const entry = similarCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    similarCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeSimilarCache(key, value) {
  similarCache.set(key, {
    value,
    expiresAt: Date.now() + LASTFM_SIMILAR_CACHE_TTL_MS,
  });
}

module.exports = {
  LASTFM_API_URL,
  LASTFM_SIMILAR_CACHE_TTL_MS,
  buildYouTubeQuery,
  getSimilarTracks,
  isLastFmConfigured,
  normalizeSimilarTracks,
  parseTrackArtistAndTitle,
  readSimilarCache,
  resolveLastFmApiKey,
  writeSimilarCache,
};
