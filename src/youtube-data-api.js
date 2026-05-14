const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const VIDEO_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const videoMetadataCache = new Map();

function resolveYouTubeApiKey(env = process.env) {
  return env.YOUTUBE_API_KEY || "";
}

function isYouTubeDataApiConfigured(env = process.env) {
  return Boolean(resolveYouTubeApiKey(env));
}

async function searchYouTubeDataApi(query, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const apiKey = resolveYouTubeApiKey(env);
  if (!apiKey) return [];

  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoCategoryId", "10");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("maxResults", String(options.limit || 10));
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);

  const regionCode = options.regionCode || env.YOUTUBE_REGION_CODE;
  const relevanceLanguage = options.relevanceLanguage || env.YOUTUBE_RELEVANCE_LANGUAGE;
  if (regionCode) url.searchParams.set("regionCode", regionCode);
  if (relevanceLanguage) url.searchParams.set("relevanceLanguage", relevanceLanguage);

  const response = await fetchImpl(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `YouTube Data API search failed: ${response.status}`);
    error.status = response.status;
    error.code = body.error?.code || response.status;
    throw error;
  }

  const searchItems = (body.items || [])
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      id: item.id.videoId,
      title: item.snippet?.title || "Unknown title",
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      channelTitle: item.snippet?.channelTitle || "",
      liveBroadcastContent: item.snippet?.liveBroadcastContent || "none",
    }));

  if (!searchItems.length) return [];

  const metadata = await fetchVideoMetadata(searchItems.map((item) => item.id), { env, fetch: fetchImpl }).catch((error) => {
    console.warn(`YouTube Data API videos.list failed: ${error.message}`);
    return new Map();
  });

  return searchItems.map((item) => ({
    ...item,
    ...(metadata.get(item.id) || {}),
  }));
}

async function fetchVideoMetadata(videoIds, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const apiKey = resolveYouTubeApiKey(env);
  if (!apiKey || !videoIds.length) return new Map();

  const cached = new Map();
  const missingIds = [];
  for (const videoId of videoIds) {
    const item = readVideoMetadataCache(videoId);
    if (item) cached.set(videoId, item);
    else missingIds.push(videoId);
  }
  if (!missingIds.length) return cached;

  const url = new URL(YOUTUBE_VIDEOS_URL);
  url.searchParams.set("part", "contentDetails,statistics,snippet,status");
  url.searchParams.set("id", missingIds.join(","));
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `YouTube Data API videos failed: ${response.status}`);
    error.status = response.status;
    error.code = body.error?.code || response.status;
    throw error;
  }

  for (const item of body.items || []) {
    const metadata = {
      durationSeconds: parseIsoDurationSeconds(item.contentDetails?.duration || ""),
      channelTitle: item.snippet?.channelTitle || "",
      categoryId: item.snippet?.categoryId || "",
      viewCount: Number(item.statistics?.viewCount || 0),
      embeddable: item.status?.embeddable !== false,
    };
    writeVideoMetadataCache(item.id, metadata);
    cached.set(item.id, metadata);
  }

  return cached;
}

function parseIsoDurationSeconds(duration) {
  const match = String(duration).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function readVideoMetadataCache(videoId) {
  const entry = videoMetadataCache.get(videoId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    videoMetadataCache.delete(videoId);
    return null;
  }
  return entry.value;
}

function writeVideoMetadataCache(videoId, value) {
  videoMetadataCache.set(videoId, {
    value,
    expiresAt: Date.now() + VIDEO_METADATA_TTL_MS,
  });
}

module.exports = {
  VIDEO_METADATA_TTL_MS,
  YOUTUBE_SEARCH_URL,
  YOUTUBE_VIDEOS_URL,
  fetchVideoMetadata,
  isYouTubeDataApiConfigured,
  parseIsoDurationSeconds,
  readVideoMetadataCache,
  resolveYouTubeApiKey,
  searchYouTubeDataApi,
  writeVideoMetadataCache,
};
