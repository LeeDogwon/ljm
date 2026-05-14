# Discord Gemini Agent

Discord bot that wakes up when called with `재명아`, answers with Gemini, keeps long-term memory, and can use Google Search grounding for current information.

## Local Windows Operation

```powershell
cd C:\Users\dogun\discord-gpt-agent
npm run check
npm run doctor
.\scripts\bot.ps1 start
.\scripts\bot.ps1 status
.\scripts\bot.ps1 logs
.\scripts\bot.ps1 stop
```

## Environment

The app reads `.env` first and then `.env.example` as fallback.

```env
DISCORD_TOKEN=...
GEMINI_API_KEY=...
GROQ_API_KEY=...
GROQ_MODEL=llama-3.1-8b-instant
GEMINI_MODEL=gemini-2.5-flash
YOUTUBE_API_KEY=...
YOUTUBE_REGION_CODE=KR
YOUTUBE_RELEVANCE_LANGUAGE=ko
LASTFM_API_KEY=...
WAKE_PHRASE=재명아
MAX_CONTEXT_MESSAGES=5
DISCORD_ALLOWED_CHANNEL_IDS=1499319149116002376,692737843604488216
ENABLE_GOOGLE_SEARCH=1
GEMINI_DAILY_REQUEST_LIMIT=20
```

`OPENAI_API_KEY` is still accepted as a legacy variable name for the Gemini key.

The bot always tries Gemini first. If Gemini returns a quota or rate-limit error, it automatically sends the same prompt to Groq. The next user request tries Gemini first again, so it switches back as soon as Gemini is available.

## Discord Setup

In Discord Developer Portal:

1. Open the application.
2. OAuth2: turn off `Requires OAuth2 Code Grant`.
3. Bot: enable `MESSAGE CONTENT INTENT`.
4. Invite the bot with the `bot` and `applications.commands` scopes.
5. Give the bot `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`, `Connect`, `Speak`, and `Use Voice Activity`.

`Manage Messages` is required for the auto emoji expander to remove the original small emoji message after the large embed is sent. If the bot does not have that permission in a channel, the large emoji can still be sent, but the original message may remain.

## Music Slash Commands

The bot provides YouTube/YouTube Music playback through Discord slash commands.

```text
/play query:아이유 밤편지
/play query:https://music.youtube.com/watch?v=...
/autoplay mode:on
/autoplay mode:off
/skip
/next
/pause
/resume
/stop
/leave
/clear
/remove index:2
/shuffle
/queue
/nowplaying
/autoplay_debug
```

- `/play` joins the requester's voice channel and plays the first matching YouTube track or URL.
- `/skip` only moves to the next track. It is not treated as a dislike signal.
- `/next` records the current track as a negative signal, avoids using it as the next autoplay seed, and moves to the next track.
- `/pause` and `/resume` pause or continue the current player.
- `/stop` stops playback, clears the queues, and leaves the voice channel.
- `/clear`, `/remove`, and `/shuffle` manage the manually added queue.
- `/queue` and `/nowplaying` use Discord embeds with current track, queue, autoplay queue, duration, source, and autoplay status.
- `/queue` includes compact select menus so you can immediately play or remove manual queue and autoplay queue items without typing another command.
- The bot keeps an `autoplayQueue` prefetched in the background so ending, `/skip`, and `/next` can move to the next track faster.
- `/autoplay_debug` shows autoplay state, current seed, autoplayQueue, recent candidate scores, exclusion reasons, and source events.
- If the queue is empty and autoplay is on, the bot tries Last.fm `track.getSimilar` first, searches each result on YouTube as `artist title official audio`, and then applies the same YouTube filters and scoring.
- If Last.fm does not produce a usable next song, the bot fetches YouTube related/autoplay candidates from the current track and connects the next Discord voice audio stream track-by-track.
- Autoplay fallback is on by default. Set `MUSIC_AUTOPLAY_SEARCH_FALLBACK=0` only if you want to disable broad artist-based YouTube/Data API search after Last.fm and related fail.
- Last.fm and optional fallback searches use YouTube Data API `search.list` first, with `type=video`, `videoCategoryId=10`, and `videoEmbeddable=true`; if that API fails or returns no usable result, the bot falls back to the local YouTube search library.
- This does not broadcast the YouTube web player itself. It follows related/autoplay candidates and opens a new Discord voice stream for each song.
- Recent playback history is kept in memory to reduce repeated songs.
- Music commands are local slash command handlers and do not call Gemini or Groq.
- The host needs a working media environment for Discord voice playback. If playback fails, install FFmpeg on the host and restart the bot.

## Auto Emoji Expansion

When a user sends a message that contains only Discord custom emojis and whitespace, the bot sends large emoji embeds and then deletes the original small emoji message.

```text
<:name:123456789012345678>
<a:name:123456789012345678>
```

- Up to three custom emojis are expanded from one message.
- Static emoji image URL: `https://cdn.discordapp.com/emojis/{id}.webp?size=512`
- Animated emoji image URL: `https://cdn.discordapp.com/emojis/{id}.webp?animated=true&size=512`
- Messages with normal text mixed in are ignored.
- Standard Unicode emojis are not expanded in this version.

## Persona And Memory

Persona:

- [data/persona.md](data/persona.md)

Reference notes:

- [data/sources.md](data/sources.md)
- [data/current_context.md](data/current_context.md)

Long-term memory:

- [data/memory.json](data/memory.json)

Usage tracking:

- [data/usage.json](data/usage.json)
- The bot records Gemini request attempts, success/failure counts, estimated tokens, quota errors, and the latest API error.
- Gemini does not expose exact remaining free-tier requests through this app, so remaining conversations are estimated from `GEMINI_DAILY_REQUEST_LIMIT` and local request logs.

Usage commands:

```text
재명아 사용량 알려줘
재명아 토큰 얼마나 남았어?
재명아 앞으로 몇 번 더 대화 가능해?
재명아 쿼터 상태 알려줘
재명아 뭐썼어
```

Local help commands, also without Gemini tokens:

```text
재명아 명령어
재명아 도움말
재명아 토큰 안 쓰는 명령어
```

Chat memory commands:

```text
재명아 앞으로 이 서버에서는 답변을 더 짧고 직설적으로 해
재명아 기억해 정치 밈은 가볍게 받아줘
재명아 내 설정 기억해 나한테는 반말하지 마
재명아 기억 보여줘
재명아 기억 삭제
```

## Token Saving

- Recent message context defaults to `MAX_CONTEXT_MESSAGES=5`.
- Search grounding is used only for questions that look current or factual.
- Reference/context files are included only when relevant.
- Default replies are limited to 3 short sentences unless the user asks for detail.

## 24/7 Oracle Ubuntu Deployment

Use the deployment guide:

- [docs/oracle-ubuntu-deploy.md](docs/oracle-ubuntu-deploy.md)

Short version on the VM:

```bash
cd ~/discord-gpt-agent
chmod +x deploy/install-ubuntu.sh deploy/ops.sh
sudo ./deploy/install-ubuntu.sh
sudo nano /opt/discord-gpt-agent/.env
sudo systemctl start discord-gpt-agent
sudo journalctl -u discord-gpt-agent -f
```
