> **CROSS-DAY SPEC, effective 12 October 2026:** `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md` supersedes any one-slip-per-day assumptions. Tue+Wed UCL and Sat+Sun domestic windows; >=10.00 is the MINIMUM accepted combined price, with NO maximum; never force weak legs. Full handover remains research-only.

> **TIME-SENSITIVE LAUNCH:** For 13–14 October 2026, implement `launch/LAUNCH_PROMPT.md` as a fail-closed two-day UCL preflight, then continue normal Phase 0/1. This does not waive evidence gates.

# Permanent rules for Sports Edge

Read `README.md`, `START_HERE_PROMPT.md` and `docs/` before implementing changes. The source register is a dated audit, not permanent proof of permission; recheck access and licensing.

## Non-negotiables
1. RESEARCH_ONLY by default. Never connect to a bookmaker account, automate logins/clicks/bets/deposits/withdrawals, bypass access controls, or infer bets were placed.
2. Never fabricate prices, historical event observations, sample sizes, teams, current player rosters, starting XIs, referee assignments, sources, model outputs, Council approvals, or profitability.
3. Free tooling ONLY. No paid APIs, trials requiring a paid upgrade, or cloud spending without separate explicit consent. Usage of existing Claude Code access does not make ongoing inference free.
4. Only `player_shots`, `player_sot`, `player_booking`, `team_corners`, `match_corners` in MVP; `outside_box_sot` = disabled until explicit eligibility check. No automatic outright match-winner bets.
5. Exact market and line must match the actual bookmaker quote and settlement definition. All Betway South Africa odds are manually supplied and verified; foreign Betway markets are not interchangeable.
6. No recommendation if inputs stale, lineup unavailable, missing, terms unclear, model not validated, price missing, correlated probability not supported, or bankroll limits exceeded.
7. Do not use post-kickoff, later-revised, or otherwise unavailable information in historical pre-kickoff predictions. Immutable as-of data snapshots and predictions are essential.
8. Do not mistake AI Council consensus, historical hit rate, or a simple count model for independent validation.
9. If no eligible value bets: output NO BET. Never inflate number of legs to reach odds 10.00.
10. No chasing, martingale, compounding after losses, forced weekend wagers, or bankroll replenishments. Real-money mode must NOT be implemented as automatic placement.
11. Write deterministic tests before introducing complexity; record source-specific coverage and licensing blockers.
12. Work in this project only; don't modify unrelated MT5, Claude Code, skills, system or personal files.

## First task
Only run the Phase 0 feasibility/source-rights audit and Phase 1 arithmetic/data-contract tests described in `docs/07_BUILD_PLAN_ACCEPTANCE.md`. Stop for review if reliable, permitted data is unavailable. Do NOT report any 10.00+ picks.
