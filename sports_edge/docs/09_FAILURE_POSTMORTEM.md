# 09 — Previous prediction and selection failures: do not repeat

This is a record of errors/limitations in the preceding conversation to make the failure modes explicit. The match result is known in hindsight; no historical forecast is changed.

## Example: Liverpool vs Manchester City, 2026-10-11
- Earlier analysis assigned Liverpool roughly 35.7% win probability vs Man City 40.7%, with market prices around Liverpool 3.00 and City 2.15. City had strong recent form. Liverpool lost 0–3 according to user's post-match screenshot.
- **Analytical distinction:** proposing a small theoretical +EV Liverpool selection does not necessarily mean Liverpool was the *most likely match winner*. At odds 3.00 and p=0.357, EV=+7.1% by formula; City still had the larger estimated chance of winning. Both statements can be true.
- **Actual failure:** the model probability wasn't independently validated, the +7.1% point estimate was too fragile to treat as meaningful without uncertainty and true Betway rules/availability, and the ticket was padded to a 10x target. The assistant also used loose wording implying a stronger likelihood than evidence supported. The 0–3 result alone does **not** prove a probability forecast was wrong or the market had no edge; quality must be judged prospectively across a sample.
- Required fix: show both most likely outcome and positive expected-value selection as distinct fields; weak EV under uncertainty -> REJECT; do not make winner picks part of default prop system.

## Example: provisional six-leg player prop proposal
- It used purported averages derived from a small current-season sample and arbitrary candidate minimum prices, without verifying *every* current player-club mapping, start status, expected minutes, underlying source permissions, market lines and Betway's offered odds.
- It presented Poisson approximations based on full-game means and '10% reduced rates' as though they were meaningful probability-quality checks. This is not statistical calibration, confidence bounds or opponent adjustment.
- An individual name/club mismatch or stale current-season roster should immediately quarantine a bet candidate; one suspect leg invalidates the whole accumulator.
- It calculated hypothetical combined odds without confirming whether Betway allowed the combination or offered those prices. Such slip was NOT executable, and any calculated payout was only hypothetical.
- Required fix: source rights + player/club IDs + point-in-time stats + expected minutes + verified exact prices + calibrated models + joint probability + user verification.

## Other high-impact failure modes
- False claims that Football-Data.org free API supplies detailed shots/cards/corners; they are premium paid options in published pricing.
- Assuming an open-source scraping client's licence grants permission to extract a protected third-party sports feed; it does not.
- Ignoring Football-Data.co.uk restriction against automated/AI data products on its free data.
- Betting 'outside-the-box SOT' from an unsuitable data source or wrong area coordinates.
- Confusing bookmaker 'bookings' with 'booking points' and cards to staff/subs.
- Counting corners awarded rather than taken for Betway.
- Multiplying same-match player shots and SOT as if independent.
- Assuming a nominal 3% odds boost applies without accepted quote or promotion terms.
- Calling multiple Council viewpoints 'independent statistical confirmation' when they share source model/context.
- Calling positive EV a guaranteed way to withdraw the starting R100.

## Required response style
Plain English, short conclusion. State what is verified vs hypothetical. When unsupported, explicitly state NO BET / PAPER ONLY and which exact records or permissions are missing. Never imply confidence in a profit just because a response contains tables and math.
