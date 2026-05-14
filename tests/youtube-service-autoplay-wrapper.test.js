const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("getAutoplayTrack returns the selected autoplay track", async () => {
  delete process.env.LASTFM_API_KEY;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "@distube/ytdl-core") {
      return {
        getBasicInfo: async () => ({
          related_videos: [
            {
              id: "next",
              title: "Artist - Next Song Official Audio",
              url: "https://www.youtube.com/watch?v=next",
              durationSeconds: 210,
              channelTitle: "Artist",
              categoryId: "10",
              embeddable: true,
            },
          ],
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { getAutoplayTrack } = require("../src/youtube-service");
    const track = await getAutoplayTrack({
      id: "seed",
      title: "Artist - Seed Song",
      url: "https://www.youtube.com/watch?v=seed",
      durationSeconds: 210,
    });

    assert.equal(track.id, "next");
    assert.equal(track.title, "Artist - Next Song Official Audio");
  } finally {
    Module._load = originalLoad;
  }
});
