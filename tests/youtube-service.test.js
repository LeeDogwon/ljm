const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAutoplaySearchQueries,
  buildYoutubeDlOptions,
  createHistoryContext,
  extractVideoId,
  getAutoplayTrackWithContext,
  getLikelyArtist,
  getLikelyArtistFromTrack,
  getSongCoreKeys,
  getSongTitleKey,
  getHardExcludeReason,
  isAutoplayCandidate,
  isCoverOrDerivativeTitle,
  isOriginalLeaningTitle,
  isSafeAutoplayCandidate,
  isTrackCandidate,
  isYouTubeUrl,
  normalizeSongTitle,
  normalizeVideo,
  pickAutoplayCandidate,
  pickRelaxedAutoplayCandidate,
  pushHistory,
  resolveYoutubeDlBinaryPath,
  scoreCandidate,
  takeTopCandidates,
} = require("../src/youtube-service");

test("prefers explicit yt-dlp binary path from environment", () => {
  assert.equal(
    resolveYoutubeDlBinaryPath({ YOUTUBE_DL_BINARY_PATH: "/custom/yt-dlp" }),
    "/custom/yt-dlp",
  );
});

test("adds optional yt-dlp runtime options from environment", () => {
  assert.deepEqual(
    buildYoutubeDlOptions(
      { quiet: true },
      {
        YOUTUBE_COOKIES_FILE: "/tmp/cookies.txt",
        YOUTUBE_DLP_EXTRACTOR_ARGS: "youtube:player_client=android",
      },
    ),
    {
      quiet: true,
      cookies: "/tmp/cookies.txt",
      extractorArgs: "youtube:player_client=android",
    },
  );
});

test("does not add a default cookie file when the file does not exist", () => {
  assert.deepEqual(buildYoutubeDlOptions({ quiet: true }, {}), { quiet: true });
});

test("detects YouTube and YouTube Music URLs", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeUrl("https://music.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeUrl("https://youtu.be/abc"), true);
  assert.equal(isYouTubeUrl("https://example.com/watch?v=abc"), false);
});

test("normalizes search and related video shapes", () => {
  assert.deepEqual(
    normalizeVideo({
      id: "abc123",
      title: "Track",
      url: "https://www.youtube.com/watch?v=abc123",
      durationInSec: 180,
    }),
    {
      id: "abc123",
      title: "Track",
      url: "https://www.youtube.com/watch?v=abc123",
      durationSeconds: 180,
      requestedBy: null,
      channelTitle: "",
      categoryId: "",
      viewCount: 0,
      embeddable: undefined,
    },
  );
});

test("filters repeated and non-music autoplay candidates", () => {
  assert.equal(
    isTrackCandidate(
      {
        id: "seen",
        title: "Song",
        url: "https://www.youtube.com/watch?v=seen",
        durationSeconds: 180,
      },
      new Set(["seen"]),
    ),
    false,
  );
  assert.equal(
    isTrackCandidate(
      {
        id: "ad",
        title: "Brand advertisement",
        url: "https://www.youtube.com/watch?v=ad",
        durationSeconds: 30,
      },
      new Set(),
    ),
    false,
  );
});

test("normalizes common alternate video titles for the same song", () => {
  assert.equal(normalizeSongTitle("[MV] IU(아이유) _ Blueming(블루밍)"), "iu _ blueming");
  assert.equal(getSongTitleKey("[MV] IU(아이유) _ Blueming(블루밍)"), "iublueming");
  assert.equal(getSongTitleKey("IU - Blueming Lyrics 가사"), "iublueming");
});

test("filters same song even when the video id differs", () => {
  const context = createHistoryContext([
    {
      id: "first",
      title: "[MV] IU(아이유) _ Blueming(블루밍)",
      url: "https://www.youtube.com/watch?v=first",
    },
  ]);

  assert.equal(
    isTrackCandidate(
      {
        id: "second",
        title: "IU - Blueming Lyrics 가사",
        url: "https://www.youtube.com/watch?v=second",
        durationSeconds: 231,
      },
      context,
    ),
    false,
  );
});

test("filters alternate language and version uploads of the same song", () => {
  const context = createHistoryContext([
    {
      id: "first",
      title: "[MV] IU(아이유) _ Blueming(블루밍)",
      url: "https://www.youtube.com/watch?v=first",
    },
  ]);

  assert.deepEqual([...getSongCoreKeys("[MV] IU(아이유) _ Blueming(블루밍)")].sort(), ["blueming", "블루밍"]);
  assert.equal(
    getHardExcludeReason({
      id: "live",
      title: "아이유 - 블루밍 Live Stage",
      url: "https://www.youtube.com/watch?v=live",
      durationSeconds: 231,
    }, context),
    "duplicate_song_core",
  );
});

test("filters same-song variants already waiting in autoplay queue", () => {
  const context = createHistoryContext(
    [],
    [],
    [
      {
        id: "queued",
        title: "NewJeans - Ditto Official MV",
        url: "https://www.youtube.com/watch?v=queued",
      },
    ],
  );

  assert.equal(
    getHardExcludeReason({
      id: "queued2",
      title: "NewJeans - Ditto Lyrics",
      url: "https://www.youtube.com/watch?v=queued2",
      durationSeconds: 190,
    }, context),
    "already_queued_title",
  );
});

test("does not select same-song variants from the same candidate batch", () => {
  const candidates = [
    {
      track: {
        id: "mv",
        title: "NewJeans - Ditto Official MV",
        url: "https://www.youtube.com/watch?v=mv",
      },
      score: 80,
      excluded: false,
    },
    {
      track: {
        id: "lyrics",
        title: "NewJeans - Ditto Lyrics",
        url: "https://www.youtube.com/watch?v=lyrics",
      },
      score: 75,
      excluded: false,
    },
    {
      track: {
        id: "omg",
        title: "NewJeans - OMG Official Audio",
        url: "https://www.youtube.com/watch?v=omg",
      },
      score: 70,
      excluded: false,
    },
  ];

  assert.deepEqual(takeTopCandidates(candidates, 2).map((item) => item.track.id), ["mv", "omg"]);
});

test("filters negative next history from autoplay candidates", () => {
  const context = createHistoryContext(
    [],
    [
      {
        id: "bad",
        title: "Artist - Bad Song Official Audio",
        url: "https://www.youtube.com/watch?v=bad",
      },
    ],
  );

  assert.equal(
    isTrackCandidate(
      {
        id: "bad2",
        title: "Artist - Bad Song Official MV",
        url: "https://www.youtube.com/watch?v=bad2",
        durationSeconds: 210,
      },
      context,
    ),
    false,
  );
});

test("hard excludes queued and too-short autoplay candidates", () => {
  const context = createHistoryContext([], [], [{ id: "queued" }]);
  assert.equal(
    getHardExcludeReason({
      id: "queued",
      title: "Queued",
      url: "https://www.youtube.com/watch?v=queued",
      durationSeconds: 180,
    }, context),
    "already_queued",
  );
  assert.equal(
    getHardExcludeReason({
      id: "short",
      title: "Short",
      url: "https://www.youtube.com/watch?v=short",
      durationSeconds: 30,
    }, createHistoryContext()),
    "too_short",
  );
});

test("scores official tracks above derivative tracks", () => {
  const context = createHistoryContext();
  const official = scoreCandidate({
    id: "official",
    title: "Artist - Song Official Audio",
    url: "https://www.youtube.com/watch?v=official",
    durationSeconds: 210,
  }, context, { title: "Artist - Seed" });
  const lyrics = scoreCandidate({
    id: "lyrics",
    title: "Artist - Song Lyrics",
    url: "https://www.youtube.com/watch?v=lyrics",
    durationSeconds: 210,
  }, context, { title: "Artist - Seed" });

  assert.equal(official.excluded, false);
  assert.equal(lyrics.excluded, false);
  assert.ok(official.score > lyrics.score);
  assert.equal(takeTopCandidates([{ track: { id: "a" }, ...lyrics }, { track: { id: "b" }, ...official }], 1)[0].track.id, "b");
});

test("blocks covers and derivative videos only for autoplay", () => {
  const coverTrack = {
    id: "cover",
    title: "IU - Blueming cover by singer",
    url: "https://www.youtube.com/watch?v=cover",
    durationSeconds: 230,
  };
  const originalTrack = {
    id: "original",
    title: "[MV] IU(아이유) _ Blueming(블루밍)",
    url: "https://www.youtube.com/watch?v=original",
    durationSeconds: 222,
  };

  assert.equal(isTrackCandidate(coverTrack, createHistoryContext()), true);
  assert.equal(isAutoplayCandidate(coverTrack, createHistoryContext()), false);
  assert.equal(isAutoplayCandidate(originalTrack, createHistoryContext()), true);
});

test("allows safe autoplay candidates when no explicit original signal exists", () => {
  const safeTrack = {
    id: "safe",
    title: "Artist - Next Song",
    url: "https://www.youtube.com/watch?v=safe",
    durationSeconds: 210,
  };
  const coverTrack = {
    id: "cover",
    title: "Artist - Next Song cover",
    url: "https://www.youtube.com/watch?v=cover",
    durationSeconds: 210,
  };

  assert.equal(isAutoplayCandidate(safeTrack, createHistoryContext()), false);
  assert.equal(isSafeAutoplayCandidate(safeTrack, createHistoryContext()), true);
  assert.equal(isSafeAutoplayCandidate(coverTrack, createHistoryContext()), false);
});

test("picks original candidates first and falls back to safe non-cover candidates", () => {
  const context = createHistoryContext();
  const safe = {
    id: "safe",
    title: "Artist - Safe Song",
    url: "https://www.youtube.com/watch?v=safe",
    durationSeconds: 210,
  };
  const original = {
    id: "original",
    title: "Artist - Original Song Official Audio",
    url: "https://www.youtube.com/watch?v=original",
    durationSeconds: 210,
  };

  assert.equal(pickAutoplayCandidate([safe, original], context).id, "original");
  assert.equal(pickAutoplayCandidate([safe], context).id, "safe");
});

test("relaxed autoplay candidate still rejects covers", () => {
  const context = createHistoryContext();
  const cover = {
    id: "cover",
    title: "Artist - Song cover",
    url: "https://www.youtube.com/watch?v=cover",
    durationSeconds: 210,
  };
  const safe = {
    id: "safe",
    title: "Artist - Another Song",
    url: "https://www.youtube.com/watch?v=safe",
    durationSeconds: 210,
  };

  assert.equal(pickRelaxedAutoplayCandidate([cover], context), null);
  assert.equal(pickRelaxedAutoplayCandidate([cover, safe], context).id, "safe");
});

test("builds artist-based autoplay fallback search queries without the seed song title", () => {
  assert.deepEqual(buildAutoplaySearchQueries({ title: "IU - Blueming Official MV" }), [
    "iu songs",
    "iu official audio",
    "iu topic",
    "iu popular songs",
    "iu music playlist",
    "iu similar songs",
  ]);
  assert.equal(buildAutoplaySearchQueries({ title: "IU - Blueming Official MV" }).some((query) => query.includes("blueming")), false);
  assert.equal(getLikelyArtist("NewJeans - Ditto Official MV"), "newjeans");
});

test("can derive fallback artist from channel metadata", () => {
  assert.equal(getLikelyArtistFromTrack({ title: "", channelTitle: "IU Official YouTube Channel" }), "iu");
});

test("detects cover and derivative title signals", () => {
  assert.equal(isCoverOrDerivativeTitle("NewJeans Ditto cover"), true);
  assert.equal(isCoverOrDerivativeTitle("NewJeans Ditto 가사"), true);
  assert.equal(isCoverOrDerivativeTitle("NewJeans Ditto live stage"), true);
  assert.equal(isCoverOrDerivativeTitle("NewJeans Ditto Official MV"), false);
});

test("detects original-leaning title signals", () => {
  assert.equal(isOriginalLeaningTitle("Official Audio"), true);
  assert.equal(isOriginalLeaningTitle("Artist - Song Topic"), true);
  assert.equal(isOriginalLeaningTitle("Artist - Song cover"), false);
});

test("maintains bounded playback history", () => {
  const history = Array.from({ length: 21 }, (_, index) => ({ id: String(index) }));
  const next = pushHistory(history, { id: "new" });
  assert.equal(next.length, 20);
  assert.equal(next.at(-1).id, "new");
});

test("deduplicates equivalent songs in playback history", () => {
  const next = pushHistory(
    [
      {
        id: "first",
        title: "[MV] IU(아이유) _ Blueming(블루밍)",
      },
    ],
    {
      id: "second",
      title: "IU - Blueming Lyrics 가사",
    },
  );
  assert.deepEqual(next.map((track) => track.id), ["second"]);
});

test("extracts video ids from supported URL forms", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=abc123"), "abc123");
  assert.equal(extractVideoId("https://youtu.be/xyz789"), "xyz789");
});
