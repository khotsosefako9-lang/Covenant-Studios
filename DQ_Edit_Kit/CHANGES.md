# Changes after first pass on the real footage (17 Nov 2026)

## The two Drive files are labelled the other way round from the brief

| Drive file | What he actually says | Length | Composition |
| --- | --- | --- | --- |
| `IMG_4744.MOV` | "Security company owners, this one hurts…" | 43.6 s | `Briefing` |
| `IMG_4764.MOV` | "Greetings, my name is Khotso Sefako…" | 57.1 s | `QualifiedLead` |

`edits.ts` now points `Briefing` at `IMG_4744.mp4` and `QualifiedLead` at `IMG_4764.mp4`. The SRT text was right; only the file names in the brief (and the names of the files in `transcripts/`) were swapped.

## Retiming (checked against word-level timings of the real audio)

Briefing
- SRT: "compulsory briefing attendance" starts at 8.86 s (was 8.08); "gets disqualified automatically" at 15.76 s (was 15.97).
- Tender page highlights land on "compulsory" 8.86, "briefing" 9.38, "attendance" 9.90.
- DISQUALIFIED stamp at 16.2 s, on the word (was 16.4).
- "Lowest price" is struck on "it gets disqualified" (20.6 s) so "Still disqualified." has time to read.
- Register signature starts on "sign" (28.3 s).

QualifiedLead
- SRT: "So people hear leads…" starts at 3.58 s (was 3.90); "by me personally" at 14.70 s (was 14.94).
- "Every lead, hand-checked." headline starts on "every lead" (13.2 s, was 12.6).
- Checklist ticks on "operation" (20.05 s) and "need" (22.65 s) (were 20.5 and 24.1).
- Lead card: the Contact field fills on "contact details" (32.5 s) and the message types out over "one initial outreach message".
- Lock snaps shut on "alone" (44.35 s, was 43.5).

## Layout fixes for the real footage

- The top of both clips is bright (sky and trees), so the headline and CTA were hard to read: the top of the speaker gradient is darker.
- Captions moved from y 1290 to 1400 so they sit on his shirt, not his chin, with a heavier shadow so red key words read over the brick wall.
- DISQUALIFIED stamp moved up (y 760 to 420) so it no longer covers his eyes.
- Name tag (LowerThird) moved to the top left (y 1000 to 230): in IMG_4764 his face fills the middle of the frame.
- Split layout: the speaker card frames slightly higher and punch-ins zoom from the top of his head, so his hair is never clipped.
- Numbers panel: the scrolling numbers are clipped below the "A LEADS LIST" label (they used to run over it).
- Strike panel: no red stub before the strike starts.

## Other

- `.gitignore` keeps the footage (`public/raw/*.mp4`, `raw-in/`), `node_modules/` and `out/` out of git.
- `scripts/prepare.sh` and `scripts/render.sh` are Linux/macOS versions of the `.cmd` scripts.
