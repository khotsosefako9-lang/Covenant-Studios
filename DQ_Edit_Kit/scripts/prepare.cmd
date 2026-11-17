@echo off
REM Converts the iPhone .MOV files into 1080x1920, 30fps H.264 copies Remotion can read.
REM Put IMG_4744.MOV and IMG_4764.MOV in this kit's "raw-in" folder first. Needs ffmpeg on PATH.
cd /d "%~dp0.."
if not exist raw-in mkdir raw-in
for %%F in (IMG_4744 IMG_4764) do (
  if exist "raw-in\%%F.MOV" (
    ffmpeg -y -i "raw-in\%%F.MOV" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "remotion\public\raw\%%F.mp4"
  ) else ( echo Missing raw-in\%%F.MOV )
)
