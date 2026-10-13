# 03 — Data contracts, identities, timestamps, and evidence

## Immutable entities
- `competition`: canonical competition ID, season dates, provider aliases, country and timezone.
- `fixture`: provider IDs and canonical ID, HOME/AWAY canonical team IDs, scheduled kickoff `utc` and last known schedule update, league, venue.
- `player`: provider IDs, canonical stable ID, birth-year where legitimately available to prevent collisions, historical team membership **as of match date**, display name, eligible position, current injury status with provenance.
- `player_match`: fixture/player, started/subbed-on/subbed-off, minutes, role and eligible markets. NULL is unknown; never quietly assign 90 minutes or substitute false as 0.
- `event`: fixture/player, precise event type, minute, additional injury time, x/y coordinates + coordinate system, source outcome, exact type mapping, source event ID, corrections, provider. Store event history needed to count shots/SOT without double counting a goal as two events.
- `market_quote`: bookmaker region/legal entity, event, timestamp (`observed_at_utc`), original exact label, market ID if visible, selection, direction, threshold, decimal price, promotion/boost applicability UNKNOWN until verified, settlement-rule version, manual evidence file ID/image or URL, capture method, expiry/status.
- `prediction`: feature-as-of timestamp, model artifact SHA/version, input dataset snapshot SHA, market, player, baseline and adjusted probabilities, uncertainty bound, model calibration status, expected minutes, sample size/effective sample size, reason codes, decision timestamp, future evaluation labels.
- `accumulator`: candidate leg IDs, mathematical correlation treatment, actual bookmaker combined offered odds (if verified), stake, break-even, joint predictive probability + uncertainty, expected return, risk budget, Council vetoes, signed user confirmation status.
- `ledger`: transactions `DEPOSIT`, `STAKE`, `RETURN`, `VOID_REFUND`, `WITHDRAWAL`, `ADJUSTMENT`; ZAR exact decimals, unique transaction IDs, timestamps, bet IDs, reconciled status and cumulative bankroll. No silent overwrites.

## Point-in-time correctness
Separate `event_time`, `published_at`, `fetched_at`, `available_to_user_at`, `as_of_prediction_at`, `kickoff_utc`. Do not assume a fact was known pre-kickoff because it has a historical match date. Backtests must use availability time and versioned snapshots, not latest canonical tables. Store raw responses and raw manual quotations with hash and metadata; maintain append-only corrections.

## Validation constraints
- Canonical ID collisions/aliases, 2 players with same name, team transfers and loan spells -> quarantine ambiguous records.
- 0 <= shots_on_target <= total_shots if source definitions are compatible; if not, quarantine and investigate.
- Negative shots, goals, corners or minutes -> quarantine.
- Shots outside the box requires explicit pitch coordinates and tested boundary transforms. Player 'shot on target from outside the box' must be a distinct event-based count, **not** all long-range attempts.
- Exact threshold mapping: `over 2.5 shots` means at least 3; `3+ shots` means at least 3; `over 3.0` may have push mechanics that differ from 3+; do not collapse them without rule mapping. On a 0.5 line, there is no integer push.
- `player_booking` settlement: football yellow/red, player on pitch, substitute, coaching staff and rescinded cards require market-specific rules. A first yellow and second yellow/red are not uniformly counted across all offers.
- `team_corners` count taken, not merely awarded if Betway settlement requires taken. Include stoppage time in 90-minute markets; extra time excluded unless specifically stated.
- Mark `lineup_status`: CONFIRMED_STARTER, CONFIRMED_SUB, UNKNOWN, ABSENT; only starters eligible for user-specified player markets until the bookmaker rule is confirmed otherwise.
- Status enum: `SOURCE_BLOCKED`, `DATA_INSUFFICIENT`, `MODEL_UNVALIDATED`, `QUOTE_UNVERIFIED`, `LINEUP_UNVERIFIED`, `RULE_UNVERIFIED`, `CORRELATION_UNRESOLVED`, `NEGATIVE_OR_UNCERTAIN_EDGE`, `RISK_REJECTED`, `COUNCIL_VETO`, `PROVISIONAL`, `ELIGIBLE_PAPER_ONLY`, `NO_BET`.

## Manual Betway capture form (required fields)
Date/time SAST, kickoff time SAST, sport, fixture, player/team, original selection string, market description, over/under or yes/no, exact numerical threshold, standalone decimal odds, event/market identifiers if available, Betway SA confirmation screenshot filename, verified starters, settlement rule source/offer disclaimer, screenshot time and final bet-slip accepted combined odds. Do not store account balance screenshots unless user explicitly decides to; redact personal and financial details.

## Display
Every output must show full entity labels and exact market: e.g. `PLAYER_SHOTS | Player X | Over 2.5 | 3+ | 1.80 (Betway ZA 13:58 SAST)` instead of just `Player X shots`. Show `UNKNOWN` rather than a fake value when fields are unavailable.
