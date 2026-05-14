const assert = require("node:assert/strict");
const test = require("node:test");

const {
  autoExpandCustomEmojiMessage,
  buildEmojiImageUrl,
  parseCustomEmojiOnly,
} = require("../src/emoji-expand");

function makeMessage(overrides = {}) {
  const events = [];
  return {
    author: { bot: false },
    channelId: "allowed-channel",
    content: "<:party:123456789012345678>",
    guild: { id: "guild-id" },
    webhookId: null,
    channel: {
      async send(payload) {
        events.push("send");
        return payload;
      },
    },
    async delete() {
      events.push("delete");
    },
    events,
    ...overrides,
  };
}

test("parses only custom emoji and whitespace", () => {
  assert.deepEqual(parseCustomEmojiOnly(" <:party:123456789012345678> "), [
    {
      animated: false,
      id: "123456789012345678",
      name: "party",
      raw: "<:party:123456789012345678>",
    },
  ]);
  assert.equal(parseCustomEmojiOnly("text <:party:123456789012345678>").length, 0);
  assert.equal(parseCustomEmojiOnly("😀").length, 0);
});

test("limits auto-expanded emojis to three", () => {
  const emojis = parseCustomEmojiOnly(
    "<:a1:123456789012345671> <:a2:123456789012345672> <:a3:123456789012345673> <:a4:123456789012345674>",
  );
  assert.equal(emojis.length, 3);
});

test("builds the requested static and animated CDN URLs", () => {
  assert.equal(
    buildEmojiImageUrl({ animated: false, id: "123456789012345678" }),
    "https://cdn.discordapp.com/emojis/123456789012345678.webp?size=512",
  );
  assert.equal(
    buildEmojiImageUrl({ animated: true, id: "123456789012345678" }),
    "https://cdn.discordapp.com/emojis/123456789012345678.webp?animated=true&size=512",
  );
});

test("sends the large emoji, then deletes the original emoji-only message", async () => {
  const sentPayloads = [];
  const message = makeMessage({
    channel: {
      async send(payload) {
        message.events.push("send");
        sentPayloads.push(payload);
        return payload;
      },
    },
  });

  const handled = await autoExpandCustomEmojiMessage(message, {
    isAllowedChannel: (channelId) => channelId === "allowed-channel",
  });

  assert.equal(handled, true);
  assert.deepEqual(message.events, ["send", "delete"]);
  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads[0], {
    embeds: [
      {
        image: {
          url: "https://cdn.discordapp.com/emojis/123456789012345678.webp?size=512",
        },
      },
    ],
  });
});

test("does not delete the original message if large emoji send fails", async () => {
  const message = makeMessage({
    channel: {
      async send() {
        message.events.push("send");
        throw new Error("send failed");
      },
    },
  });

  const handled = await autoExpandCustomEmojiMessage(message);

  assert.equal(handled, true);
  assert.deepEqual(message.events, ["send"]);
});

test("does not crash when deleting the original message fails", async () => {
  const message = makeMessage({
    async delete() {
      message.events.push("delete");
      throw new Error("missing permissions");
    },
  });

  const handled = await autoExpandCustomEmojiMessage(message);

  assert.equal(handled, true);
  assert.deepEqual(message.events, ["send", "delete"]);
});

test("ignores bots, webhooks, DMs, empty content, blocked channels, and mixed text", async () => {
  const cases = [
    makeMessage({ author: { bot: true } }),
    makeMessage({ webhookId: "webhook-id" }),
    makeMessage({ guild: null }),
    makeMessage({ content: "" }),
    makeMessage({ channelId: "blocked-channel" }),
    makeMessage({ content: "hello <:party:123456789012345678>" }),
  ];

  for (const message of cases) {
    const handled = await autoExpandCustomEmojiMessage(message, {
      isAllowedChannel: (channelId) => channelId === "allowed-channel",
    });
    assert.equal(handled, false);
    assert.deepEqual(message.events, []);
  }
});
