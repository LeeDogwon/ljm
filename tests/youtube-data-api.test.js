const assert = require("node:assert/strict");
const test = require("node:test");

const {
  YOUTUBE_SEARCH_URL,
  YOUTUBE_VIDEOS_URL,
  fetchVideoMetadata,
  isYouTubeDataApiConfigured,
  parseIsoDurationSeconds,
  readVideoMetadataCache,
  resolveYouTubeApiKey,
  searchYouTubeDataApi,
  writeVideoMetadataCache,
} = require("../src/youtube-data-api");

test("resolves YouTube API key only from dedicated env var", () => {
  assert.equal(resolveYouTubeApiKey({ YOUTUBE_API_KEY: "yt" }), "yt");
  assert.equal(resolveYouTubeApiKey({ GOOGLE_API_KEY: "google" }), "");
  assert.equal(resolveYouTubeApiKey({ GEMINI_API_KEY: "gemini" }), "");
  assert.equal(resolveYouTubeApiKey({ GOOGLE_API_KEY: "google", GEMINI_API_KEY: "gemini" }), "");
  assert.equal(isYouTubeDataApiConfigured({}), false);
});

test("calls YouTube Data API search.list with music video filters", async () => {
  const calls = [];
  const results = await searchYouTubeDataApi("artist official audio", {
    env: {
      YOUTUBE_API_KEY: "test-key",
      YOUTUBE_REGION_CODE: "KR",
      YOUTUBE_RELEVANCE_LANGUAGE: "ko",
    },
    fetch: async (url) => {
      calls.push(url);
      if (url.origin + url.pathname === YOUTUBE_VIDEOS_URL) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                {
                  id: "abc123",
                  contentDetails: { duration: "PT3M30S" },
                  statistics: { viewCount: "1000" },
                  snippet: { channelTitle: "Artist", categoryId: "10" },
                  status: { embeddable: true },
                },
              ],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: { videoId: "abc123" },
                snippet: {
                  title: "Artist - Song Official Audio",
                  channelTitle: "Artist",
                  liveBroadcastContent: "none",
                },
              },
            ],
          };
        },
      };
    },
  });

  const url = calls[0];
  const videosUrl = calls[1];
  assert.equal(url.origin + url.pathname, YOUTUBE_SEARCH_URL);
  assert.equal(url.searchParams.get("part"), "snippet");
  assert.equal(url.searchParams.get("type"), "video");
  assert.equal(url.searchParams.get("videoCategoryId"), "10");
  assert.equal(url.searchParams.get("videoEmbeddable"), "true");
  assert.equal(url.searchParams.get("q"), "artist official audio");
  assert.equal(url.searchParams.get("key"), "test-key");
  assert.equal(url.searchParams.get("regionCode"), "KR");
  assert.equal(url.searchParams.get("relevanceLanguage"), "ko");
  assert.equal(videosUrl.origin + videosUrl.pathname, YOUTUBE_VIDEOS_URL);
  assert.equal(videosUrl.searchParams.get("part"), "contentDetails,statistics,snippet,status");
  assert.equal(videosUrl.searchParams.get("id"), "abc123");
  assert.deepEqual(results, [
    {
      id: "abc123",
      title: "Artist - Song Official Audio",
      url: "https://www.youtube.com/watch?v=abc123",
      channelTitle: "Artist",
      liveBroadcastContent: "none",
      durationSeconds: 210,
      categoryId: "10",
      viewCount: 1000,
      embeddable: true,
    },
  ]);
});

test("parses ISO 8601 video durations", () => {
  assert.equal(parseIsoDurationSeconds("PT3M30S"), 210);
  assert.equal(parseIsoDurationSeconds("PT1H2M3S"), 3723);
  assert.equal(parseIsoDurationSeconds("bad"), 0);
});

test("caches videos.list metadata", async () => {
  writeVideoMetadataCache("cached", { durationSeconds: 123, categoryId: "10" });
  assert.deepEqual(readVideoMetadataCache("cached"), { durationSeconds: 123, categoryId: "10" });

  let calls = 0;
  const metadata = await fetchVideoMetadata(["cached"], {
    env: { YOUTUBE_API_KEY: "test-key" },
    fetch: async () => {
      calls += 1;
      throw new Error("should not call network for cached metadata");
    },
  });

  assert.equal(calls, 0);
  assert.equal(metadata.get("cached").durationSeconds, 123);
});
