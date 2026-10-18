#!/bin/bash
# make-audio.sh — Generate the 10-minute white noise loop the skill streams.
#
# The level is deliberately low. Full-scale noise (mean -5.7 dB) was only
# comfortable at device volume 2; volume=0.15 lands around mean -22 dB, which
# sits comfortably near device volume 4 for a whole night.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/../audio/white-noise-10min.mp3}"
VOLUME="${VOLUME:-0.15}"

mkdir -p "$(dirname "$OUT")"
ffmpeg -y -loglevel error \
  -f lavfi -i "anoisesrc=c=white:r=44100" \
  -af "volume=${VOLUME}" \
  -ar 44100 -ac 1 -t 600 \
  -codec:a libmp3lame -b:a 128k \
  "$OUT"

echo "✓ Generated: $OUT"
ffmpeg -hide_banner -i "$OUT" -af volumedetect -f null - 2>&1 | grep -E 'mean_volume|max_volume'
