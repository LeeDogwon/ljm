const path = require("node:path");

const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), ".env.example"), override: false });

const discordToken = process.env.DISCORD_TOKEN;
const channelId = process.argv[2] || process.env.TEST_CHANNEL_ID;
const content = process.argv.slice(3).join(" ") || process.env.TEST_MESSAGE;

if (!discordToken) {
  console.error("Missing required environment variable: DISCORD_TOKEN");
  process.exit(1);
}

if (!channelId || !content) {
  console.error("Usage: node scripts/send-message.js <channel_id> <message>");
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${discordToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  const text = await response.text();
  console.log(response.status);
  console.log(text);

  if (!response.ok) {
    process.exit(1);
  }
}
