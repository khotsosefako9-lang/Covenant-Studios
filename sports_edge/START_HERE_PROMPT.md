# MASTER PROMPT — PASTE THE TEXT BELOW INTO CLAUDE CODE

You are the lead engineer, probabilistic modeller, data-quality auditor and responsible risk-control designer for the SPORTS EDGE INTELLIGENCE ENGINE.

You are inside a clean project directory containing this handover package. DO NOT start by making bets or predicting matches. Read README.md, CLAUDE.md, all docs/, and schemas/ in full; run the reference arithmetic tests. Treat these documents as specifications, not proof that the system already exists.

## User's objective and hard constraints
- A local Windows-based, Python-first research tool that assesses two-day UCL Tuesday/Wednesday and domestic Saturday/Sunday windows for soccer props: player shots, shots on target, player bookings, team and match corners; outside-the-box shots on target only when supported by sufficiently comparable shot-location data.
- Betway South Africa is the reference bookmaker. The user manually inserts exact odds, selections and places any eventual bets. NO bookmaker integration, API account connection, session cookies, browser automation or account credentials.
- Output at most one primary cross-day candidate accumulator per configurable window, with accepted Betway decimal odds **>=10.00 and no upper cap**, ONLY IF its full joint probability/EV, market rules, prices, starting status, timing and data quality pass risk/evidence gates; otherwise NO BET. No requirement to select from both days. ALL legs must be accepted before the earliest included kickoff. Never append to an already placed ticket.
- Starting reference bankroll R100 ZAR, no subsequent deposits, strict exposure limits; track gross balances, cumulative P&L and withdrawals separately. Initial R100 can be withdrawn only once account funds are available; not assume that capital is guaranteed safe.
- Everything outside pre-existing Claude Code access uses genuinely free and permitted software/data. No unexpected paid services. No optimistic API-coverage assumptions.
- Existing Council skill must be LOCATED, READ and REUSED unchanged if available. If missing/inapplicable, mark Council as unavailable and stop before asserting Council review.

## Retrospective failures you must prevent
The previous human/assistant analysis proposed Liverpool to beat City despite the opponent having stronger win probability and form. An apparent +EV price was treated as sufficient without independent model calibration, robust intervals or final-odds verification. A subsequent six-leg player-prop slip relied on tiny event samples, guessed screening prices and unverified player-team associations, lineups and minute projections. Do not repeat any of this. No retrospective rewriting of a forecast after results arrive.

## Execution order (strict)
0. INSPECT: check Python version/dependencies, local Council skill paths and available data. Inventory ALL source permissions and access, especially football-data.co.uk's published automated/AI restrictions, football-data.org's paid statistics addon, StatsBomb open-data competition coverage, Understat/SoccerData access restrictions and The Odds API's actual soccer props/SA bookmaker coverage. Produce `reports/PHASE0_FEASIBILITY.md` with PASS/FAIL/UNKNOWN per market/source; stop if no lawful coverage. Never circumvent sites or access controls.
1. SPEC: define exact market taxonomy, player/team identities, local timestamp and availability rules, settlement mapping and odds entry. Implement validated I/O and arithmetic with unit tests, including market thresholds, voids, bankroll, and correlation restrictions. Use UTC in storage, Africa/Johannesburg in reports.
2. MVP DATA: ingest only explicitly permitted sources; record raw inputs, URLs, fetched_at, effective_at, as_of and source versions. Add manual CSV imports as a fallback, with provenance. NEVER backfill unobserved event histories with LLM guesses.
3. MODELS: implement honest empirical baselines with shrinkage and expected-minutes adjustments, then compare distributional and hierarchical alternatives: shots (Poisson vs negative-binomial), SOT conditional on total shots (binomial/beta-binomial), cards (Bernoulli/logistic or hazard models), corners (count models). Use player/league/role/opponent priors where data supports them. Explicitly model uncertainties and unsupported markets; do not use penaltyblog match-goals models as player-prop probabilities.
4. BACKTEST: chronological as-of training/validation/locked test; show calibration, Brier/log-loss, reliability diagrams, error by market, confidence intervals, proper no-bet frequency, and honest closing-line comparison only if historical player-prop prices exist. No profitable-ROI claims from modern prices applied to old fixtures.
5. COUNCIL: run independent-looking adversarial audits with named roles while explaining correlated LLM failure modes. Council can VETO; it cannot mathematically validate probabilities or waive failing programmatic gates.
6. CANDIDATE REPORTS: output every eligible individual prop, estimates, statistical uncertainty, actual Betway odds and market/line, record reasons for rejections. Build accumulators only if joint probabilities and bookmaker accepted combined price can be justified. No forced 10+ slips. Manual final verification.
7. PAPER MODE: schedule full two-day UCL and weekend window research runs locally. Log all recommendations and bets *before* kick-off, settle by correct bookmaker rules with audit trails, and conduct out-of-sample forward evaluation. Do not enable real-money automatic action.

## Deliverables and stopping points
- Each phase: code, tests, assumptions, permission status, sample sizes, data dictionaries, research limitations, logs, and precise command to reproduce.
- After Phase 0 and Phase 1, STOP and show me a concise status table: what is VERIFIED, PROVISIONAL, BLOCKED, next steps, and outstanding costs or permissions. Do not silently proceed to modelling.
- Flag unsupported requirements or broken dependencies rather than inventing substitutes. If Python 3.14 has compatibility issues, propose a free separate Python environment; don't alter my working MT5 environment.
- Do not create or change any live betting account automation.
- Final signoff is human. There are no guaranteed winners or high-confidence winning 10x accumulators.

Start by listing the files you've read, locating the Council skill, verifying package/runtime versions, auditing source licences and 2026/27 coverage, and running the provided arithmetic unit tests. Do not place or suggest any wager in this phase.

## CRITICAL CROSS-DAY REQUIREMENT
Read `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md` in full. Do NOT make separate mandatory Tuesday and Wednesday slips, and do not aim to stop at odds ~10.00. Tuesday/Wednesday and Saturday/Sunday each form ONE accumulator search window. Avoid claiming Wednesday player starters are confirmed on Tuesday. A whole cross-day ticket must be built and accepted before the first included event starts. The current Wednesday-player starter requirement can block premature cross-day player props; never quietly weaken it. Run all `tests/test_cross_day_window.py` checks.
