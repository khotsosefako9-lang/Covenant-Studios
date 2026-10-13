# 07 — Build phases, deliverables, acceptance gates and STOP triggers

## Phase 0 — Feasibility and source-rights audit (START HERE)
Tasks:
- Confirm Windows/python/venv environment and Claude Code tools available without touching MT5 project.
- Find existing Council skill; read it and record where found; if missing mark UNKNOWN.
- Audit every free source for actual 2026/27 current-season player shots, SOT, bookings, corners, match-lineup coverage, usage permissions, dates and quota. Document permission evidence, no evasion.
- Confirm Betway SA exact markets and settlement rules through manual market example (user-provided if required). No assumption that foreign market quotes or public free API results correspond.
- Create a source coverage matrix by sport/league/season/market/field and decision reasons.
Deliverables: `reports/PHASE0_FEASIBILITY.md`, `reports/SOURCE_RIGHTS.csv`, list of open blockers, reproducible test commands, zero money-spending code.
**PASS:** at least one selected market/league has legal reliable historical and current data plus a path to manually confirmed Betway prices. **STOP:** no compliant source, or access not known. The outcome of a feasibility audit is allowed to be FAIL.

## Phase 1 — Contracts and pure functions
- Set up Python virtual environment, fixed compatible dependency versions *after* verifying interpreter support; preserve existing Python/MT5 setup.
- Build typed, serialisable objects for event, player, fixture, quote, model decision, accumulator and ledger.
- Confirm UTC conversion & Africa/Johannesburg display; immutability, source SHA, idempotent ingestion, quote time validity.
- Build market payout arithmetic and backtest event scoring with void/push/booking/corner semantics.
- Run standard-library tests in `reference/` as **a starting arithmetic contract**, not an actual betting strategy.
**PASS:** all contract, arithmetic, identity and settlement tests green. **STOP:** any rules unknown or ambiguous, flag `RULE_UNVERIFIED` and disable market.

## Phase 2 — One-market permitted historical data
- Start with ONE league, ONE market only (suggest player total shots IF permitted, otherwise corners if permitted). Manual CSV/import if compliant; no mass scraping of blocked sites.
- Store immutable as-of raw data, missingness and source field definitions. Build source-vs-bookmaker settlement tests and robust player/fixture matching.
**PASS:** sample fixtures reconcile from at least one source and documented source rights permit use. **STOP:** identity/settlement error.

## Phase 3 — Predictive baseline and validation
- Fit empirical/hierarchical baselines and benchmark; expand to suitable count models only if baseline quality warrants.
- Evaluate chronologically, report uncertainty, coverage, selection rate and calibration. No hindsight.
- Do not estimate historical ROI without recorded contemporary player-prop odds; otherwise only report event prediction performance.
**PASS:** reproducible calibration and demonstrated useful out-of-sample performance; **not** a pre-set profit guarantee. **STOP:** no evidence or poor calibration.

## Phase 4 — Quotes and candidate reporting
- Implement manual Betway ZA quote capture with original market text, line, odds, clock and screenshot evidence; require revalidation after lineups.
- Evaluate conservative edge at exact book price and market rules; produce marked provisional candidates and rejected reasons.
- Add independent player and team corner markets only after source and model validation.
**PASS:** selection report every field reproducible, unverified input cannot be `ELIGIBLE_PAPER_ONLY`.

## Phase 5 — Accumulator dependence and ledger
- Enforce joint-probability model or conservative dependency bounds; no naive product for same-match dependent events.
- Record *actual bookmaker accepted* quote for any combination and compare against computed EV.
- Implement ZAR decimal stake, losses, void refunds, open tickets, withdrawals, limit counters and audits; forbid new deposits and auto placement.
**PASS:** collision/correlation and exposure regression tests green. **STOP:** no bookmaker accepted price or dependence unresolved.

## Phase 6 — Council and forward paper-trading
- Load existing skill in read-only fashion; feed quantitative evidence, not stories. Reconcile vetoes.
- Run weekend reports and append-only predictions. Review prospective calibration, price availability and results over sufficiently powered horizon.
- Mode remains `PAPER_TRADING` until evidence and user decision after independent audit; no code should be capable of automatic bookmaker execution.

## Required regression tests (include in automated suite)
1. 2.70*3.00*1.59 = 12.879 decimal, no silent rounding to claimed bookmaker accepted odds; 3% boost must not be presumed.
2. An unverified screenshot price or expired quote can never pass G2.
3. `under 4.5 corners` counts 4 or fewer **taken** corners; 5 loses.
4. `2+ SOT` must fail when a player has exactly 1; `2+ shots` is different.
5. SOT count > total shots triggers a source definition conflict.
6. Last-5 averages with short/injury-sub appearances must not be treated as full-game probability; show denominators and intervals.
7. Missing current club/player association or conflicting IDs -> quarantine, NOT guess from name.
8. Starting XI unknown or confirmed bench -> player markets fail until settlement rule and eligible starter criteria validated.
9. A positive point-estimate EV with nonpositive conservative EV -> REJECT.
10. Council unanimous PASS cannot override one failing deterministic gate.
11. Same-game shots+SOT or corners+shots -> dependence gate; do not multiply marginals.
12. Any additional leg with negative robust EV is not added solely for 10.00 odds.
13. A book's single-match Bet Builder must not be assumed addable to multi-match accumulator.
14. Loss decreases account cash, payout includes stake, withdrawal decreases cash but not gross trading P&L, no bankroll reload.
15. Betting after kickoff or after outdated odds quote is invalid pre-match simulation.
16. Historical prediction must not read revised or later event snapshots.
17. Missing qualified legs -> NO BET report with reason codes, no replacement guesses.
18. If user enters R100 balance and asks for R20 stake, risk gate rejects even if EV is positive.
19. A boost may be applied only using confirmed promotion rules; missing rules -> unboosted or `QUOTE_UNVERIFIED` as appropriate.
20. Repeat identical ingestion or settlement event does not duplicate balances or stats.

## Acceptance evidence package
`git log`, dependency lock/versions, pytest test log, sample input provenance, market rule citation/screenshot, output JSON validated against schema, a negative test that emits NO BET, leakage control test, and one held-out performance summary with all limitations. Document all network requests and quotas. If failure, stop and explain rather than patching assumptions around failure.

## Additional cross-day acceptance tests (12 October update)
The user specified one Tue–Wed UCL candidate search window and one Sat–Sun domestic search window, potentially one mixed-date accumulator across both days. See `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md` for timing/lineup impossibilities and 8 acceptance tests. Implement immutable accepted ticket, earliest-leg submission cutoff, no-append guard, combined-bookmaker quote evidence, allowed price >=10.00 with no upper ceiling, unsettled two-day exposure, and void repricing; tests of pure contract helpers are not sufficient to claim a real-world validated model.
