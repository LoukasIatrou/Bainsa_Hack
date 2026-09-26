#!/usr/bin/env bash
# Prove text-to-speech is actually audible.
#
# The browser will happily accept speak() and emit all its events while making
# no sound at all, so "it didn't throw" proves nothing. This records the audio
# device and measures the signal, which is the only honest test.
set -uo pipefail

SINK="$(pactl get-default-sink 2>/dev/null)" || { echo "No PulseAudio/PipeWire."; exit 1; }
DUR="${1:-8}"
RAW="$(mktemp -t ttstest.XXXXXX.raw)"
trap 'rm -f "$RAW"' EXIT

measure () {
  python3 - "$RAW" <<'PY'
import struct, sys, os
p = sys.argv[1]
if not os.path.exists(p) or os.path.getsize(p) == 0:
    print("  RESULT: nothing captured"); sys.exit(2)
d = open(p,'rb').read(); n = len(d)//2
v = struct.unpack('<%dh' % n, d[:n*2])
peak = max(abs(x) for x in v); rms = (sum(x*x for x in v)/n) ** 0.5
loud = sum(1 for x in v if abs(x) > 800)
print(f"  peak={peak}  rms={rms:.0f}  loud_samples={loud}  ({n/16000:.1f}s captured)")
if peak > 1000:
    print("  RESULT: AUDIO DETECTED - speech reached the output device")
    sys.exit(0)
print("  RESULT: SILENCE - nothing reached the output device")
sys.exit(1)
PY
}

echo "Output device: $SINK"
[ "$(pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null)" = "Mute: yes" ] && echo "  WARNING: this sink is MUTED"
echo

echo "[1/2] System TTS (speech-dispatcher -> espeak-ng)"
parecord --device="${SINK}.monitor" --format=s16le --rate=16000 --channels=1 "$RAW" &
REC=$!; sleep 1
timeout 10 spd-say -w "System speech test, one two three" >/dev/null 2>&1
sleep 1; kill $REC 2>/dev/null; wait $REC 2>/dev/null
measure; SYS=$?
echo

echo "[2/2] Browser TTS - you have ${DUR}s"
echo "  Open the harness and press 'Speak test' now."
echo "  (npm start opens Chrome with --enable-speech-dispatcher for you)"
: > "$RAW"
parecord --device="${SINK}.monitor" --format=s16le --rate=16000 --channels=1 "$RAW" &
REC=$!
for i in $(seq "$DUR" -1 1); do printf "\r  recording... %2ds " "$i"; sleep 1; done
printf "\r                        \r"
kill $REC 2>/dev/null; wait $REC 2>/dev/null
measure; BROWSER=$?
echo
echo "───────────────────────────────────────────────"
[ $SYS -eq 0 ] && echo "  system TTS  : WORKING" || echo "  system TTS  : SILENT  -> check the output device / volume"
[ $BROWSER -eq 0 ] && echo "  browser TTS : WORKING" || cat <<'MSG'
  browser TTS : SILENT
    - Chrome needs --enable-speech-dispatcher (npm start does this)
    - Firefox works without a flag
    - Electron panes report zero voices and can never speak
    - Press "Run diagnostic" in the harness to see the voice count
MSG
