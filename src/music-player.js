const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
} = require("@discordjs/voice");
const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");

const {
  createTrackStream,
  getAutoplayCandidatesWithContext,
  getAutoplayTrackWithContext,
  createHistoryContext,
  pushHistory,
  resolveTrack,
} = require("./youtube-service");

const NEGATIVE_HISTORY_LIMIT = 20;
const MAX_STREAM_FAILURES = Number(process.env.MUSIC_MAX_STREAM_FAILURES || 3);

class GuildMusicState {
  constructor(guildId) {
    this.guildId = guildId;
    this.connection = null;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });
    this.queue = [];
    this.autoplayQueue = [];
    this.history = [];
    this.negativeHistory = [];
    this.current = null;
    this.lastAutoplaySeed = null;
    this.lastAutoplayDebug = null;
    this.pendingFeedbackType = null;
    this.prefillingAutoplay = false;
    this.autoplayEnabled = true;
    this.textChannel = null;
    this.playing = false;
    this.stopped = false;
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playNext().catch((error) => {
        console.error("Failed to continue music playback:", error);
        this.textChannel?.send(`다음 곡 재생에 실패했습니다: ${error.message}`).catch(() => {});
      });
    });
    this.player.on("error", (error) => {
      console.error("Audio player error:", error);
      this.textChannel?.send(`재생 오류: ${error.message}`).catch(() => {});
      this.playNext().catch((nextError) => console.error("Failed after audio error:", nextError));
    });
  }

  async enqueue({ query, member, textChannel }) {
    this.textChannel = textChannel;
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
      throw new Error("먼저 음성 채널에 들어가야 합니다.");
    }

    await this.ensureConnection(voiceChannel);
    const requester = member.displayName || member.user?.username || "unknown";
    const track = await resolveTrack(query, requester);
    this.queue.push(track);
    if (!this.playing && !this.current) {
      await this.playNext();
    }
    return track;
  }

  async ensureConnection(voiceChannel) {
    if (this.connection) return this.connection;

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection.subscribe(this.player);
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.connection = null;
    });
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    return this.connection;
  }

  async playNext(streamFailures = 0) {
    this.recordCurrentFeedback(this.pendingFeedbackType || "finished");
    this.pendingFeedbackType = null;

    if (this.stopped) {
      this.playing = false;
      this.current = null;
      this.stopped = false;
      return;
    }

    let next = this.queue.shift();
    if (!next && this.autoplayEnabled) {
      next = this.autoplayQueue.shift();
    }
    if (!next && this.autoplayEnabled && this.current) {
      const seedTrack = this.getAutoplaySeed();
      const context = createHistoryContext(
        [...this.history, seedTrack].filter(Boolean),
        this.negativeHistory,
        [...this.queue, ...this.autoplayQueue],
      );
      next = await getAutoplayTrackWithContext(seedTrack, context);
      if (next) {
        next.requestedBy = "YouTube autoplay";
      }
    }

    if (!next) {
      this.playing = false;
      this.current = null;
      return;
    }

    this.current = next;
    this.history = pushHistory(this.history, { ...next, feedback_type: "playing", playedAt: new Date().toISOString() });
    this.lastAutoplaySeed = next;
    this.playing = true;

    try {
      const rawStream = createTrackStream(next);
      const probed = await demuxProbe(rawStream);
      const resource = createAudioResource(probed.stream, {
        inputType: probed.type,
        metadata: next,
      });
      this.player.play(resource);
      this.announceNowPlaying(next);
    } catch (error) {
      console.error("Failed to create audio stream. Trying next candidate:", error);
      this.history = this.history.filter((track) => track.id !== next.id);
      this.current = null;
      this.playing = false;
      const nextFailureCount = streamFailures + 1;
      if (nextFailureCount >= MAX_STREAM_FAILURES) {
        this.autoplayQueue = [];
        this.textChannel
          ?.send("연속으로 오디오 스트림 생성에 실패해서 자동재생을 멈췄습니다. 잠시 후 다시 시도해주세요.")
          .catch(() => {});
        return;
      }
      await this.playNext(nextFailureCount);
      return;
    }
    this.ensureAutoplayQueue(2).catch((error) => {
      console.error("Failed to prefill autoplay queue:", error);
    });
  }

  skip() {
    if (!this.current && !this.queue.length) return false;
    this.pendingFeedbackType = "skip";
    this.player.stop(true);
    return true;
  }

  pause() {
    if (!this.current || !this.playing) return false;
    return this.player.pause();
  }

  resume() {
    if (!this.current) return false;
    return this.player.unpause();
  }

  next() {
    if (!this.current && !this.queue.length) return false;
    if (this.current) {
      this.addNegativeTrack(this.current);
    }
    this.pendingFeedbackType = "next";
    this.player.stop(true);
    return true;
  }

  stop() {
    this.queue = [];
    this.autoplayQueue = [];
    this.current = null;
    this.stopped = true;
    this.playing = false;
    this.player.stop(true);
    this.connection?.destroy();
    this.connection = null;
  }

  clearQueue() {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }

  removeFromQueue(index) {
    if (!Number.isInteger(index) || index < 1 || index > this.queue.length) return null;
    const [removed] = this.queue.splice(index - 1, 1);
    return removed || null;
  }

  removeAutoplayQueue(index) {
    if (!Number.isInteger(index) || index < 1 || index > this.autoplayQueue.length) return null;
    const [removed] = this.autoplayQueue.splice(index - 1, 1);
    return removed || null;
  }

  async playQueueIndexNow(index, source = "queue") {
    const track = source === "autoplay" ? this.removeAutoplayQueue(index) : this.removeFromQueue(index);
    if (!track) return null;

    track.requestedBy = source === "autoplay" ? "YouTube autoplay" : track.requestedBy;
    this.queue.unshift(track);
    if (this.current || this.playing) {
      this.pendingFeedbackType = "skip";
      this.player.stop(true);
    } else {
      await this.playNext();
    }
    return track;
  }

  shuffleQueue() {
    if (this.queue.length < 2) return false;
    for (let index = this.queue.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [this.queue[index], this.queue[swapIndex]] = [this.queue[swapIndex], this.queue[index]];
    }
    return true;
  }

  leave() {
    this.stop();
  }

  setAutoplay(enabled) {
    this.autoplayEnabled = enabled;
  }

  addNegativeTrack(track) {
    const next = this.negativeHistory.filter((item) => item.id !== track.id);
    next.push({
      ...track,
      negativeSkipped: true,
      at: new Date().toISOString(),
    });
    this.negativeHistory = next.slice(-NEGATIVE_HISTORY_LIMIT);
  }

  getAutoplaySeed() {
    const finished = [...this.history]
      .reverse()
      .find((track) => track.feedback_type === "finished" && !this.isNegativeTrack(track));
    if (finished) return finished;

    if (this.current && !this.isNegativeTrack(this.current)) return this.current;

    return [...this.history]
      .reverse()
      .find((track) => track.feedback_type !== "next" && !this.isNegativeTrack(track)) || null;
  }

  isNegativeTrack(track) {
    return this.negativeHistory.some((item) => item.id === track.id);
  }

  recordCurrentFeedback(feedbackType) {
    if (!this.current || feedbackType === "playing") return;
    const index = this.history.findIndex((track) => track.id === this.current.id);
    if (index >= 0) {
      this.history[index] = {
        ...this.history[index],
        feedback_type: feedbackType,
        feedbackAt: new Date().toISOString(),
      };
    }
  }

  announceNowPlaying(track) {
    if (!this.textChannel) return;
    this.textChannel.send({ embeds: [buildNowPlayingEmbed(this, track)] }).catch(() => {});
  }

  async ensureAutoplayQueue(targetSize = 2) {
    if (!this.autoplayEnabled || this.prefillingAutoplay) return;
    this.prefillingAutoplay = true;
    try {
      while (this.autoplayQueue.length < targetSize) {
        const seedTrack = this.getAutoplaySeed();
        if (!seedTrack) break;
        const context = createHistoryContext(
          [...this.history, seedTrack].filter(Boolean),
          this.negativeHistory,
          [...this.queue, ...this.autoplayQueue],
        );
        const result = await getAutoplayCandidatesWithContext(seedTrack, context, targetSize - this.autoplayQueue.length);
        this.lastAutoplayDebug = {
          ...result.debug,
          autoplay: this.autoplayEnabled,
          current: this.current ? { id: this.current.id, title: this.current.title, url: this.current.url } : null,
          seed: seedTrack ? { id: seedTrack.id, title: seedTrack.title, url: seedTrack.url } : null,
          autoplayQueue: this.autoplayQueue.map((track) => ({ id: track.id, title: track.title, url: track.url })),
        };
        const additions = result.selected.filter((track) => !this.autoplayQueue.some((item) => item.id === track.id));
        if (!additions.length) break;
        for (const track of additions) {
          track.requestedBy = "YouTube autoplay";
          this.autoplayQueue.push(track);
        }
      }
    } finally {
      this.prefillingAutoplay = false;
    }
  }

  formatAutoplayDebug() {
    const debug = this.lastAutoplayDebug;
    const lines = [
      `autoplay: ${this.autoplayEnabled ? "on" : "off"}`,
      `현재 곡: ${this.current ? this.current.title : "없음"}`,
      `현재 seed: ${this.getAutoplaySeed()?.title || "없음"}`,
      `autoplayQueue: ${this.autoplayQueue.length ? this.autoplayQueue.map((track, index) => `${index + 1}. ${track.title}`).join(" / ") : "비어 있음"}`,
    ];
    if (!debug) {
      lines.push("최근 자동재생 후보 기록이 없습니다.");
      return lines.join("\n");
    }
    lines.push(`source/events: ${debug.events.join(", ") || "없음"}`);
    lines.push("최근 후보:");
    lines.push(
      ...debug.candidates.slice(-10).map((item) =>
        `- ${item.title} | ${item.source} | score=${item.score} | ${item.excluded ? `excluded:${item.reason}` : item.reason}`,
      ),
    );
    return lines.join("\n").slice(0, 1900);
  }
}

class MusicManager {
  constructor() {
    this.states = new Map();
  }

  get(guildId) {
    let state = this.states.get(guildId);
    if (!state) {
      state = new GuildMusicState(guildId);
      this.states.set(guildId, state);
    }
    return state;
  }

  remove(guildId) {
    const state = this.states.get(guildId);
    state?.leave();
    this.states.delete(guildId);
  }
}

function formatTrack(track) {
  return `[${track.title}](${track.url})`;
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (!value) return "길이 정보 없음";
  const minutes = Math.floor(value / 60);
  const remainingSeconds = String(Math.floor(value % 60)).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function formatRequester(track) {
  return track?.requestedBy ? String(track.requestedBy) : "알 수 없음";
}

function formatTrackLine(track, index = null) {
  const prefix = index === null ? "" : `${index}. `;
  return `${prefix}[${track.title}](${track.url}) · ${formatDuration(track.durationSeconds)}`;
}

function getPlaybackSource(track) {
  if (!track) return "대기 중";
  return track.requestedBy === "YouTube autoplay" ? "자동재생" : "직접 추가";
}

function buildNowPlayingEmbed(state, track = state.current) {
  const isAutoplay = track?.requestedBy === "YouTube autoplay";
  const embed = new EmbedBuilder()
    .setColor(isAutoplay ? 0x2f80ed : 0x2ecc71)
    .setTitle(isAutoplay ? "자동재생 시작" : "재생 시작")
    .setDescription(track ? formatTrack(track) : "현재 재생 중인 곡이 없습니다.")
    .addFields(
      { name: "길이", value: track ? formatDuration(track.durationSeconds) : "-", inline: true },
      { name: "출처", value: getPlaybackSource(track), inline: true },
      { name: "요청", value: track ? formatRequester(track) : "-", inline: true },
      { name: "자동재생", value: state.autoplayEnabled ? "on" : "off", inline: true },
      { name: "대기열", value: `${state.queue.length}곡`, inline: true },
      { name: "자동 대기", value: `${state.autoplayQueue.length}곡`, inline: true },
    )
    .setTimestamp(new Date());

  if (track?.url) embed.setURL(track.url);
  return embed;
}

function buildQueueEmbed(state) {
  const current = state.current ? formatTrackLine(state.current) : "없음";
  const manualQueue = state.queue.length
    ? state.queue.slice(0, 10).map((track, index) => formatTrackLine(track, index + 1)).join("\n")
    : "비어 있음";
  const autoplayQueue = state.autoplayQueue.length
    ? state.autoplayQueue.slice(0, 5).map((track, index) => formatTrackLine(track, index + 1)).join("\n")
    : "비어 있음";
  const omitted = Math.max(0, state.queue.length - 10);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("재생목록")
    .addFields(
      { name: "현재 재생", value: current },
      { name: `대기열 ${state.queue.length}곡`, value: manualQueue },
      { name: `자동재생 대기 ${state.autoplayQueue.length}곡`, value: autoplayQueue },
      {
        name: "상태",
        value: [
          `자동재생: ${state.autoplayEnabled ? "on" : "off"}`,
          `제외 기록: ${state.negativeHistory?.length || 0}곡`,
          omitted ? `그 외 대기열: ${omitted}곡` : null,
        ].filter(Boolean).join("\n"),
      },
    )
    .setTimestamp(new Date());

  return embed;
}

function buildQueueComponents(state) {
  const options = buildQueueSelectOptions(state);
  if (!options.length) return [];

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("music:select:play")
        .setPlaceholder("바로 재생할 곡 선택")
        .addOptions(options),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("music:select:remove")
        .setPlaceholder("대기열에서 제거할 곡 선택")
        .addOptions(options),
    ),
  ];
}

function buildQueueSelectOptions(state) {
  return [
    ...state.queue.slice(0, 15).map((track, index) => buildQueueSelectOption(track, "queue", index + 1)),
    ...state.autoplayQueue.slice(0, 10).map((track, index) => buildQueueSelectOption(track, "autoplay", index + 1)),
  ].slice(0, 25);
}

function buildQueueSelectOption(track, source, index) {
  const prefix = source === "autoplay" ? "자동" : "대기";
  return {
    label: truncateSelectText(`${prefix} ${index}. ${track.title}`, 100),
    description: truncateSelectText(formatDuration(track.durationSeconds), 100),
    value: `${source}:${index}`,
  };
}

function truncateSelectText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildStatusEmbed(state) {
  return new EmbedBuilder()
    .setColor(state.current ? 0x2ecc71 : 0x95a5a6)
    .setTitle("재생 상태")
    .setDescription(state.current ? formatTrack(state.current) : "현재 재생 중인 곡이 없습니다.")
    .addFields(
      { name: "길이", value: state.current ? formatDuration(state.current.durationSeconds) : "-", inline: true },
      { name: "자동재생", value: state.autoplayEnabled ? "on" : "off", inline: true },
      { name: "대기열", value: `${state.queue.length}곡`, inline: true },
      { name: "자동 대기", value: `${state.autoplayQueue.length}곡`, inline: true },
      { name: "제외 기록", value: `${state.negativeHistory?.length || 0}곡`, inline: true },
      { name: "출처", value: getPlaybackSource(state.current), inline: true },
    )
    .setTimestamp(new Date());
}

function formatQueue(state) {
  const lines = [];
  if (state.current) lines.push(`현재: ${formatTrack(state.current)}`);
  if (!state.queue.length) {
    lines.push("대기열이 비어 있습니다.");
  } else {
    lines.push(
      ...state.queue
        .slice(0, 10)
        .map((track, index) => `${index + 1}. ${track.title}`),
    );
  }
  if (state.autoplayQueue?.length) {
    lines.push(`자동재생 대기: ${state.autoplayQueue.map((track) => track.title).slice(0, 5).join(" / ")}`);
  }
  lines.push(`자동재생: ${state.autoplayEnabled ? "on" : "off"}`);
  if (state.negativeHistory?.length) lines.push(`next 제외 기록: ${state.negativeHistory.length}곡`);
  return lines.join("\n");
}

module.exports = {
  GuildMusicState,
  MusicManager,
  buildNowPlayingEmbed,
  buildQueueComponents,
  buildQueueEmbed,
  buildStatusEmbed,
  formatDuration,
  formatQueue,
  formatTrack,
};
