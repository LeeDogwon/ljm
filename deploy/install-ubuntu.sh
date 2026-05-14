#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/discord-gpt-agent}"
APP_USER="${APP_USER:-ubuntu}"
SERVICE_NAME="${SERVICE_NAME:-discord-gpt-agent}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

apt-get update
apt-get install -y ca-certificates curl ffmpeg git rsync unzip

YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
case "$(uname -m)" in
  aarch64|arm64)
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
    ;;
  x86_64|amd64)
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    ;;
  *)
    echo "Unsupported architecture for standalone yt-dlp: $(uname -m)"
    exit 1
    ;;
esac
curl -L "${YT_DLP_URL}" -o /usr/local/bin/yt-dlp
chmod 0755 /usr/local/bin/yt-dlp

APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
BGUTIL_VERSION="${BGUTIL_VERSION:-1.3.1}"
sudo -u "${APP_USER}" mkdir -p "${APP_HOME}/.config/yt-dlp/plugins"
curl -fsSL \
  "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_VERSION}/bgutil-ytdlp-pot-provider.zip" \
  -o "${APP_HOME}/.config/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip"
chown "${APP_USER}:${APP_USER}" "${APP_HOME}/.config/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip"

if [[ ! -d "${APP_HOME}/bgutil-ytdlp-pot-provider/.git" ]]; then
  sudo -u "${APP_USER}" git clone --single-branch --branch "${BGUTIL_VERSION}" \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    "${APP_HOME}/bgutil-ytdlp-pot-provider"
else
  sudo -u "${APP_USER}" git -C "${APP_HOME}/bgutil-ytdlp-pot-provider" fetch --tags
  sudo -u "${APP_USER}" git -C "${APP_HOME}/bgutil-ytdlp-pot-provider" checkout "${BGUTIL_VERSION}"
fi
sudo -u "${APP_USER}" bash -lc "cd '${APP_HOME}/bgutil-ytdlp-pot-provider/server' && npm install && npx tsc"

mkdir -p "${APP_DIR}" "${APP_DIR}/data" "${APP_DIR}/logs"
rsync -a \
  --exclude node_modules \
  --exclude logs \
  --exclude .git \
  --exclude data/memory.json \
  --exclude data/usage.json \
  ./ "${APP_DIR}/"

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm ci --omit=dev"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  if [[ -f "${APP_DIR}/.env.production.example" ]]; then
    cp "${APP_DIR}/.env.production.example" "${APP_DIR}/.env"
  else
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  fi
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  echo "Created ${APP_DIR}/.env from .env.example. Edit it before starting the service."
fi

if [[ ! -f "${APP_DIR}/data/memory.json" ]]; then
  cat > "${APP_DIR}/data/memory.json" <<'JSON'
{
  "serverInstructions": {},
  "userInstructions": {}
}
JSON
fi

if [[ ! -f "${APP_DIR}/data/usage.json" ]]; then
  cat > "${APP_DIR}/data/usage.json" <<'JSON'
{
  "version": 1,
  "model": "gemini-2.5-flash",
  "dailyLimit": 20,
  "days": {},
  "lastError": null
}
JSON
fi

chown "${APP_USER}:${APP_USER}" "${APP_DIR}/data/memory.json" "${APP_DIR}/data/usage.json"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Discord Gemini Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${APP_DIR}/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=false
ReadWritePaths=${APP_DIR}/data ${APP_DIR}/logs

[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

echo "Install complete."
echo "Edit env: sudo nano ${APP_DIR}/.env"
echo "Start: sudo systemctl start ${SERVICE_NAME}"
echo "Logs: sudo journalctl -u ${SERVICE_NAME} -f"
