#!/bin/bash
# Linux/macOS version of prepare.cmd: converts the iPhone .MOV files in raw-in/ into
# 1080x1920, 30fps H.264 copies Remotion can read. Needs ffmpeg on PATH.
set -e
cd "$(dirname "$0")/.."
mkdir -p raw-in
for F in IMG_4744 IMG_4764; do
  if [ -f "raw-in/$F.MOV" ]; then
    ffmpeg -y -i "raw-in/$F.MOV" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "remotion/public/raw/$F.mp4"
  else echo "Missing raw-in/$F.MOV"; fi
done
