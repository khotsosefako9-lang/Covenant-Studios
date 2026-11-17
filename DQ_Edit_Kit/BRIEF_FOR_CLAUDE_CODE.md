# Brief: edit two Duly Qualified talking-head videos

You are editing two short vertical videos for **Duly Qualified (DQ)**, a South African business that gives security, CCTV and cleaning firms 20 qualified leads a month plus tender finding and bid preparation. The owner, Khotso Sefako, filmed himself on an iPhone. Your job is to turn the raw clips into finished TikTok / Instagram Reels / Facebook videos using the Remotion project in this kit.

The project is already built and tested with stand-in footage. Your work is mainly: get the real footage in, check the timings against what he actually says, render, and fix anything that looks wrong.

## What's in this kit

| Folder | What it is |
| --- | --- |
| `remotion/` | The edit, as code. `src/edits.ts` holds every timing; `src/graphics.tsx` the DQ motion graphics; `src/DQEdit.tsx` the layout, zooms and captions. |
| `brand/` | Official DQ logos, colour palette, `tokens.css`, and `BRAND.md` (rules). |
| `remotion/public/fonts/` | Hanken Grotesk and Newsreader (SIL Open Font License, licences included). |
| `transcripts/` | Descript transcripts of both raw clips (phrase-level timings, name corrected). |
| `scripts/` | `prepare.cmd` (convert the iPhone .MOV files) and `render.cmd` (render both). |

## The two clips

| Composition | Raw file | Length | What he says |
| --- | --- | --- | --- |
| `Briefing` | `IMG_4764.MOV` | 43.6 s | "Security company owners, this one hurts…" Miss the compulsory briefing and your bid is disqualified. Sign the register. Comment CHECK. |
| `QualifiedLead` | `IMG_4744.MOV` | 57.1 s | "Greetings, my name is Khotso Sefako from Duly Qualified…" What a qualified lead is: hand-checked, in operation, needs the service, contact details plus an opening message, yours alone. Comment SAMPLE. |

Both raw files are about 85 MB each, on Khotso's laptop and in his Google Drive folder.

## Steps

1. **Check the tools.** Run `node -v`, `npm -v` and `ffmpeg -version`. Node 18 or newer is needed. If ffmpeg is missing, install it (`winget install Gyan.FFmpeg`), then open a new terminal.
2. **Install.** In `remotion/`, run `npm install`.
3. **Add the footage.** Make a folder `raw-in/` next to `remotion/`, copy `IMG_4744.MOV` and `IMG_4764.MOV` into it, then run `scripts\prepare.cmd`. It writes `remotion/public/raw/IMG_4744.mp4` and `IMG_4764.mp4` (1080x1920, 30 fps, H.264). If a clip was filmed sideways, stop and tell Khotso rather than cropping his head off.
4. **Check the real length.** Run `ffprobe -v error -show_entries format=duration -of csv=p=0 remotion/public/raw/IMG_4764.mp4` (and the same for 4744). If either differs from `duration` in `src/edits.ts` by more than 0.2 s, update `duration`.
5. **Preview.** Run `npm run studio` and scrub both compositions. Check each item in the QA list below against the real footage.
6. **Retime if needed.** All times live in `src/edits.ts`, in seconds of the raw clip. The SRT text inside that file drives the word-by-word captions: correct any word Descript misheard there. Keep every overlay starting on, or just before, the word it illustrates.
7. **Render.** Run `scripts\render.cmd`. The finished files land in `remotion/out/`. On this laptop each render takes several minutes: close Chrome and other heavy apps first, and don't raise the concurrency in `remotion.config.ts`.
8. **Report back to Khotso** with the two file paths and anything you changed or couldn't fix.

## The edit, beat by beat

### Briefing (IMG_4764)

| Raw time | He says | On screen |
| --- | --- | --- |
| 0.2–3.0 | "Security company owners, this one hurts." | Slight punch-in. Headline top left: kicker SECURITY COMPANY OWNERS, then "This one *hurts.*" |
| 3.1–7.8 | "look for these three keywords" | Speaker, captions |
| 7.0–11.2 | "compulsory briefing attendance" | Full-screen cutaway: tender document; the three words get a red highlight as he says each one |
| 11.4 | "Why?" | Hard punch-in |
| 16.0–18.0 | "disqualified automatically" | Punch-in plus a red DISQUALIFIED stamp with a red flash |
| 18.3–21.9 | "doesn't matter how good your pricing is" | Split: speaker card on top, panel below: "Lowest price" gets struck through, "*Still disqualified.*" |
| 22.0–26.0 | "jot this down… diary" | Split: "Briefing session" checklist ticks Date, Time, Venue |
| 26.1–30.0 | "sign the register" | Full-screen cutaway: attendance register, a signature draws on the "Your company" row |
| 30.0–32.7 | "Very important, sign the register" | Hard punch-in |
| 36.0 | "Right?" | Hard punch-in |
| 36.9–43.6 | "Comment check…" | Red "Comment CHECK" card, top left |
| 43.6–45.8 | (after he stops) | Ivory end card: DQ mark, Comment CHECK, dulyqualified.co.za |

### QualifiedLead (IMG_4744)

| Raw time | He says | On screen |
| --- | --- | --- |
| 0.9–4.6 | "Greetings. My name is Khotso Sefako from Duly Qualified." | Lower third: DQ mark, "Khotso Sefako", "Founder, Duly Qualified" |
| 5.2–11.0 | "a random list of phone numbers… could not be further from the truth" | Split: a masked list of numbers scrolls, then gets struck through: "*Not this.*" Hard punch-in on "truth" |
| 12.6–17.7 | "every lead is hand-checked by me personally" | Headline: "Every lead, *hand-checked.*" with a slow push-in |
| 17.9–28.4 | "in operation… in need of the specific services… two very important factors" | Split: DQ checklist ticks "In operation" then "Needs your service". Hard punch-in on "two very important factors" |
| 29.0–37.2 | "contact details and one initial outreach message" | Split: a lead card fills in, then an opening message types out |
| 42.3–48.3 | "yours and yours alone… not shared amongst your competitors" | Split: a red lock snaps shut: "Yours alone." / "*Never shared with competitors.*" |
| 48.4–57.1 | "Comment sample… 15-minute call" | Red "Comment SAMPLE" card, top left |
| 57.1–59.3 | (after he stops) | Ivory end card |

## Style rules (from the references Khotso chose, done the DQ way)

Khotso's references are fast talking-head edits where the speaker keeps getting interrupted by motion graphics that act out what he says: punch-in zooms, word-by-word captions, split screens and full-screen cutaways. Use the same rhythm, but every graphic must be built from DQ's own world and brand. Never copy a reference's layout, colours or effects one for one.

- **Something changes every 2 to 4 seconds:** a cut, a zoom, a graphic or a caption beat. Don't leave a static frame longer than 5 seconds.
- **Captions:** 1 to 3 words at a time, Hanken Grotesk 900 in ivory. Key words (set in `keywords` in `edits.ts`) are Newsreader Italic in soft red. No emoji, no other colours.
- **Graphics show DQ's world:** tender documents, registers, stamps, checklists, lead cards. No stock icons, no generic tech graphics.
- **Colour:** navy, ivory and red only (see `brand/BRAND.md`). Red is for the one thing that matters in each beat.
- **Safe zone:** nothing important below y = 1540 or in the right-hand 140 px between y = 900 and 1560, because TikTok's buttons and caption cover those areas.
- **Logo:** use only the PNGs in `brand/`. Never redraw, recolour or generate a DQ logo.
- **Copy:** plain South African English. Don't invent numbers, clients or results. The phone numbers in the list are masked on purpose.
- **Never** show or mention AI, Claude or ChatGPT in the videos.
- **Audio:** keep his voice clean. If you add music, keep it under his voice (about -20 dB) and only use tracks he has the rights to. Otherwise leave it for him to add in TikTok.

## QA before you hand it over

- [ ] Captions match what he says, word for word, and the name is "Khotso Sefako".
- [ ] Each graphic lands on its word, not before he starts the sentence or after he's moved on.
- [ ] His head is never cut off by a punch-in. If it is, lower that zoom's `scale` in `edits.ts`.
- [ ] Nothing important sits in the TikTok safe zone.
- [ ] Captions never overlap a graphic.
- [ ] The audio plays all the way through cutaways, and nothing is out of sync.
- [ ] The end card shows for about 2 seconds after he stops talking.
- [ ] Output is 1080x1920, 30 fps, H.264 with AAC audio. Check with `ffprobe`.

## If something goes wrong

- **Remotion can't play the video:** you skipped `prepare.cmd`. iPhone HEVC files often won't decode in Remotion's browser.
- **The fonts look like Arial:** the files in `public/fonts/` are missing or were renamed.
- **The render is very slow or the laptop freezes:** set concurrency to 1 in `remotion.config.ts` and render one composition at a time.
