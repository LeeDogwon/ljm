#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-discord-gpt-agent}"
APP_DIR="${APP_DIR:-/opt/discord-gpt-agent}"
ACTION="${1:-status}"

YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
case "$(uname -m)" in
  aarch64|arm64)
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
    ;;
  x86_64|amd64)
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    ;;
esac

case "${ACTION}" in
  start|stop|restart|status)
    sudo systemctl "${ACTION}" "${SERVICE_NAME}"
    ;;
  restart-tail)
    sudo systemctl restart "${SERVICE_NAME}"
    sudo journalctl -u "${SERVICE_NAME}" -n 100 --no-pager
    ;;
  logs)
    sudo journalctl -u "${SERVICE_NAME}" -f
    ;;
  tail)
    sudo journalctl -u "${SERVICE_NAME}" -n 100 --no-pager
    ;;
  doctor)
    cd "${APP_DIR}"
    node scripts/doctor.js
    ;;
  check-ytdlp)
    if command -v yt-dlp >/dev/null 2>&1; then
      echo "yt-dlp path: $(command -v yt-dlp)"
      yt-dlp --version
    else
      echo "yt-dlp path: missing"
    fi
    if command -v ffmpeg >/dev/null 2>&1; then
      echo "ffmpeg path: $(command -v ffmpeg)"
      ffmpeg -version | sed -n '1p'
    else
      echo "ffmpeg path: missing"
    fi
    ;;
  update-ytdlp)
    if [[ -z "${YT_DLP_URL}" ]]; then
      echo "Unsupported architecture for standalone yt-dlp: $(uname -m)"
      exit 1
    fi
    tmp_file="$(mktemp)"
    trap 'rm -f "${tmp_file}"' EXIT
    curl -L "${YT_DLP_URL}" -o "${tmp_file}"
    chmod 0755 "${tmp_file}"
    sudo install -m 0755 "${tmp_file}" /usr/local/bin/yt-dlp
    /usr/local/bin/yt-dlp --version
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|restart-tail|status|logs|tail|doctor|check-ytdlp|update-ytdlp}"
    exit 1
    ;;
esac
