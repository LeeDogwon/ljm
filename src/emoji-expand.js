const CUSTOM_EMOJI_PATTERN = /<(?<animated>a?):(?<name>[A-Za-z0-9_]{2,32}):(?<id>\d{17,22})>/g;
const MAX_AUTO_EXPAND_EMOJIS = 3;

function parseCustomEmojiOnly(content, limit = MAX_AUTO_EXPAND_EMOJIS) {
  if (!content || !content.trim()) return [];

  const emojis = [];
  let remainder = content;
  for (const match of content.matchAll(CUSTOM_EMOJI_PATTERN)) {
    const emoji = {
      animated: match.groups.animated === "a",
      id: match.groups.id,
      name: match.groups.name,
      raw: match[0],
    };
    emojis.push(emoji);
    remainder = remainder.replace(match[0], "");
  }

  if (!emojis.length || remainder.trim()) return [];

  return emojis.slice(0, limit);
}

function buildEmojiImageUrl(emoji) {
  if (emoji.animated) {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.webp?animated=true&size=512`;
  }

  return `https://cdn.discordapp.com/emojis/${emoji.id}.webp?size=512`;
}

function buildEmojiEmbeds(emojis) {
  return emojis.map((emoji) => ({
    image: {
      url: buildEmojiImageUrl(emoji),
    },
  }));
}

async function autoExpandCustomEmojiMessage(message, { isAllowedChannel = () => true } = {}) {
  if (message.author?.bot) return false;
  if (message.webhookId) return false;
  if (!message.guild) return false;
  if (!message.content) return false;
  if (!isAllowedChannel(message.channelId)) return false;

  const emojis = parseCustomEmojiOnly(message.content);
  if (!emojis.length) return false;

  try {
    await message.channel.send({ embeds: buildEmojiEmbeds(emojis) });
  } catch (error) {
    console.error("Failed to auto-expand custom emoji:", error);
    return true;
  }

  try {
    await message.delete();
  } catch (error) {
    console.warn("Failed to delete original custom emoji message:", error);
  }

  return true;
}

module.exports = {
  MAX_AUTO_EXPAND_EMOJIS,
  autoExpandCustomEmojiMessage,
  buildEmojiEmbeds,
  buildEmojiImageUrl,
  parseCustomEmojiOnly,
};
