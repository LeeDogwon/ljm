const { loadRuntimeEnv, resolveDiscordToken } = require("../src/runtime-config");

loadRuntimeEnv();

const discordToken = resolveDiscordToken();
const pollMs = Number(process.env.GUILD_POLL_MS || 5000);
const maxAttempts = Number(process.env.GUILD_POLL_ATTEMPTS || 60);

if (!discordToken) {
  console.error("Missing required environment variable: DISCORD_TOKEN");
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const guilds = await fetchGuilds();
    if (guilds.length > 0) {
      console.log(`Bot is in ${guilds.length} guild(s):`);
      for (const guild of guilds) {
        console.log(`- ${guild.name} (${guild.id})`);
      }
      return;
    }

    console.log(`No guilds yet. Waiting ${pollMs}ms... (${attempt}/${maxAttempts})`);
    await sleep(pollMs);
  }

  console.error("Timed out waiting for the bot to be invited to a guild.");
  process.exit(1);
}

async function fetchGuilds() {
  const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: {
      Authorization: `Bot ${discordToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord guild check failed: ${response.status} ${text}`);
  }

  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
