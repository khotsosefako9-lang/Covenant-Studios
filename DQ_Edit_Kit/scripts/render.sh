#!/bin/bash
# Linux/macOS version of render.cmd: renders both edits into remotion/out.
# Pass a Chrome binary as $1 if Remotion can't download its own (e.g. in a sandbox).
set -e
cd "$(dirname "$0")/../remotion"
B=${1:+--browser-executable=$1}
npx remotion render src/index.ts Briefing out/DQ_Briefing.mp4 --codec=h264 --crf=18 $B
npx remotion render src/index.ts QualifiedLead out/DQ_QualifiedLead.mp4 --codec=h264 --crf=18 $B
