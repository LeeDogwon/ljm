const { SlashCommandBuilder } = require("discord.js");
const {
  MusicManager,
  buildQueueComponents,
  buildQueueEmbed,
  buildStatusEmbed,
  formatTrack,
} = require("./music-player");

const musicManager = new MusicManager();

const musicCommands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("YouTube/YouTube Music 검색어 또는 URL을 재생합니다.")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("검색어 또는 YouTube/YouTube Music URL")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("YouTube related/autoplay 후보 기반 자동재생을 켜거나 끕니다.")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("on 또는 off")
        .setRequired(true)
        .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    ),
  new SlashCommandBuilder().setName("skip").setDescription("현재 곡을 넘깁니다."),
  new SlashCommandBuilder().setName("next").setDescription("현재 곡을 마음에 안 드는 곡으로 기록하고 다음 곡으로 넘깁니다."),
  new SlashCommandBuilder().setName("pause").setDescription("현재 곡을 일시정지합니다."),
  new SlashCommandBuilder().setName("resume").setDescription("일시정지한 곡을 다시 재생합니다."),
  new SlashCommandBuilder().setName("stop").setDescription("재생을 멈추고 대기열을 비웁니다."),
  new SlashCommandBuilder().setName("leave").setDescription("음성 채널에서 나갑니다."),
  new SlashCommandBuilder().setName("clear").setDescription("직접 추가한 대기열을 비웁니다."),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("대기열에서 특정 곡을 제거합니다.")
    .addIntegerOption((option) =>
      option
        .setName("index")
        .setDescription("/queue에 표시된 대기열 번호")
        .setRequired(true)
        .setMinValue(1),
    ),
  new SlashCommandBuilder().setName("shuffle").setDescription("직접 추가한 대기열 순서를 섞습니다."),
  new SlashCommandBuilder().setName("queue").setDescription("현재 대기열을 보여줍니다."),
  new SlashCommandBuilder().setName("nowplaying").setDescription("현재 재생 중인 곡을 보여줍니다."),
  new SlashCommandBuilder().setName("autoplay_debug").setDescription("자동재생 후보, 제외 이유, 점수 상태를 보여줍니다."),
];

async function syncMusicCommands(client) {
  const commands = musicCommands.map((command) => command.toJSON());
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    await guild.commands.set(commands);
    console.log(`Synced ${commands.length} music slash command(s) to guild ${guildId}`);
    return;
  }

  await client.application.commands.set(commands);
  console.log(`Synced ${commands.length} global music slash command(s)`);
}

async function handleMusicInteraction(interaction) {
  if (!interaction.guildId) {
    if (interaction.isChatInputCommand?.() || interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
      await interaction.reply({ content: "음악 명령은 서버에서만 사용할 수 있습니다.", ephemeral: true });
      return true;
    }
    return false;
  }

  const state = musicManager.get(interaction.guildId);

  try {
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith("music:select:")) {
      return handleMusicSelectInteraction(interaction, state);
    }

    if (!interaction.isChatInputCommand()) return false;
    if (!musicCommands.some((command) => command.name === interaction.commandName)) return false;

    if (interaction.commandName === "play") {
      await interaction.deferReply();
      const query = interaction.options.getString("query", true);
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const track = await state.enqueue({
        query,
        member,
        textChannel: interaction.channel,
      });
      await interaction.editReply({
        content: `대기열 추가: ${formatTrack(track)}`,
        embeds: [buildQueueEmbed(state)],
        components: buildQueueComponents(state),
      });
      return true;
    }

    if (interaction.commandName === "autoplay") {
      const mode = interaction.options.getString("mode", true);
      state.setAutoplay(mode === "on");
      await interaction.reply(`자동재생: ${state.autoplayEnabled ? "on" : "off"}`);
      return true;
    }

    if (interaction.commandName === "skip") {
      await interaction.reply({ content: state.skip() ? "현재 곡을 넘깁니다." : "넘길 곡이 없습니다.", ephemeral: true });
      return true;
    }

    if (interaction.commandName === "next") {
      await interaction.reply({ content: state.next() ? "현재 곡을 제외 기록하고 다음 곡으로 넘깁니다." : "넘길 곡이 없습니다.", ephemeral: true });
      return true;
    }

    if (interaction.commandName === "pause") {
      await interaction.reply({ content: state.pause() ? "일시정지했습니다." : "일시정지할 곡이 없습니다.", ephemeral: true });
      return true;
    }

    if (interaction.commandName === "resume") {
      await interaction.reply({ content: state.resume() ? "다시 재생합니다." : "다시 재생할 곡이 없습니다.", ephemeral: true });
      return true;
    }

    if (interaction.commandName === "stop") {
      state.stop();
      await interaction.reply("재생을 멈추고 음성 채널에서 나갔습니다.");
      return true;
    }

    if (interaction.commandName === "leave") {
      musicManager.remove(interaction.guildId);
      await interaction.reply("음성 채널에서 나갔습니다.");
      return true;
    }

    if (interaction.commandName === "clear") {
      const count = state.clearQueue();
      await interaction.reply({ content: `대기열 ${count}곡을 비웠습니다.`, embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) });
      return true;
    }

    if (interaction.commandName === "remove") {
      const index = interaction.options.getInteger("index", true);
      const removed = state.removeFromQueue(index);
      await interaction.reply(
        removed
          ? { content: `제거: ${formatTrack(removed)}`, embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) }
          : { content: "해당 번호의 대기열 곡이 없습니다.", ephemeral: true },
      );
      return true;
    }

    if (interaction.commandName === "shuffle") {
      await interaction.reply(
        state.shuffleQueue()
          ? { content: "대기열을 섞었습니다.", embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) }
          : { content: "섞을 대기열이 부족합니다.", ephemeral: true },
      );
      return true;
    }

    if (interaction.commandName === "queue") {
      await interaction.reply({ embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) });
      return true;
    }

    if (interaction.commandName === "nowplaying") {
      await interaction.reply({ embeds: [buildStatusEmbed(state)] });
      return true;
    }

    if (interaction.commandName === "autoplay_debug") {
      await interaction.reply({ content: state.formatAutoplayDebug(), ephemeral: true });
      return true;
    }
  } catch (error) {
    console.error("Music command failed:", error);
    const content = `음악 명령 처리에 실패했습니다: ${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content).catch(() => {});
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
    return true;
  }

  return true;
}

async function handleMusicSelectInteraction(interaction, state) {
  const [, , action] = interaction.customId.split(":");
  const [source, rawIndex] = String(interaction.values?.[0] || "").split(":");
  const index = Number(rawIndex);
  if (!["queue", "autoplay"].includes(source) || !Number.isInteger(index)) {
    await interaction.reply({ content: "알 수 없는 대기열 선택입니다.", ephemeral: true });
    return true;
  }

  if (action === "play") {
    const track = await state.playQueueIndexNow(index, source);
    await interaction.update(
      track
        ? { content: `바로 재생: ${formatTrack(track)}`, embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) }
        : { content: "해당 번호의 대기열 곡이 없습니다.", embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) },
    );
    return true;
  }

  if (action === "remove") {
    const track = source === "autoplay" ? state.removeAutoplayQueue(index) : state.removeFromQueue(index);
    await interaction.update(
      track
        ? { content: `제거: ${formatTrack(track)}`, embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) }
        : { content: "해당 번호의 대기열 곡이 없습니다.", embeds: [buildQueueEmbed(state)], components: buildQueueComponents(state) },
    );
    return true;
  }

  await interaction.reply({ content: "알 수 없는 대기열 선택입니다.", ephemeral: true });
  return true;
}

module.exports = {
  handleMusicInteraction,
  musicCommands,
  musicManager,
  syncMusicCommands,
};
