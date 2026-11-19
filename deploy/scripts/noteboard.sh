#!/bin/sh
# Everyday commands for a Noteboard Homelab Edition installation (CasaOS or Docker Compose).
# Run on the Docker host:  sh noteboard.sh <command>
#   status        containers and health
#   token         print the one-time setup token (first run only)
#   logs [svc]    follow a service log (api, worker, gateway, mongo, redis, init)
#   backup        make a backup now
#   recover EMAIL single-use password link for a locked-out account (add --disable-mfa if needed)
#   smoke URL     check that URL answers like a healthy Noteboard
set -eu
P="${NB_INSTANCE:-noteboard}"
cmd="${1:-status}"
case "$cmd" in
  status)
    docker ps -a --filter "name=^${P}-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    ;;
  token)
    docker exec "${P}-api" node cli.js setup-token
    ;;
  logs)
    docker logs -f --tail 200 "${P}-${2:-api}"
    ;;
  backup)
    docker exec "${P}-api" node cli.js backup
    ;;
  recover)
    [ -n "${2:-}" ] || { echo "usage: noteboard.sh recover you@example.com [--disable-mfa]"; exit 1; }
    docker exec "${P}-api" node cli.js recover-admin --email "$2" ${3:-}
    ;;
  smoke)
    URL="${2:-http://127.0.0.1:8765}"
    for p in /healthz /api/v1/health /api/v1/ready /api/v1/discovery; do
      code=$(curl -s -o /dev/null -w '%{http_code}' "$URL$p")
      echo "$code $URL$p"
      [ "$code" = 200 ] || fail=1
    done
    curl -sI "$URL/" | grep -i -E '^(content-security-policy|x-frame-options|x-content-type-options):' || true
    exit "${fail:-0}"
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 1
    ;;
esac
