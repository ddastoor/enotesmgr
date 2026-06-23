#!/usr/bin/env bash
# dev.sh — (re)start the local dev server + ngrok tunnel for phone testing.
#
# Idempotent: kills any serve.py / ngrok previously started, then launches fresh
# ones and prints the public ngrok URL. Run it again any time to restart cleanly.
#
# Usage:
#   ./dev.sh                       # start on port 8000 with a random ngrok URL
#   NGROK_DOMAIN=you.ngrok-free.app ./dev.sh   # use your reserved (stable) domain
set -euo pipefail

PORT="${PORT:-8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Stopping any existing dev server / ngrok..."
pkill -f "serve.py" 2>/dev/null || true
pkill -f "ngrok http" 2>/dev/null || true
sleep 1

echo "Starting serve.py on :$PORT ..."
nohup python3 "$ROOT/serve.py" --port "$PORT" >/tmp/mynotes-serve.log 2>&1 &

echo "Starting ngrok ..."
if [ -n "${NGROK_DOMAIN:-}" ]; then
    nohup ngrok http --domain="$NGROK_DOMAIN" "$PORT" >/tmp/mynotes-ngrok.log 2>&1 &
else
    nohup ngrok http "$PORT" >/tmp/mynotes-ngrok.log 2>&1 &
fi

# Wait for ngrok's local API to come up, then print the public https URL.
echo -n "Waiting for ngrok URL"
URL=""
for _ in $(seq 1 30); do
    URL="$(curl -s http://localhost:4040/api/tunnels \
        | grep -o 'https://[^"]*\.ngrok[^"]*' | head -n1 || true)"
    [ -n "$URL" ] && break
    echo -n "."
    sleep 1
done
echo

if [ -n "$URL" ]; then
    echo "Public URL: $URL"
    echo "(local: http://localhost:$PORT  |  ngrok dashboard: http://localhost:4040)"
else
    echo "ngrok URL not found yet — check /tmp/mynotes-ngrok.log or http://localhost:4040"
fi
