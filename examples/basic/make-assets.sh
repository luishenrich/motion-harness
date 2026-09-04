#!/usr/bin/env bash
# Generates the two audio files the example needs (a music bed and a click), so the repo ships no binaries.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p public
ffmpeg -y -v error -f lavfi -i "sine=frequency=110:duration=8" -f lavfi -i "sine=frequency=165:duration=8" -filter_complex "[0:a][1:a]amix=inputs=2,volume=0.5,tremolo=f=2:d=0.4" -c:a libmp3lame -q:a 4 public/bed.mp3
ffmpeg -y -v error -f lavfi -i "sine=frequency=1800:duration=0.08" -af "afade=t=out:st=0.02:d=0.06,volume=0.8" -c:a libmp3lame -q:a 4 public/click.mp3
ls -la public
