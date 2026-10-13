# 13–14 OCT 2026 Champions League two-day research window

This is **not** an operational predictive sports betting system. It is a runnable **research-only preflight and data-validation tool** that Claude can use tomorrow, while building a legally sourced and calibrated model. It is intentionally incapable of qualifying a real-money accumulator.

## What is ready now
- `fixtures_2026-10-13.csv` + `fixtures_2026-10-14.csv`: 18 UCL fixtures across both dates in SAST. **Reverify against UEFA before launch.**
- `windows_2026-10-13_14.json`: shared Tue+Wed window, minimum 10.00 accepted combined price, no maximum.
- `quotes_template.csv`: blank user-entered Betway ZA player shots/SOT/cards/corners offers.
- `manual_event_observations_template.csv`: blank event-level data collection record, with source and permission audit.
- `preflight.py`: checks required offer fields, timing, lineups, sources, rules and provenance; prints reasons rather than inventing data.
- `tests/`: regression checks ensuring unverified or stale offers are rejected.

## Try it right now
Open Windows Command Prompt inside the unpacked package:

```bat
py -m unittest discover -s launch/tests -v
py launch/preflight.py init
py launch/preflight.py audit
```

The `init` command copies blank quote / observation CSVs into `data/`, and `audit` produces `reports/UCL_2026-10-13_14_PREFLIGHT.md`. The expected initial result is **NO BET**, because missing prices and model validation are NOT to be faked. Add Betway screenshot-backed rows to `data/quotes_2026-10-13_14.csv`, rerun audit to see precise blockers.

## Tuesday–Wednesday workflow (SAST)
- **Tonight:** Claude loads the package, tests code, confirms sources/fixtures, sets up lawful data imports; no unverified projections.
- **Tuesday midday:** scan available fixture news and candidate shots/SOT/cards/corners; verify player identities and recent minutes; request manual Betway quote entry.
- **~17:45–18:30:** preflight for 18:45 games, check lineups and current prices. Re-audit immediately before any decision.
- **~20:00–20:45:** redo for 21:00 games. Review actual lineups and prices. Reject stale quotes or unclear void terms.
- **After games:** log observed outcomes, corrections, and source timestamps for future testing; do not tune a model using these results and then claim they were pregame forecasts.

## Honest launch promise
Tuesday–Wednesday = functioning **two-day** data/odds audit, watchlist and NO BET gate. A two-day preflight does NOT equal a validated player prop model, robust 10x strategy or profitable actual bet slip. That will require legitimate historical event data, correct settlement mapping, backtesting and forward evaluation.

## Scheduling
Windows Task Scheduler may invoke `py launch/preflight.py audit` daily when the PC is running. A task is not a promise of autonomous Claude Code inference. Do not configure automated wagers. Do not schedule before quote entry; blank inputs will produce NO BET.

Official fixtures: https://www.uefa.com/uefachampionsleague/news/02a8-2174c9e9019d-f909a77bd77a-1000--2026-27-champions-league-all-the-league-phase-fixtures-a/

## Crucial policy update — Do not force separate daily slips
The user's requirement is one Tue/Wed accumulator search window (as with Sat/Sun domestic), not Tuesday-only then Wednesday-only accumulator obligations. **Betway-accepted combined odds >= 10.00, no maximum.** All selected legs and accepted total price must exist BEFORE the earliest included kickoff; Wednesday player starter status is not confirmed on Tuesday. Do not weaken the existing strict starter gate or the validation rules to meet a calendar deadline. No leg can be added to an already placed ticket. `launch/preflight.py` reviews all 18 fixtures but is still research-only. Full rules: `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md`.

## Cross-day window tool (13 October 2026 update)
Windows are configured in `launch/windows/<window_id>.json`. The default is `UCL_2026-10-13_14`.

```bat
py launch/preflight.py list-windows
py launch/preflight.py init  [--window UCL_2026-10-13_14]
py launch/preflight.py audit [--window UCL_2026-10-13_14]
py launch/preflight.py new-window --kind weekend --start 2026-10-17   :: Sat+Sun
py launch/preflight.py new-window --kind ucl --start 2026-10-20       :: Tue+Wed
```

- **Fixtures** have `verification_status`, `checked_at_sast` and `verification_evidence` columns. Only `VERIFIED_OFFICIAL` lets a quote row pass the fixture gate. The 13–14 Oct fixtures are `CROSS_CHECKED_SECONDARY` because uefa.com could not be reached from the build container. Check them on uefa.com yourself before changing that status. `new-window` creates header-only fixture files and never invents fixtures.
- **Quotes** (`data/quotes_<window>.csv`) have two new columns: `lineup_published_at_sast` and `starter_evidence_path`. A player prop passes the starter gate only with official team-sheet evidence published at a credible time (no earlier than 2 h before kickoff and before the decision time). A second-day player prop audited on day one is reported as `PENDING_LINEUP`.
- **Tickets** (`data/tickets_<window>.csv`): there is one candidate ticket per window. `leg_csv_lines` lists quote CSV line numbers, which may come from either day. The ticket needs a verified Betway-accepted combined price of at least 10.00, with no maximum, plus a screenshot (`combined_evidence_path`). It must be submitted before the earliest included kickoff. A row with `amends_ticket_id` is rejected (`CANNOT_APPEND_TO_STARTED_TICKET` / `CANNOT_APPEND_TO_SUBMITTED_TICKET`). Same-fixture legs need a dependence method. Every ticket currently ends `JOINT_MODEL_NOT_VALIDATED`.
- **Risk**: set `window_start_available_balance_zar` in the window JSON. Caps are computed once for the whole window: 2.5% per ticket, and the lower of 5% or R5 per window. They are not reset on the second day.
