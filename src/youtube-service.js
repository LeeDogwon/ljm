const ytdl = require("@distube/ytdl-core");
const fs = require("node:fs");
const youtubeDlPackage = require("youtube-dl-exec");
const YouTube = require("youtube-sr").default;
const { getSimilarTracks, isLastFmConfigured } = require("./lastfm-service");
const { searchYouTubeDataApi } = require("./youtube-data-api");

const MAX_TRACK_DURATION_SECONDS = Number(process.env.MUSIC_MAX_TRACK_DURATION_SECONDS || 60 * 15);
const MIN_TRACK_DURATION_SECONDS = Number(process.env.MUSIC_MIN_TRACK_DURATION_SECONDS || 60);
const HISTORY_LIMIT = Number(process.env.MUSIC_HISTORY_LIMIT || 20);
const ENABLE_AUTOPLAY_SEARCH_FALLBACK = !/^(0|false|no|off)$/i.test(
  process.env.MUSIC_AUTOPLAY_SEARCH_FALLBACK || "",
);
const CACHE_TTL = {
  related: 24 * 60 * 60 * 1000,
  search: 7 * 24 * 60 * 60 * 1000,
};
const relatedCache = new Map();
const searchCache = new Map();
const youtubeDl = createYoutubeDl();
const DEFAULT_YOUTUBE_COOKIES_FILE = "/opt/discord-gpt-agent/data/youtube-cookies.txt";

function createYoutubeDl(env = process.env) {
  const binaryPath = resolveYoutubeDlBinaryPath(env);
  return binaryPath ? youtubeDlPackage.create(binaryPath) : youtubeDlPackage;
}

function resolveYoutubeDlBinaryPath(env = process.env) {
  if (env.YOUTUBE_DL_BINARY_PATH) return env.YOUTUBE_DL_BINARY_PATH;
  if (fs.existsSync("/usr/local/bin/yt-dlp")) return "/usr/local/bin/yt-dlp";
  if (fs.existsSync("/usr/bin/yt-dlp")) return "/usr/bin/yt-dlp";
  return "";
}

function isYouTubeUrl(value) {
  return /^https?:\/\/(www\.)?(youtube\.com|music\.youtube\.com|youtu\.be)\//i.test(value.trim());
}

function normalizeVideo(video, requestedBy = null) {
  const id = video.id || video.videoId || extractVideoId(video.url || video.webpage_url || "");
  const url = video.url || (id ? `https://www.youtube.com/watch?v=${id}` : "");
  const rawDuration = Number(video.durationSeconds || video.durationInSec || video.duration || video.length_seconds || 0);
  const durationSeconds = rawDuration > 24 * 60 * 60 ? Math.round(rawDuration / 1000) : rawDuration;
  return {
    id,
    title: video.title || "Unknown title",
    url,
    durationSeconds,
    requestedBy,
    channelTitle: video.channelTitle || video.channel?.name || "",
    categoryId: video.categoryId || "",
    viewCount: Number(video.viewCount || video.views || 0),
    embeddable: video.embeddable,
  };
}

async function resolveTrack(query, requestedBy = null) {
  if (isYouTubeUrl(query)) {
    return getTrackFromUrl(query, requestedBy);
  }

  const results = await YouTube.search(query, { limit: 10, type: "video", safeSearch: true });
  const video = results.find(isPlayableVideo);
  if (!video) {
    throw new Error("재생할 수 있는 YouTube 검색 결과를 찾지 못했습니다.");
  }

  return normalizeVideo(video, requestedBy);
}

async function getTrackFromUrl(url, requestedBy = null) {
  const info = await youtubeDl(url, buildYoutubeDlOptions({
    dumpSingleJson: true,
    noPlaylist: true,
    skipDownload: true,
  }));
  return normalizeVideo(
    {
      id: info.id,
      title: info.title,
      url: info.webpage_url || url,
      length_seconds: info.duration,
    },
    requestedBy,
  );
}

async function getAutoplayTrack(seedTrack, history = []) {
  const context = createHistoryContext([...history, seedTrack].filter(Boolean));
  const result = await getAutoplayTrackWithContext(seedTrack, context);
  return result?.track || null;
}

async function getAutoplayTrackWithContext(seedTrack, context = createHistoryContext()) {
  const result = await getAutoplayCandidatesWithContext(seedTrack, context, 1);
  return result?.selected?.[0] || null;
}

async function getAutoplayCandidatesWithContext(seedTrack, context = createHistoryContext(), limit = 2) {
  const debug = createAutoplayDebug(seedTrack);
  if (!seedTrack) {
    debug.events.push("no_candidate");
    return { selected: [], debug };
  }

  const lastFmSelected = await getLastFmAutoplayCandidates(seedTrack, context, limit, debug);
  if (lastFmSelected.length) {
    debug.events.push("final_selected");
    return { selected: lastFmSelected.map((item) => item.track), debug };
  }

  let related = [];
  try {
    related = await getRelatedVideos(seedTrack);
    debug.events.push(related.length ? "related_success" : "related_empty");
  } catch (error) {
    debug.events.push("related_failed");
    console.warn(`Related videos failed for "${seedTrack.title}": ${error.message}`);
  }
  const relatedTracks = related.map((video) => normalizeVideo(video));
  let candidates = scoreCandidates(relatedTracks, context, seedTrack, "related", debug);
  let selected = takeTopCandidates(candidates, limit);
  if (selected.length) {
    debug.events.push("final_selected");
    return { selected: selected.map((item) => item.track), debug };
  }

  if (!ENABLE_AUTOPLAY_SEARCH_FALLBACK) {
    debug.events.push("search_fallback_disabled");
    debug.events.push("no_candidate");
    return { selected: [], debug };
  }

  for (const fallbackQuery of buildAutoplaySearchQueries(seedTrack)) {
    const { source, videos: searched, events = [] } = await searchAutoplayVideos(fallbackQuery, 25);
    debug.events.push(...events);
    candidates = scoreCandidates(
      searched.map((video) => normalizeVideo(video)),
      context,
      seedTrack,
      source,
      debug,
    );
    selected = takeTopCandidates(candidates, limit);
    if (selected.length) {
      debug.events.push("final_selected");
      return { selected: selected.map((item) => item.track), debug };
    }
  }

  debug.events.push("no_candidate");
  return { selected: [], debug };
}

async function getLastFmAutoplayCandidates(seedTrack, context, limit, debug) {
  if (!isLastFmConfigured()) {
    debug.events.push("lastfm_unconfigured");
    return [];
  }

  let similarTracks = [];
  try {
    similarTracks = await getSimilarTracks(seedTrack);
    debug.events.push(similarTracks.length ? "lastfm_success" : "lastfm_empty");
  } catch (error) {
    debug.events.push("lastfm_failed");
    console.warn(`Last.fm similar tracks failed for "${seedTrack.title}": ${error.message}`);
    return [];
  }

  const scored = [];
  for (const similarTrack of similarTracks) {
    const { source, videos, events = [] } = await searchAutoplayVideos(similarTrack.query, 5);
    debug.events.push(...events.map((event) => `lastfm_${event}`));
    const candidates = scoreCandidates(
      videos.map((video) => normalizeVideo(video)),
      context,
      seedTrack,
      `lastfm_${source}`,
      debug,
    ).map((item) => ({
      ...item,
      score: item.excluded ? item.score : item.score + Math.round((similarTrack.match || 0) * 25),
    }));
    scored.push(...candidates);

    const selected = takeTopCandidates(scored, limit);
    if (selected.length >= limit) return selected;
  }

  return takeTopCandidates(scored, limit);
}

async function getRelatedVideos(seedTrack) {
  const cached = readCache(relatedCache, seedTrack.id || seedTrack.url);
  if (cached) return cached;

  const info = await ytdl.getBasicInfo(seedTrack.url);
  const videos = Array.isArray(info.related_videos) ? info.related_videos : [];
  writeCache(relatedCache, seedTrack.id || seedTrack.url, videos, CACHE_TTL.related);
  return videos;
}

function createTrackStream(track) {
  const child = youtubeDl.exec(track.url, buildYoutubeDlOptions({
    format: "bestaudio[ext=webm]/bestaudio/best",
    noPlaylist: true,
    noWarnings: true,
    output: "-",
    quiet: true,
  }), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrText = "";
  if (typeof child.catch === "function") {
    child.catch((error) => {
      if (child.killed || error.signalCode === "SIGTERM") return;
      const message = stderrText || error.message;
      console.error("yt-dlp stream process failed:", message);
      child.stdout.destroy(new Error(message));
    });
  }
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      stderrText = `${stderrText}\n${text}`.trim();
      console.warn(`yt-dlp: ${text}`);
    }
  });
  child.stdout._ytdlpProcess = child;
  return child.stdout;
}

function buildYoutubeDlOptions(baseOptions, env = process.env) {
  const options = { ...baseOptions };
  const cookiesFile = env.YOUTUBE_COOKIES_FILE || (
    fs.existsSync(DEFAULT_YOUTUBE_COOKIES_FILE) ? DEFAULT_YOUTUBE_COOKIES_FILE : ""
  );
  if (cookiesFile) options.cookies = cookiesFile;
  if (env.YOUTUBE_COOKIES_FROM_BROWSER) options.cookiesFromBrowser = env.YOUTUBE_COOKIES_FROM_BROWSER;
  if (env.YOUTUBE_DLP_EXTRACTOR_ARGS) options.extractorArgs = env.YOUTUBE_DLP_EXTRACTOR_ARGS;
  if (env.YOUTUBE_DLP_USER_AGENT) options.userAgent = env.YOUTUBE_DLP_USER_AGENT;
  return options;
}

function isPlayableVideo(video) {
  const track = normalizeVideo(video);
  return isTrackCandidate(track, createHistoryContext());
}

function isTrackCandidate(track, context = createHistoryContext()) {
  return !getHardExcludeReason(track, context);
}

function isAutoplayCandidate(track, context = createHistoryContext()) {
  if (!isTrackCandidate(track, context)) return false;
  if (isCoverOrDerivativeTitle(track.title)) return false;
  return isOriginalLeaningTitle(track.title);
}

function isSafeAutoplayCandidate(track, context = createHistoryContext()) {
  if (!isTrackCandidate(track, context)) return false;
  return !isCoverOrDerivativeTitle(track.title);
}

function pickAutoplayCandidate(tracks, context = createHistoryContext()) {
  return (
    tracks.find((track) => isAutoplayCandidate(track, context)) ||
    tracks.find((track) => isSafeAutoplayCandidate(track, context)) ||
    null
  );
}

function pickRelaxedAutoplayCandidate(tracks, context = createHistoryContext()) {
  return tracks.find((track) => isSafeAutoplayCandidate(track, context)) || null;
}

async function safeYoutubeSearch(query, limit = 10) {
  const cached = readCache(searchCache, `local:${query}:${limit}`);
  if (cached) return cached;

  try {
    const results = await YouTube.search(query, { limit, type: "video", safeSearch: true });
    writeCache(searchCache, `local:${query}:${limit}`, results, CACHE_TTL.search);
    return results;
  } catch (error) {
    console.warn(`YouTube search failed for "${query}": ${error.message}`);
    return [];
  }
}

async function searchAutoplayVideos(query, limit = 10) {
  const cached = readCache(searchCache, `autoplay:${query}:${limit}`);
  if (cached) return cached;

  try {
    const dataApiResults = await searchYouTubeDataApi(query, { limit });
    if (dataApiResults.length) {
      const result = { source: "data_api", videos: dataApiResults, events: ["data_api_success"] };
      writeCache(searchCache, `autoplay:${query}:${limit}`, result, CACHE_TTL.search);
      return result;
    }
    const emptyResult = { source: "data_api", videos: [], events: ["data_api_empty"] };
    writeCache(searchCache, `autoplay:${query}:${limit}`, emptyResult, CACHE_TTL.search);
  } catch (error) {
    const events = [];
    if (error.status === 403 || error.status === 429) {
      events.push("data_api_quota_exceeded");
      console.warn(`YouTube Data API quota or permission issue for "${query}": ${error.message}`);
    }
    console.warn(`YouTube Data API search failed for "${query}": ${error.message}`);
    const localResults = await safeYoutubeSearch(query, limit);
    return {
      source: "local",
      videos: localResults,
      events: [...events, localResults.length ? "local_search_success" : "local_search_empty"],
    };
  }

  const localResults = await safeYoutubeSearch(query, limit);
  const result = { source: "local", videos: localResults, events: [localResults.length ? "local_search_success" : "local_search_empty"] };
  if (localResults.length) writeCache(searchCache, `autoplay:${query}:${limit}`, result, CACHE_TTL.search);
  return result;
}

function buildAutoplaySearchQueries(seedTrack) {
  const artist = getLikelyArtistFromTrack(seedTrack);
  const queries = [];

  if (artist) {
    queries.push(`${artist} songs`);
    queries.push(`${artist} official audio`);
    queries.push(`${artist} topic`);
    queries.push(`${artist} popular songs`);
    queries.push(`${artist} music playlist`);
    queries.push(`${artist} similar songs`);
  }

  return [...new Set(queries.filter(Boolean))];
}

function getLikelyArtistFromTrack(track) {
  const titleArtist = getLikelyArtist(track?.title || "");
  if (titleArtist) return titleArtist;
  return normalizeArtistName(track?.channelTitle || "");
}

function getLikelyArtist(title) {
  const normalized = normalizeSongTitle(title);
  const separators = [" - ", " – ", " — ", "_", "|"];
  for (const separator of separators) {
    const [artist] = normalized.split(separator).map((part) => part.trim()).filter(Boolean);
    if (artist) return artist;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words[0] : normalized;
}

function normalizeArtistName(value) {
  return normalizeSongTitle(value)
    .replace(/\b(?:official|topic|vevo|youtube|music|channel)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pushHistory(history, track) {
  const incomingTitleKey = getSongTitleKey(track.title);
  const incomingArtistTitleKey = getArtistTitleKey(track.title);
  const next = history.filter((item) => {
    if (item.id === track.id) return false;
    if (incomingTitleKey && getSongTitleKey(item.title) === incomingTitleKey) return false;
    if (incomingArtistTitleKey && getArtistTitleKey(item.title) === incomingArtistTitleKey) return false;
    return true;
  });
  next.push(track);
  return next.slice(-HISTORY_LIMIT);
}

function createHistoryContext(history = [], negativeHistory = [], queuedTracks = []) {
  const ids = new Set();
  const titleKeys = new Set();
  const artistTitleKeys = new Set();
  const negativeIds = new Set();
  const negativeTitleKeys = new Set();
  const negativeArtistTitleKeys = new Set();
  const songCoreKeys = new Set();
  const negativeSongCoreKeys = new Set();
  const queuedTitleKeys = new Set();
  const queuedArtistTitleKeys = new Set();
  const queuedSongCoreKeys = new Set();
  const queuedIds = new Set();

  for (const track of history) {
    const id = track?.id || extractVideoId(track?.url || "");
    if (id) ids.add(id);

    const titleKey = getSongTitleKey(track?.title || "");
    if (titleKey) titleKeys.add(titleKey);

    const artistTitleKey = getArtistTitleKey(track?.title || "");
    if (artistTitleKey) artistTitleKeys.add(artistTitleKey);

    for (const songCoreKey of getSongCoreKeys(track?.title || "")) {
      songCoreKeys.add(songCoreKey);
    }
  }

  for (const track of negativeHistory) {
    const id = track?.id || extractVideoId(track?.url || "");
    if (id) negativeIds.add(id);

    const titleKey = getSongTitleKey(track?.title || "");
    if (titleKey) negativeTitleKeys.add(titleKey);

    const artistTitleKey = getArtistTitleKey(track?.title || "");
    if (artistTitleKey) negativeArtistTitleKeys.add(artistTitleKey);

    for (const songCoreKey of getSongCoreKeys(track?.title || "")) {
      negativeSongCoreKeys.add(songCoreKey);
    }
  }

  for (const track of queuedTracks) {
    const id = track?.id || extractVideoId(track?.url || "");
    if (id) queuedIds.add(id);

    const titleKey = getSongTitleKey(track?.title || "");
    if (titleKey) queuedTitleKeys.add(titleKey);

    const artistTitleKey = getArtistTitleKey(track?.title || "");
    if (artistTitleKey) queuedArtistTitleKeys.add(artistTitleKey);

    for (const songCoreKey of getSongCoreKeys(track?.title || "")) {
      queuedSongCoreKeys.add(songCoreKey);
    }
  }

  return {
    ids,
    titleKeys,
    artistTitleKeys,
    songCoreKeys,
    negativeIds,
    negativeTitleKeys,
    negativeArtistTitleKeys,
    negativeSongCoreKeys,
    queuedIds,
    queuedTitleKeys,
    queuedArtistTitleKeys,
    queuedSongCoreKeys,
  };
}

function normalizeHistoryContext(context) {
  if (context instanceof Set) {
    return {
      ids: context,
      titleKeys: new Set(),
      artistTitleKeys: new Set(),
      negativeIds: new Set(),
      negativeTitleKeys: new Set(),
      negativeArtistTitleKeys: new Set(),
      negativeSongCoreKeys: new Set(),
      queuedIds: new Set(),
      queuedTitleKeys: new Set(),
      queuedArtistTitleKeys: new Set(),
      queuedSongCoreKeys: new Set(),
    };
  }

  return {
    ids: context.ids || new Set(),
    titleKeys: context.titleKeys || new Set(),
    artistTitleKeys: context.artistTitleKeys || new Set(),
    songCoreKeys: context.songCoreKeys || new Set(),
    negativeIds: context.negativeIds || new Set(),
    negativeTitleKeys: context.negativeTitleKeys || new Set(),
    negativeArtistTitleKeys: context.negativeArtistTitleKeys || new Set(),
    negativeSongCoreKeys: context.negativeSongCoreKeys || new Set(),
    queuedIds: context.queuedIds || new Set(),
    queuedTitleKeys: context.queuedTitleKeys || new Set(),
    queuedArtistTitleKeys: context.queuedArtistTitleKeys || new Set(),
    queuedSongCoreKeys: context.queuedSongCoreKeys || new Set(),
  };
}

function getHardExcludeReason(track, context = createHistoryContext()) {
  const historyContext = normalizeHistoryContext(context);
  if (!track.url || !track.id) return "missing_url_or_id";
  if (historyContext.ids.has(track.id)) return "recent_video_id";
  if (historyContext.queuedIds.has(track.id)) return "already_queued";
  if (historyContext.negativeIds.has(track.id)) return "negative_video_id";
  if (track.durationSeconds && track.durationSeconds > MAX_TRACK_DURATION_SECONDS) return "too_long";
  if (track.durationSeconds && track.durationSeconds < MIN_TRACK_DURATION_SECONDS) return "too_short";

  const title = track.title.toLocaleLowerCase("ko-KR");
  const blocked = ["광고", "advertisement", "commercial", "trailer", "teaser", "shorts"];
  const blockedMatch = blocked.find((word) => title.includes(word));
  if (blockedMatch) return `blocked_${blockedMatch}`;

  const titleKey = getSongTitleKey(track.title);
  const artistTitleKey = getArtistTitleKey(track.title);
  if (titleKey && historyContext.titleKeys.has(titleKey)) return "duplicate_title";
  if (titleKey && historyContext.queuedTitleKeys.has(titleKey)) return "already_queued_title";
  if (titleKey && historyContext.negativeTitleKeys.has(titleKey)) return "negative_title";
  if (artistTitleKey && historyContext.artistTitleKeys.has(artistTitleKey)) return "duplicate_artist_title";
  if (artistTitleKey && historyContext.queuedArtistTitleKeys.has(artistTitleKey)) return "already_queued_artist_title";
  if (artistTitleKey && historyContext.negativeArtistTitleKeys.has(artistTitleKey)) return "negative_artist_title";

  for (const songCoreKey of getSongCoreKeys(track.title)) {
    if (historyContext.songCoreKeys.has(songCoreKey)) return "duplicate_song_core";
    if (historyContext.queuedSongCoreKeys.has(songCoreKey)) return "already_queued_song_core";
    if (historyContext.negativeSongCoreKeys.has(songCoreKey)) return "negative_song_core";
  }

  return null;
}

function scoreCandidate(track, context = createHistoryContext(), seedTrack = null) {
  const hardExcludeReason = getHardExcludeReason(track, context);
  if (hardExcludeReason) return { score: -9999, excluded: true, reason: hardExcludeReason };

  let score = 0;
  const title = String(track.title || "").toLocaleLowerCase("ko-KR");
  if (/official audio/.test(title)) score += 50;
  if (/official mv|official video|\bm\/v\b|\bmv\b/.test(title)) score += 40;
  if (/topic/.test(title)) score += 35;
  if (/official/.test(title)) score += 30;
  if (track.channelTitle && seedTrack && getLikelyArtist(seedTrack.title) && track.channelTitle.toLocaleLowerCase("ko-KR").includes(getLikelyArtist(seedTrack.title))) score += 25;
  if (track.categoryId === "10") score += 15;
  if (track.embeddable === false) score -= 100;
  if (track.durationSeconds >= 120 && track.durationSeconds <= 420) score += 20;
  if (seedTrack && getLikelyArtist(seedTrack.title) && title.includes(getLikelyArtist(seedTrack.title))) score += 15;

  if (/cover|커버/.test(title)) score -= 45;
  if (/live|라이브|stage|performance|직캠|fancam/.test(title)) score -= 30;
  if (/karaoke|노래방/.test(title)) score -= 50;
  if (/lyrics?|가사|자막/.test(title)) score -= 20;
  if (/remix|sped up|slowed|nightcore/.test(title)) score -= 25;
  if (/instrumental|inst\.?/.test(title)) score -= 40;
  if (/reaction/.test(title)) score -= 50;
  if (isCoverOrDerivativeTitle(title)) score -= 20;

  return { score, excluded: false, reason: "scored" };
}

function scoreCandidates(tracks, context = createHistoryContext(), seedTrack = null, source = "unknown", debug = null) {
  return tracks.map((track) => {
    const result = scoreCandidate(track, context, seedTrack);
    const item = { track, source, ...result };
    if (debug) {
      debug.candidates.push({
        id: track.id,
        title: track.title,
        source,
        score: result.score,
        excluded: result.excluded,
        reason: result.reason,
      });
      debug.events.push(result.excluded ? "candidate_excluded" : "candidate_scored");
    }
    return item;
  });
}

function takeTopCandidates(candidates, limit = 2) {
  const selected = [];
  const selectedIds = new Set();
  const selectedTitleKeys = new Set();
  const selectedArtistTitleKeys = new Set();
  const selectedSongCoreKeys = new Set();

  for (const item of candidates
    .filter((item) => !item.excluded && item.score > -40)
    .sort((a, b) => b.score - a.score)) {
    const track = item.track || {};
    const id = track.id || extractVideoId(track.url || "");
    const titleKey = getSongTitleKey(track.title || "");
    const artistTitleKey = getArtistTitleKey(track.title || "");
    const songCoreKeys = getSongCoreKeys(track.title || "");

    if (id && selectedIds.has(id)) continue;
    if (titleKey && selectedTitleKeys.has(titleKey)) continue;
    if (artistTitleKey && selectedArtistTitleKeys.has(artistTitleKey)) continue;
    if ([...songCoreKeys].some((key) => selectedSongCoreKeys.has(key))) continue;

    selected.push(item);
    if (id) selectedIds.add(id);
    if (titleKey) selectedTitleKeys.add(titleKey);
    if (artistTitleKey) selectedArtistTitleKeys.add(artistTitleKey);
    for (const key of songCoreKeys) selectedSongCoreKeys.add(key);

    if (selected.length >= limit) break;
  }

  return selected;
}

function createAutoplayDebug(seedTrack = null) {
  return {
    at: new Date().toISOString(),
    seed: seedTrack ? { id: seedTrack.id, title: seedTrack.title, url: seedTrack.url } : null,
    events: [],
    candidates: [],
  };
}

function readCache(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(cache, key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function getSongTitleKey(title) {
  return normalizeSongTitle(title).replace(/[^0-9a-z가-힣]/g, "");
}

function getSongCoreKeys(title) {
  const raw = String(title || "").toLocaleLowerCase("ko-KR");
  const withoutDecorativeBrackets = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/【[^】]*】/g, " ");
  const normalized = normalizeSongTitle(withoutDecorativeBrackets);
  const keys = new Set();
  const separatorParts = normalized
    .split(/\s+(?:-|–|—)\s+|[_|:]+/)
    .map((part) => normalizeSongCorePhrase(part))
    .filter(Boolean);

  const songParts = separatorParts.length >= 2 ? separatorParts.slice(1) : separatorParts;
  for (const part of songParts) addSongCoreKey(keys, part);

  if (separatorParts.length === 1) {
    const words = separatorParts[0].split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 8) {
      addSongCoreKey(keys, words.slice(1).join(" "));
    }
  }

  const firstSeparatorIndex = findFirstSongSeparatorIndex(raw);
  if (firstSeparatorIndex >= 0) {
    for (const match of raw.matchAll(/\(([^)]*)\)/g)) {
      if (match.index <= firstSeparatorIndex) continue;
      const phrase = normalizeSongCorePhrase(match[1]);
      if (phrase) addSongCoreKey(keys, phrase);
    }
  }

  return keys;
}

function addSongCoreKey(keys, phrase) {
  const key = normalizeSongCorePhrase(phrase).replace(/[^0-9a-z가-힣]/g, "");
  if (!key) return;
  if (key.length < 5 && !/[가-힣]{2,}/.test(key)) return;
  keys.add(key);
}

function normalizeSongCorePhrase(phrase) {
  return normalizeSongTitle(phrase)
    .replace(/\b(?:feat|ft|featuring|with)\b.*$/g, " ")
    .replace(/\b(?:part|pt)\.?\s*\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findFirstSongSeparatorIndex(title) {
  const indexes = [" - ", " – ", " — ", "_", "|", ":"]
    .map((separator) => title.indexOf(separator))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function getArtistTitleKey(title) {
  const normalized = normalizeSongTitle(title);
  const separators = [" - ", " – ", " — ", "_", "|"];
  for (const separator of separators) {
    const parts = normalized.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts.slice(0, 2).join(" ").replace(/[^0-9a-z가-힣]/g, "");
    }
  }
  return "";
}

function normalizeSongTitle(title) {
  return String(title || "")
    .toLocaleLowerCase("ko-KR")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/【[^】]*】/g, " ")
    .replace(/(official|music|video|mv|m\/v|audio|lyric video|lyrics?|color coded|가사|한글자막|자막|라이브|live|clip|stage|performance|cover|remaster(?:ed)?|hd|4k)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCoverOrDerivativeTitle(title) {
  const normalized = String(title || "").toLocaleLowerCase("ko-KR");
  const blockedPatterns = [
    /cover/,
    /covered by/,
    /cover by/,
    /커버/,
    /불러보았다/,
    /불러봤/,
    /노래방/,
    /karaoke/,
    /instrumental/,
    /inst\.?/,
    /piano/,
    /guitar/,
    /remix/,
    /sped up/,
    /slowed/,
    /nightcore/,
    /reaction/,
    /dance practice/,
    /choreography/,
    /안무/,
    /lyrics?/,
    /lyric video/,
    /가사/,
    /한글자막/,
    /자막/,
    /live/,
    /라이브/,
    /stage/,
    /performance/,
    /직캠/,
    /fancam/,
    /fan cam/,
  ];
  return blockedPatterns.some((pattern) => pattern.test(normalized));
}

function isOriginalLeaningTitle(title) {
  const normalized = String(title || "").toLocaleLowerCase("ko-KR");
  const originalSignals = [
    /official/,
    /\bofficial audio\b/,
    /\bofficial video\b/,
    /\bofficial mv\b/,
    /\bm\/v\b/,
    /\bmv\b/,
    /music video/,
    /topic/,
    /provided to youtube/,
    /auto-generated by youtube/,
  ];

  if (originalSignals.some((pattern) => pattern.test(normalized))) return true;
  return false;
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1);
    return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

module.exports = {
  buildYoutubeDlOptions,
  createYoutubeDl,
  createTrackStream,
  extractVideoId,
  getAutoplayTrack,
  getAutoplayTrackWithContext,
  getAutoplayCandidatesWithContext,
  getTrackFromUrl,
  createHistoryContext,
  getArtistTitleKey,
  getLikelyArtist,
  getLikelyArtistFromTrack,
  getSongCoreKeys,
  getSongTitleKey,
  buildAutoplaySearchQueries,
  isAutoplayCandidate,
  isCoverOrDerivativeTitle,
  isOriginalLeaningTitle,
  isSafeAutoplayCandidate,
  isTrackCandidate,
  isYouTubeUrl,
  getHardExcludeReason,
  normalizeSongTitle,
  normalizeVideo,
  normalizeHistoryContext,
  pickAutoplayCandidate,
  pickRelaxedAutoplayCandidate,
  pushHistory,
  resolveTrack,
  resolveYoutubeDlBinaryPath,
  safeYoutubeSearch,
  scoreCandidate,
  scoreCandidates,
  searchAutoplayVideos,
  takeTopCandidates,
};
