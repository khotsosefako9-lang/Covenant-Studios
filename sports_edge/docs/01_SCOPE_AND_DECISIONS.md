# 01 — Scope, intent and non-goals

## Business requirements (frozen unless user explicitly changes)
- Cross-day windows: Champions League Tuesday AND Wednesday; domestic football Saturday AND Sunday; configurable for other competitions. ONE primary candidate combined slip per window (or NO BET), NOT mandatory day-by-day tickets. All timestamps shown in South Africa Standard Time (Africa/Johannesburg), UTC stored internally. See `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md`.
- Initially: men's top-tier football. Expansion to other sports/competitions is separate research requiring their own data, settlement rules and models. No automatic 'find any sport at 10 odds'.
- Market priority: (1) player total shots; (2) player shots on target; (3) team and match corners; (4) player to be booked; (5) shot on target from outside penalty area (disabled until data/settlement rule verified). Non-default: match result, BTTS, goals winner markets. No requirement to include each category every weekend.
- Bookmaker: Betway SA, manually entered pre-match **quoted** odds and final combined bet-slip price. Other books may be compared for context but may not be falsely treated as executable Betway prices.
- Deliver a combined **window-level** slip report with optional daily watchlists for each included day; include all considered/rejected markets. No obligation to produce a ticket. **Minimum bookmaker-accepted combined decimal odds = 10.00, NO upper cap**. Apply minimum only AFTER individual/joint value and risk gates. No preference for being close to 10.00 or arbitrarily high.
- Only user places bets; an accepted bookmaker combination can differ from the product of displayed individual prices or be disallowed entirely. App never clicks Bet Now.
- Default mode: DATA_BLOCKED until lawful sources and coverage verified; then RESEARCH_ONLY -> PAPER_TRADING. No automation that spends money is allowed at any stage.
- Cost: free libraries, free permitted data; Claude Code may itself have subscription/usage constraints. Track any quotas.

## Architectural boundary
Inputs -> provenance/licence and data-quality validation -> chronological feature engineering -> probability models -> model validation and uncertainty -> exact bookmaker quote/manual confirmation -> single-market robust edge gates -> slip correlation/acceptance gate -> risk gate -> Council review -> output -> user manual verification -> paper/actual result ledger (user entries only).

LLM can research and review assumptions but **must never be source of numeric player statistics or probability estimates unless independently retrieved and verifiable**. Bookmaker quotes must originate from user's Betway SA interface or an authorised verified feed, not LLM inference.

## Risks to eliminate
- False player-club mapping, stale squad lists and changes to starting lineups.
- Season-to-date 4–5 game averages masquerading as stable probabilities.
- Wrong market: `3+ shots` vs `over 3.5 shots`, `2+ SOT` vs `2+ total shots`, or `bookings` vs booking-points.
- Non-comparable provider definitions, corner awarded but not taken, card to substitute/staff, blocked shot/SOT ambiguity.
- Lack of historical *point-in-time* player-prop odds; backtests with fictional opening/closing odds.
- Correlated accumulators and stake concentration.
- Survivorship/selection bias, looking at many thresholds then reporting winners, hot-hand logic, and publication bias.
- Faked Council consensus and the inability of LLMs to confer calibrated confidence.
- Withdrawal restrictions/minimums, erroneous inclusion of stake in net profit, boost miscalculations, and cash available vs unsettled winnings.

## Decision on so-called 'high confidence'
The engine reports confidence **in the reliability of the estimate** (calibration, uncertainty, provenance), not confidence that a 10x ticket will actually win. It must display predicted ticket-win likelihood prominently. Model confidence cannot be used as an invented percentage. 'A+' and 'extremely confident' are banned unless defined in terms of pre-registered objectively tested checks.

## Non-goals
- No autonomous placement, account login, bookmaker scraping that violates terms, market manipulation, paid arbitrage feed, guaranteed profit, 100% hit rates or 'sniper' parlays.
- No stock-trading/MT5 bridge, no unrelated Claude Code project modifications.
