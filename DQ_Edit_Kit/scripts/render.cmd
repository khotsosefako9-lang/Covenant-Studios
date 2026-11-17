@echo off
REM Renders both edits into remotion\out. Close heavy apps first: this laptop is slow.
cd /d "%~dp0..\remotion"
call npx remotion render src/index.ts Briefing out/DQ_Briefing.mp4 --codec=h264 --crf=18
call npx remotion render src/index.ts QualifiedLead out/DQ_QualifiedLead.mp4 --codec=h264 --crf=18
