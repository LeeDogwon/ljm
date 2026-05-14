const { ChannelType } = require("discord.js");

function createPromptExtractor({ wakePhrase, calledOnly }) {
  return function extractPrompt(content) {
    const trimmed = content.trim();
    const lowerContent = trimmed.toLocaleLowerCase("ko-KR");
    const lowerWakePhrase = wakePhrase.toLocaleLowerCase("ko-KR");

    if (lowerContent === lowerWakePhrase) {
      return calledOnly;
    }

    if (!lowerContent.startsWith(lowerWakePhrase)) return null;

    return (
      trimmed
        .slice(wakePhrase.length)
        .replace(/^[\s,:;!?-]+/, "")
        .trim() || calledOnly
    );
  };
}

async function buildChannelContext(message, maxContextMessages) {
  if (!message.channel || maxContextMessages <= 0) return [];
  if (message.channel.type === ChannelType.DM) return [];

  const fetched = await message.channel.messages.fetch({
    limit: Math.min(maxContextMessages + 1, 50),
  });

  return Array.from(fetched.values())
    .filter((item) => item.id !== message.id)
    .filter((item) => item.content && !item.author.bot)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((item) => ({
      author: item.member?.displayName || item.author.displayName || item.author.username,
      content: item.content,
    }));
}

function getChannelName(channel) {
  if (!channel) return "unknown";
  if (channel.type === ChannelType.DM) return "DM";
  return channel.name || channel.id;
}

function splitDiscordMessage(text, emptyReply) {
  const limit = 1900;
  const normalized = text.trim() || emptyReply;
  const chunks = [];

  for (let index = 0; index < normalized.length; index += limit) {
    chunks.push(normalized.slice(index, index + limit));
  }

  return chunks;
}

module.exports = {
  buildChannelContext,
  createPromptExtractor,
  getChannelName,
  splitDiscordMessage,
};
