const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LASTFM_API_URL,
  buildYouTubeQuery,
  getSimilarTracks,
  isLastFmConfigured,
  normalizeSimilarTracks,
  parseTrackArtistAndTitle,
  resolveLastFmApiKey,
} = require("../src/lastfm-service");

test("resolves Last.fm configuration from environment", () => {
  assert.equal(resolveLastFmApiKey({ LASTFM_API_KEY: "lastfm-key" }), "lastfm-key");
  assert.equal(resolveLastFmApiKey({}), "");
  assert.equal(isLastFmConfigured({ LASTFM_API_KEY: "lastfm-key" }), true);
  assert.equal(isLastFmConfigured({}), false);
});

test("parses artist and title from YouTube-style music titles", () => {
  assert.deepEqual(parseTrackArtistAndTitle({ title: "IU - Blueming Official MV" }), {
    artist: "IU",
    title: "Blueming",
  });
  assert.deepEqual(parseTrackArtistAndTitle({ title: "Blueming", channelTitle: "IU Official YouTube Channel" }), {
    artist: "IU",
    title: "Blueming",
  });
});

test("normalizes Last.fm similar tracks into YouTube search queries", () => {
  assert.equal(buildYouTubeQuery("IU", "Celebrity"), "IU Celebrity official audio");
  assert.deepEqual(
    normalizeSimilarTracks({
      similartracks: {
        track: [
          {
            name: "Celebrity",
            artist: { name: "IU" },
            match: "0.92",
            url: "https://www.last.fm/music/IU/_/Celebrity",
          },
        ],
      },
    }),
    [
      {
        artist: "IU",
        title: "Celebrity",
        match: 0.92,
        url: "https://www.last.fm/music/IU/_/Celebrity",
        query: "IU Celebrity official audio",
      },
    ],
  );
});

test("calls Last.fm track.getSimilar with the current song", async () => {
  const calls = [];
  const tracks = await getSimilarTracks(
    { title: "IU - Blueming Official MV" },
    {
      env: { LASTFM_API_KEY: "test-key", LASTFM_SIMILAR_LIMIT: "10" },
      fetch: async (url) => {
        calls.push(url);
        return {
          ok: true,
          async json() {
            return {
              similartracks: {
                track: [{ name: "Celebrity", artist: { name: "IU" }, match: "0.9" }],
              },
            };
          },
        };
      },
    },
  );

  const url = calls[0];
  assert.equal(url.origin + url.pathname, LASTFM_API_URL);
  assert.equal(url.searchParams.get("method"), "track.getSimilar");
  assert.equal(url.searchParams.get("artist"), "IU");
  assert.equal(url.searchParams.get("track"), "Blueming");
  assert.equal(url.searchParams.get("api_key"), "test-key");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(tracks[0].query, "IU Celebrity official audio");
});
