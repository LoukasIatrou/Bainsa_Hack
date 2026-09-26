#!/usr/bin/env bash
# Start the harness and open it in a browser that can actually speak.
#
# Desktop Chrome on Linux disables speech-dispatcher by default, so
# SpeechSynthesis reports ZERO voices and speak() is silently a no-op.
# --enable-speech-dispatcher is the whole fix (verified: 0 voices without it,
# 14,824 with). Android Chrome needs none of this.
set -euo pipefail
cd "$(dirname "$0")"

URL="http://localhost:5173"
LAN_IP="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[0-9.]+' | head -1 || true)"

npm run dev -- --host &
VITE_PID=$!
trap 'kill $VITE_PID 2>/dev/null || true' EXIT

# Wait for Vite rather than guessing.
for _ in $(seq 1 40); do
  if (exec 3<>/dev/tcp/127.0.0.1/5173) 2>/dev/null; then break; fi
  sleep 0.25
done

echo
echo "  Harness:  $URL"
[ -n "$LAN_IP" ] && echo "  On phone: http://$LAN_IP:5173   (only place navigator.vibrate is real)"
echo

if command -v google-chrome >/dev/null; then
  google-chrome --enable-speech-dispatcher "$URL" >/dev/null 2>&1 &
elif command -v firefox >/dev/null; then
  firefox "$URL" >/dev/null 2>&1 &   # Firefox reaches speech-dispatcher unflagged
else
  echo "Open $URL in Chrome with --enable-speech-dispatcher, or in Firefox."
fi

wait $VITE_PID
