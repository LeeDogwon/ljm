const assert = require("node:assert/strict");
const test = require("node:test");

const { GuildMusicState, buildNowPlayingEmbed, buildStatusEmbed, formatDuration, formatQueue } = require("../src/music-player");

test("skip does not add the current track to negative history", () => {
  const state = new GuildMusicState("guild");
  state.current = { id: "song1", title: "Song 1", url: "https://www.youtube.com/watch?v=song1" };

  assert.equal(state.skip(), true);
  assert.equal(state.negativeHistory.length, 0);
  assert.equal(state.pendingFeedbackType, "skip");
  state.player.stop(true);
});

test("next adds the current track to negative history", () => {
  const state = new GuildMusicState("guild");
  state.current = { id: "song1", title: "Song 1", url: "https://www.youtube.com/watch?v=song1" };

  assert.equal(state.next(), true);
  assert.equal(state.negativeHistory.length, 1);
  assert.equal(state.negativeHistory[0].id, "song1");
  assert.equal(state.pendingFeedbackType, "next");
  state.player.stop(true);
});

test("autoplay seed ignores negative current and uses recent good history", () => {
  const state = new GuildMusicState("guild");
  const good = { id: "good", title: "Good", url: "https://www.youtube.com/watch?v=good" };
  const bad = { id: "bad", title: "Bad", url: "https://www.youtube.com/watch?v=bad" };
  state.history = [good, bad];
  state.current = bad;
  state.addNegativeTrack(bad);

  assert.equal(state.getAutoplaySeed().id, "good");
  state.player.stop(true);
});

test("queue output shows next negative history count", () => {
  const state = new GuildMusicState("guild");
  state.negativeHistory = [{ id: "bad", title: "Bad" }];
  const text = formatQueue(state);

  assert.match(text, /next 제외 기록: 1곡/);
  state.player.stop(true);
});

test("supports queue convenience operations", () => {
  const state = new GuildMusicState("guild");
  state.queue = [
    { id: "one", title: "One" },
    { id: "two", title: "Two" },
    { id: "three", title: "Three" },
  ];

  assert.equal(state.removeFromQueue(2).id, "two");
  assert.deepEqual(state.queue.map((track) => track.id), ["one", "three"]);
  assert.equal(state.removeFromQueue(9), null);
  state.autoplayQueue = [{ id: "auto", title: "Auto" }];
  assert.equal(state.removeAutoplayQueue(1).id, "auto");
  assert.equal(state.removeAutoplayQueue(1), null);
  assert.equal(state.shuffleQueue(), true);
  assert.equal(state.clearQueue(), 2);
  assert.equal(state.queue.length, 0);
  assert.equal(state.shuffleQueue(), false);
  state.player.stop(true);
});

test("can move an autoplay queued track to play next immediately", async () => {
  const state = new GuildMusicState("guild");
  state.current = { id: "current", title: "Current", url: "https://www.youtube.com/watch?v=current" };
  state.playing = true;
  state.autoplayQueue = [
    { id: "auto1", title: "Auto 1", url: "https://www.youtube.com/watch?v=auto1" },
    { id: "auto2", title: "Auto 2", url: "https://www.youtube.com/watch?v=auto2" },
  ];

  const track = await state.playQueueIndexNow(2, "autoplay");

  assert.equal(track.id, "auto2");
  assert.equal(state.queue[0].id, "auto2");
  assert.equal(state.queue[0].requestedBy, "YouTube autoplay");
  assert.deepEqual(state.autoplayQueue.map((item) => item.id), ["auto1"]);
  assert.equal(state.pendingFeedbackType, "skip");
  state.player.stop(true);
});

test("can move a queued track to play next immediately", async () => {
  const state = new GuildMusicState("guild");
  state.current = { id: "current", title: "Current", url: "https://www.youtube.com/watch?v=current" };
  state.playing = true;
  state.queue = [
    { id: "one", title: "One", url: "https://www.youtube.com/watch?v=one" },
    { id: "two", title: "Two", url: "https://www.youtube.com/watch?v=two" },
  ];

  const track = await state.playQueueIndexNow(2);

  assert.equal(track.id, "two");
  assert.equal(state.queue[0].id, "two");
  assert.equal(state.pendingFeedbackType, "skip");
  state.player.stop(true);
});

test("stop clears playback and destroys the voice connection", () => {
  const state = new GuildMusicState("guild");
  let destroyed = false;
  state.connection = {
    destroy() {
      destroyed = true;
    },
  };
  state.current = { id: "song", title: "Song" };
  state.queue = [{ id: "next", title: "Next" }];
  state.autoplayQueue = [{ id: "auto", title: "Auto" }];

  state.stop();

  assert.equal(destroyed, true);
  assert.equal(state.connection, null);
  assert.equal(state.current, null);
  assert.equal(state.queue.length, 0);
  assert.equal(state.autoplayQueue.length, 0);
  state.player.stop(true);
});

test("formats durations and status embeds", () => {
  const state = new GuildMusicState("guild");
  state.current = {
    id: "song1",
    title: "Song 1",
    url: "https://www.youtube.com/watch?v=song1",
    durationSeconds: 205,
    requestedBy: "tester",
  };

  assert.equal(formatDuration(205), "3:25");
  assert.equal(formatDuration(0), "길이 정보 없음");
  assert.equal(buildNowPlayingEmbed(state).toJSON().title, "재생 시작");
  assert.equal(buildStatusEmbed(state).toJSON().title, "재생 상태");
  state.player.stop(true);
});

test("records playback feedback type in history", () => {
  const state = new GuildMusicState("guild");
  state.current = { id: "song1", title: "Song 1", url: "https://www.youtube.com/watch?v=song1" };
  state.history = [{ ...state.current, feedback_type: "playing" }];

  state.recordCurrentFeedback("finished");

  assert.equal(state.history[0].feedback_type, "finished");
  state.player.stop(true);
});

test("autoplay debug includes queue and candidate data", () => {
  const state = new GuildMusicState("guild");
  state.autoplayQueue = [{ id: "auto", title: "Auto", url: "https://www.youtube.com/watch?v=auto" }];
  state.lastAutoplayDebug = {
    events: ["related_success", "candidate_scored", "final_selected"],
    candidates: [{ title: "Auto", source: "related", score: 50, excluded: false, reason: "scored" }],
  };

  const text = state.formatAutoplayDebug();

  assert.match(text, /autoplayQueue: 1\. Auto/);
  assert.match(text, /related_success/);
  assert.match(text, /score=50/);
  state.player.stop(true);
});
