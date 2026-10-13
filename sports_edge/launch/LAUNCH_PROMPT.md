# PASTE INTO CLAUDE CODE — PRIORITY OVERRIDE FOR 13 OCTOBER 2026

You are working in SPORTS EDGE INTELLIGENCE ENGINE. The user's deadline is TOMORROW: **Tuesday 13 October 2026**, with additional Champions League games Wednesday 14 October 2026. The original handover remains binding. The user clarified that **Tuesday 13 + Wednesday 14 form ONE cross-day candidate window**, with a MINIMUM 10.00 combined decimal-odds requirement, no maximum odds, and no forced daily slip. Deliver a **research-only preflight scanner for both** `launch/fixtures_2026-10-13.csv` and `launch/fixtures_2026-10-14.csv` before attempting any forecasts. Read `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md`. Your first job is not to manufacture predictions. Read `CLAUDE.md`, `README.md`, all docs, `launch/README.md`, the launch script, and the tests.

## P0 NOW — non-negotiable
1. Verify ALL **18** Tue–Wed UCL fixtures and SAST kickoffs against UEFA official fixture list. Refresh any changed team names/times; record `checked_at` and evidence. Maintain ONE window ID across both fixture files.
2. Run `python -m unittest discover -s launch/tests -v`; run `python launch/preflight.py init`; run `python launch/preflight.py audit` and inspect the generated NO BET report. It must work in Python standard library with no subscription, live betting API, account login, scraping or wagering functionality.
3. Locate existing Council skill without changing it. Council may reject and investigate candidates, never manufacture probability inputs.
4. Assess lawful available 2026/27 player-shot, SOT, bookings and corner data. If player-level verified records cannot be acquired, mark `SOURCE_BLOCKED` / `DATA_INSUFFICIENT` and prepare only a watchlist. Never fill missing fields with guessed priors or fabricated hits.
5. Create a hand-entry workflow for exact Betway South Africa prop line, event, bookmaker odds, screenshot timestamp, settlement language, starter confirmation and original screenshot. Hide personal/account details and do not store account credentials.
6. Produce a two-day research watchlist/preflight before Tuesday 18:45 SAST (if PC available), including both Tuesday and Wednesday candidates. Every proposed actual mixed-day ticket would have to be submitted with ALL legs before the earliest INCLUDED kickoff; do not claim Wednesday official lineups known on Tuesday, never append Wednesday legs to Tuesday ticket later. Continue research updates Wednesday for NEW watchlists/tickets, not changes to an open slip.
7. Keep scanning both Tuesday and Wednesday in the shared window; then build the configurable Saturday–Sunday window. All output must be timestamped and registered before the relevant earliest included kickoff.

## P0 acceptance criteria
- A functioning local fixture + quote logging + gate-check report tool today.
- No paid tools or unapproved network access.
- Every recommendation remains RESEARCH_ONLY; no automatic betting.
- `NO BET` if no independently calibrated current-season/appropriate multi-season market-specific model and manually confirmed executable prices; cannot be bypassed by Council.
- Any `p` entered manually must cite an independently validated model, model ID, data snapshot, and calibration. Raw Poisson calculations from 4-5 matches do NOT meet the criterion.
- No 10.00 accumulator assembled by multiplying individual probabilities if joint-dependence and bookmaker accepted combined price are unavailable.
- SHOW blockers instead of improvising data or pretending to have a profitable system.

## Deadline communication
Immediately present a GO / BLOCKED matrix: fixture verification, lawful data, usable prop stats, Betway market evidence, validated model, Council found, report generated, and any manual input required from the user. No fake promises. User can place bets manually **only after making an independent decision**; you are not to operate bookmaker accounts.

Cross-day acceptance: run `py -m unittest discover -s tests -v` and `py -m unittest discover -s launch/tests -v`; report 18 fixtures and NO BET if any critical data/probabilities/combined quote are missing. Never cap combined decimal odds; 10.00 is minimum, not aim. No bookmaker wager placement.
