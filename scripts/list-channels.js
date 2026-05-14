const path = require("node:path");

const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), ".env.example"), override: false });

const discordToken = process.env.DISCORD_TOKEN;

if (!discordToken) {
  console.error("Missing required environment variable: DISCORD_TOKEN");
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const guilds = await discord("/users/@me/guilds");
  for (const guild of guilds) {
    console.log(`${guild.name} (${guild.id})`);
    const channels = await discord(`/guilds/${guild.id}/channels`);
    channels
      .filter((channel) => channel.type === 0)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .forEach((channel) => {
        console.log(`- #${channel.name} (${channel.id})`);
      });
  }
}

async function discord(pathname) {
  const response = await fetch(`https://discord.com/api/v10${pathname}`, {
    headers: {
      Authorization: `Bot ${discordToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API failed: ${response.status} ${text}`);
  }

  return response.json();
}
