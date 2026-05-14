# Discord Gemini Agent

`재명아`라고 부르면 대답하는 개인용 Discord 봇입니다. Gemini를 먼저 사용하고, Gemini가 쿼터나 rate limit 때문에 실패하면 Groq로 한 번 대체 응답을 시도합니다. 음악 재생, 자동 재생, 커스텀 이모지 확대, 장기 기억, 사용량 확인, Oracle Ubuntu 24/7 배포를 포함합니다.

## 핵심 기능

- `재명아` wake phrase로만 일반 대화를 시작합니다.
- Gemini 모델로 답변하고, 필요할 때 Google Search grounding을 사용할 수 있습니다.
- Gemini 쿼터/rate limit 오류가 나면 Groq fallback을 사용합니다.
- 서버/사용자별 장기 기억을 `data/memory.json`에 저장합니다.
- Gemini 사용량과 오류 상태를 `data/usage.json`에 기록합니다.
- YouTube/YouTube Music 음악 slash command를 제공합니다.
- Last.fm, YouTube 관련 영상, YouTube Data API를 활용해 autoplay 후보를 찾습니다.
- Discord 커스텀 이모지만 보낸 메시지를 큰 이미지 embed로 확대합니다.
- Oracle Cloud Ubuntu VM에서 `systemd` 서비스로 24/7 실행할 수 있습니다.
- GitHub Actions에서 `npm ci`와 `npm run check`를 실행합니다.

## 폴더 구조

```text
src/                         봇 런타임 코드
scripts/                     점검/운영용 스크립트
tests/                       Node test runner 테스트
data/persona.md              봇 성격/말투 설정
data/sources.md              참고 자료
data/current_context.md      현재 참고 맥락
data/memory.example.json     장기 기억 예시 파일
data/usage.example.json      사용량 기록 예시 파일
deploy/install-ubuntu.sh     Ubuntu 설치/배포 스크립트
deploy/ops.sh                systemd 운영 helper
docs/oracle-ubuntu-deploy.md Oracle VM 배포 상세 문서
.github/workflows/check.yml  GitHub Actions CI
```

실제 런타임 파일인 `data/memory.json`, `data/usage.json`, `.env`는 Git에 올리지 않습니다. 서버나 로컬에서 직접 보관합니다.

## 빠른 시작

```bash
npm ci
cp .env.example .env
nano .env
npm run check
npm start
```

Windows에서 PowerShell로 실행할 때:

```powershell
cd C:\Users\dogun\discord-gpt-agent
npm ci
copy .env.example .env
npm run check
npm run doctor
.\scripts\bot.ps1 start
.\scripts\bot.ps1 status
.\scripts\bot.ps1 logs
.\scripts\bot.ps1 stop
```

## 환경 변수

실제 실행에서는 `.env`만 읽습니다. `.env.example`과 `.env.production.example`은 문서/예시 파일입니다. 예시 파일에 있는 `your_*`, `example`, `changeme` 같은 placeholder 값은 실제 값으로 인정하지 않습니다.

기본 예시:

```env
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.1-8b-instant
GEMINI_MODEL=gemini-2.5-flash
YOUTUBE_API_KEY=your_youtube_api_key
YOUTUBE_REGION_CODE=KR
YOUTUBE_RELEVANCE_LANGUAGE=ko
LASTFM_API_KEY=your_lastfm_api_key
WAKE_PHRASE=재명아
MAX_CONTEXT_MESSAGES=5
DISCORD_ALLOWED_CHANNEL_IDS=1499319149116002376,692737843604488216
ENABLE_GOOGLE_SEARCH=1
GEMINI_DAILY_REQUEST_LIMIT=20
GEMINI_AUTH_COOLDOWN_MS=600000
MUSIC_MAX_TRACK_DURATION_SECONDS=900
MUSIC_MIN_TRACK_DURATION_SECONDS=60
MUSIC_HISTORY_LIMIT=20
MUSIC_MAX_STREAM_FAILURES=3
MUSIC_AUTOPLAY_SEARCH_FALLBACK=1
YOUTUBE_DL_BINARY_PATH=
```

주요 값:

- `DISCORD_TOKEN`: Discord bot token입니다. 필수입니다.
- `GEMINI_API_KEY`: Gemini API key입니다. 필수입니다.
- `OPENAI_API_KEY`: 과거 호환용 Gemini key 이름으로 아직 허용됩니다. 새 설정은 `GEMINI_API_KEY`를 권장합니다.
- `GROQ_API_KEY`: Gemini 쿼터/rate limit fallback에 사용합니다.
- `GROQ_MODEL`: Groq fallback 모델입니다.
- `GEMINI_MODEL`: Gemini 모델입니다. 기본값은 `gemini-2.5-flash`입니다.
- `YOUTUBE_API_KEY`: YouTube Data API 전용 key입니다. `GEMINI_API_KEY`나 `GOOGLE_API_KEY`로 대체하지 않습니다.
- `LASTFM_API_KEY`: autoplay에서 Last.fm 비슷한 곡 검색에 사용합니다.
- `WAKE_PHRASE`: 봇을 부르는 말입니다. 기본값은 `재명아`입니다.
- `MAX_CONTEXT_MESSAGES`: 답변에 참고할 최근 메시지 개수입니다.
- `DISCORD_ALLOWED_CHANNEL_IDS`: 비워두면 모든 채널에서 반응하고, 쉼표로 채널 ID를 넣으면 해당 채널만 허용합니다.
- `ENABLE_GOOGLE_SEARCH`: `0`이면 Gemini Google Search grounding을 끕니다.
- `GEMINI_DAILY_REQUEST_LIMIT`: 로컬 사용량 추정에 쓰는 일일 요청 한도입니다.
- `MUSIC_MAX_TRACK_DURATION_SECONDS`: 재생 가능한 곡의 최대 길이입니다. 기본값은 900초입니다.
- `MUSIC_MIN_TRACK_DURATION_SECONDS`: 재생 가능한 곡의 최소 길이입니다. 기본값은 60초입니다.
- `MUSIC_HISTORY_LIMIT`: 중복 방지를 위해 기억하는 최근 음악 기록 개수입니다.
- `MUSIC_MAX_STREAM_FAILURES`: 한 곡 스트림 실패 후 다음 후보로 넘어갈 최대 실패 횟수입니다.
- `MUSIC_AUTOPLAY_SEARCH_FALLBACK`: `0`이면 broad artist fallback search를 끕니다.
- `YOUTUBE_DL_BINARY_PATH`: 기본 경로 대신 사용할 `yt-dlp` 실행 파일 경로입니다.

## Discord 설정

Discord Developer Portal에서 다음을 설정합니다.

1. 애플리케이션을 엽니다.
2. OAuth2에서 `Requires OAuth2 Code Grant`를 끕니다.
3. Bot 설정에서 `MESSAGE CONTENT INTENT`를 켭니다.
4. `bot`, `applications.commands` scope로 봇을 초대합니다.
5. 권한은 `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`, `Connect`, `Speak`, `Use Voice Activity`를 줍니다.

`Manage Messages`는 커스텀 이모지를 크게 보낸 뒤 원래 작은 이모지 메시지를 삭제할 때 필요합니다. 권한이 없어도 큰 이모지는 보낼 수 있지만 원본 메시지가 남을 수 있습니다.

## 일반 대화 방식

봇은 기본적으로 `재명아`로 시작하는 메시지에만 반응합니다.

```text
재명아 오늘 날씨 어때?
재명아 이 오류 무슨 뜻이야?
재명아 명령어
```

`재명아`만 보내면 무엇을 도와줄지 짧게 되묻습니다. 봇 메시지에는 기본적으로 반응하지 않습니다. `ALLOW_BOT_WAKE=1`을 설정하면 봇 메시지에도 반응할 수 있습니다.

## Gemini와 Groq fallback

응답 흐름은 다음과 같습니다.

1. Gemini로 먼저 요청합니다.
2. Gemini가 정상 응답하면 그대로 답합니다.
3. Gemini가 쿼터 또는 rate limit 오류를 반환하면 같은 prompt를 Groq로 보냅니다.
4. 다음 사용자 요청에서는 다시 Gemini를 먼저 시도합니다.

이 동작은 Gemini-first 구조를 유지하면서 무료 쿼터 초과 상황에서 봇이 완전히 멈추는 일을 줄이기 위한 것입니다.

## 음악 Slash Commands

봇은 Discord slash command로 YouTube/YouTube Music 재생을 지원합니다.

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

명령 설명:

- `/play`: 요청자가 있는 음성 채널에 들어가 검색어 또는 URL의 첫 번째 재생 가능 영상을 재생합니다.
- `/skip`: 현재 곡을 넘깁니다. 싫어요 신호로 기록하지 않습니다.
- `/next`: 현재 곡을 부정 기록에 넣고 다음 곡으로 넘어갑니다.
- `/pause`, `/resume`: 재생을 일시정지하거나 다시 재생합니다.
- `/stop`: 재생을 멈추고 queue를 비운 뒤 음성 채널에서 나갑니다.
- `/leave`: 음성 채널에서 나갑니다.
- `/clear`, `/remove`, `/shuffle`: 수동 queue를 관리합니다.
- `/queue`, `/nowplaying`: 현재 곡, 수동 queue, autoplay queue, 길이, 출처, autoplay 상태를 embed로 보여줍니다.
- `/queue`: 선택 메뉴를 포함해서 queue 항목을 바로 재생하거나 제거할 수 있습니다.
- `/autoplay_debug`: autoplay seed, 후보 점수, 제외 이유, 검색 source event를 보여줍니다.

음악 명령은 Gemini/Groq를 호출하지 않는 로컬 slash command입니다.

## Autoplay 동작

Autoplay가 켜져 있고 queue가 비면 다음 순서로 후보를 찾습니다.

1. Last.fm `track.getSimilar`로 비슷한 곡을 찾습니다.
2. 각 결과를 `artist title official audio` 형태로 YouTube에서 검색합니다.
3. Last.fm 결과가 없으면 현재 곡의 YouTube related/autoplay 후보를 봅니다.
4. 그래도 부족하면 artist 기반 broad fallback search를 사용합니다.
5. 최근 재생 기록, 부정 기록, queue 중복, 너무 짧거나 긴 영상, cover/lyrics/live 등 derivative 신호를 기준으로 후보를 걸러냅니다.

`MUSIC_AUTOPLAY_SEARCH_FALLBACK=0`을 설정하면 broad artist fallback search를 끌 수 있습니다.

YouTube Data API가 설정되어 있으면 `search.list`를 먼저 사용합니다.

```text
type=video
videoCategoryId=10
videoEmbeddable=true
```

YouTube Data API가 실패하거나 결과가 없으면 로컬 YouTube 검색 라이브러리로 fallback합니다. 이 봇은 YouTube 웹 플레이어를 그대로 방송하는 것이 아니라, 곡마다 새 Discord voice audio stream을 엽니다.

음성 재생이 실패하면 서버에 FFmpeg와 정상적인 media 환경이 있는지 확인한 뒤 봇을 재시작하세요.

## 커스텀 이모지 확대

사용자가 Discord 커스텀 이모지만 포함한 메시지를 보내면, 봇이 큰 이미지 embed를 보내고 원본 작은 이모지 메시지를 삭제합니다.

```text
<:name:123456789012345678>
<a:name:123456789012345678>
```

- 한 메시지에서 최대 3개까지 확대합니다.
- 일반 텍스트가 섞이면 무시합니다.
- 기본 Unicode 이모지는 이 버전에서 확대하지 않습니다.
- 정적 이미지 URL은 `https://cdn.discordapp.com/emojis/{id}.webp?size=512` 형식입니다.
- 움직이는 이모지는 `animated=true`가 붙습니다.

## Persona, 참고 자료, 기억

봇의 말투와 성격은 아래 파일에 있습니다.

- `data/persona.md`

참고 자료:

- `data/sources.md`
- `data/current_context.md`

장기 기억:

- 실제 파일: `data/memory.json`
- 예시 파일: `data/memory.example.json`

사용량 기록:

- 실제 파일: `data/usage.json`
- 예시 파일: `data/usage.example.json`

`memory.json`과 `usage.json`은 런타임 상태 파일이므로 Git에 올리지 않습니다. 배포 스크립트는 서버에 이 파일들이 없으면 자동으로 생성합니다.

## 사용량 확인 명령

아래 명령은 Gemini 토큰을 쓰지 않는 로컬 명령입니다.

```text
재명아 사용량 알려줘
재명아 토큰 얼마나 남았어?
재명아 앞으로 몇 번 더 대화 가능해?
재명아 쿼터 상태 알려줘
재명아 뭐썼어
```

봇은 Gemini 요청 횟수, 성공/실패, 예상 token, quota error, 최근 API error를 로컬 파일에 기록합니다. Gemini API가 정확한 남은 무료 요청 수를 앱에 직접 제공하지 않기 때문에, 남은 횟수는 `GEMINI_DAILY_REQUEST_LIMIT`와 로컬 로그를 기준으로 추정합니다.

## 도움말과 기억 명령

도움말 명령:

```text
재명아 명령어
재명아 도움말
재명아 토큰 안 쓰는 명령어
```

기억 명령:

```text
재명아 앞으로 이 서버에서는 답변을 더 짧고 직설적으로 해
재명아 기억해 정치 밈은 가볍게 받아줘
재명아 내 설정 기억해 나한테는 반말하지 마
재명아 기억 보여줘
재명아 기억 삭제
```

서버 단위 지침과 사용자 단위 지침은 `data/memory.json`에 저장됩니다.

## 토큰 절약 방식

- 최근 대화 맥락은 기본 `MAX_CONTEXT_MESSAGES=5`까지만 포함합니다.
- 최신성이나 사실 확인이 필요한 질문에서만 Google Search grounding을 사용합니다.
- `data/sources.md`, `data/current_context.md`는 관련 있을 때만 참고합니다.
- 사용자가 자세히 요청하지 않으면 기본 답변은 짧게 유지합니다.
- 음악 slash command, 이모지 확대, 사용량/도움말/기억 관리 명령은 Gemini/Groq를 호출하지 않습니다.

## 로컬 점검 명령

```bash
npm run check
npm test
npm run doctor
npm run doctor:music
npm run test:gemini
npm run channels
npm run wait:guild
```

- `npm run check`: 문법 검사와 전체 테스트를 실행합니다.
- `npm test`: 테스트만 실행합니다.
- `npm run doctor`: Discord token, Gemini key, invite URL, Gemini 응답을 점검합니다.
- `npm run doctor:music`: Discord/Gemini 인증 없이 `yt-dlp`, FFmpeg, YouTube/Last.fm 음악 설정을 점검합니다.
- `npm run test:gemini`: Gemini plain/search 요청을 직접 테스트합니다.
- `npm run channels`: 봇이 접근 가능한 guild/channel 목록을 출력합니다.
- `npm run wait:guild`: 봇이 guild에 들어올 때까지 polling합니다.

## Oracle Ubuntu 24/7 배포

상세 문서:

- `docs/oracle-ubuntu-deploy.md`

VM에서 짧은 배포 흐름:

```bash
cd ~/discord-gpt-agent
chmod +x deploy/install-ubuntu.sh deploy/ops.sh
sudo ./deploy/install-ubuntu.sh
sudo nano /opt/discord-gpt-agent/.env
sudo systemctl start discord-gpt-agent
sudo journalctl -u discord-gpt-agent -f
```

설치 스크립트가 하는 일:

- Node.js가 없으면 Node 22를 설치합니다.
- FFmpeg를 설치합니다.
- `yt-dlp`와 관련 플러그인을 설치합니다.
- 앱을 `/opt/discord-gpt-agent`로 복사합니다.
- `npm ci --omit=dev`로 운영 의존성을 설치합니다.
- `.env`가 없으면 `.env.production.example` 또는 `.env.example`에서 복사해 만듭니다.
- `data/memory.json`, `data/usage.json`이 없으면 생성합니다.
- `discord-gpt-agent.service`를 systemd에 등록합니다.

운영 명령:

```bash
sudo systemctl start discord-gpt-agent
sudo systemctl stop discord-gpt-agent
sudo systemctl restart discord-gpt-agent
sudo systemctl status discord-gpt-agent
sudo journalctl -u discord-gpt-agent -f
```

`deploy/ops.sh` helper:

```bash
./deploy/ops.sh status
./deploy/ops.sh logs
./deploy/ops.sh tail
./deploy/ops.sh doctor
./deploy/ops.sh restart
./deploy/ops.sh restart-tail
./deploy/ops.sh check-ytdlp
./deploy/ops.sh update-ytdlp
```

- `restart-tail`: 서비스를 재시작한 뒤 최근 journal 로그를 보여줍니다.
- `check-ytdlp`: `yt-dlp` 경로/버전과 FFmpeg 설치 여부를 출력합니다.
- `update-ytdlp`: `/usr/local/bin/yt-dlp`를 안전하게 다시 내려받고 실행 권한을 유지합니다.

## GitHub Actions CI

`.github/workflows/check.yml`은 `push`와 `pull_request`에서 실행됩니다.

CI 작업:

```bash
npm ci
npm run check
```

Node.js 22를 사용합니다.

## Git에 올리지 않는 파일

아래 파일은 비밀값이나 런타임 상태라 Git에 올리지 않습니다.

```text
.env
.env.*
data/memory.json
data/usage.json
data/*.local.json
node_modules/
logs/
*.log
*.key
*.pem
*.sqlite
*.db
cookies.txt
```

단, `.env.example`, `.env.production.example`, `data/memory.example.json`, `data/usage.example.json`은 예시 파일이라 Git에 올립니다.

## 문제 해결

`Missing required environment variable: DISCORD_TOKEN`

- `.env` 파일이 있는지 확인하세요.
- `DISCORD_TOKEN=your_discord_bot_token` 같은 placeholder가 아닌 실제 token을 넣어야 합니다.

`Missing required environment variable: GEMINI_API_KEY`

- `.env`에 `GEMINI_API_KEY`를 넣으세요.
- 과거 호환으로 `OPENAI_API_KEY`도 허용되지만 새 설정은 `GEMINI_API_KEY`가 더 명확합니다.

Gemini `429 RESOURCE_EXHAUSTED`

- Gemini 무료 요청 한도를 초과한 상태입니다.
- `GROQ_API_KEY`가 있으면 fallback 응답을 시도합니다.
- quota가 reset되거나 billing을 설정하면 Gemini가 다시 정상 동작합니다.

음악이 재생되지 않음

- 봇이 음성 채널 권한을 가지고 있는지 확인하세요.
- 서버에 FFmpeg/media 환경이 있는지 확인하세요.
- `yt-dlp` 설치 상태를 확인하고 서비스를 재시작하세요.

Autoplay 품질이 낮음

- `LASTFM_API_KEY`와 `YOUTUBE_API_KEY`를 설정하면 후보 품질이 좋아집니다.
- `/autoplay_debug`로 후보 점수와 제외 이유를 확인하세요.

Slash command가 보이지 않음

- 봇을 `applications.commands` scope로 초대했는지 확인하세요.
- 봇 시작 로그에서 command sync 오류가 없는지 확인하세요.
