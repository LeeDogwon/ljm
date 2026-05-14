#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-discord-gpt-agent}"
ACTION="${1:-status}"

case "${ACTION}" in
  start|stop|restart|status)
    sudo systemctl "${ACTION}" "${SERVICE_NAME}"
    ;;
  logs)
    sudo journalctl -u "${SERVICE_NAME}" -f
    ;;
  tail)
    sudo journalctl -u "${SERVICE_NAME}" -n 100 --no-pager
    ;;
  doctor)
    cd /opt/discord-gpt-agent
    node scripts/doctor.js
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|tail|doctor}"
    exit 1
    ;;
esac
