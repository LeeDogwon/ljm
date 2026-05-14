const assert = require("node:assert/strict");
const test = require("node:test");

const { musicCommands } = require("../src/music-commands");
const { buildQueueComponents, buildQueueEmbed, formatQueue } = require("../src/music-player");

test("defines the music slash commands", () => {
  assert.deepEqual(
    musicCommands.map((command) => command.name),
    [
      "play",
      "autoplay",
      "skip",
      "next",
      "pause",
      "resume",
      "stop",
      "leave",
      "clear",
      "remove",
      "shuffle",
      "queue",
      "nowplaying",
      "autoplay_debug",
    ],
  );
});

test("play command requires a query option", () => {
  const play = musicCommands.find((command) => command.name === "play").toJSON();
  assert.equal(play.options[0].name, "query");
  assert.equal(play.options[0].required, true);
});

test("formats queue with autoplay state", () => {
  const text = formatQueue({
    current: {
      title: "Current",
      url: "https://www.youtube.com/watch?v=current",
    },
    queue: [{ title: "Next" }],
    autoplayEnabled: true,
  });

  assert.match(text, /현재: \[Current\]/);
  assert.match(text, /1\. Next/);
  assert.match(text, /자동재생: on/);
});

test("builds queue embed with current, manual queue, and autoplay queue", () => {
  const embed = buildQueueEmbed({
    current: {
      title: "Current",
      url: "https://www.youtube.com/watch?v=current",
      durationSeconds: 180,
    },
    queue: [{ title: "Next", url: "https://www.youtube.com/watch?v=next", durationSeconds: 200 }],
    autoplayQueue: [{ title: "Auto", url: "https://www.youtube.com/watch?v=auto", durationSeconds: 210 }],
    autoplayEnabled: true,
    negativeHistory: [],
  }).toJSON();

  assert.equal(embed.title, "재생목록");
  assert.equal(embed.fields[0].name, "현재 재생");
  assert.match(embed.fields[1].value, /Next/);
  assert.match(embed.fields[2].value, /Auto/);
  assert.match(embed.fields[3].value, /자동재생: on/);
});

test("builds compact queue select menus for manual and autoplay items", () => {
  const components = buildQueueComponents({
    queue: [
      { title: "One" },
      { title: "Two" },
      { title: "Three" },
      { title: "Four" },
      { title: "Five" },
      { title: "Six" },
    ],
    autoplayQueue: [{ title: "Auto One" }],
  }).map((row) => row.toJSON());

  assert.equal(components.length, 2);
  assert.equal(components[0].components[0].custom_id, "music:select:play");
  assert.equal(components[1].components[0].custom_id, "music:select:remove");
  assert.equal(components[0].components[0].options[0].value, "queue:1");
  assert.equal(components[0].components[0].options.at(-1).value, "autoplay:1");
});
