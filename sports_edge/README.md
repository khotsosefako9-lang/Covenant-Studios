> **URGENT OCT 13 2026 LAUNCH:** Start with `launch/README.md` and paste `launch/LAUNCH_PROMPT.md` into Claude Code. Launch is research-only; no betting projections automatically validated.

# SPORTS EDGE INTELLIGENCE ENGINE — CLAUDE CODE HANDOVER
**Version:** 1.0 | **Prepared:** 2026-10-12 | **Mode:** Research and paper trading ONLY

This package is an implementation specification and an auditable arithmetic reference, **not** a working betting algorithm and **not** evidence of a profitable strategy. No real-money recommendation is authorised by this package.

## Intended outcome
A Windows-local, Python-first research system for football **player shots, shots on target, player bookings, team corners, and match corners**, with outside-box on-target shots gated as a specialist market. It should estimate probabilities from legitimate, available historical observations and compare them against **exact, manually verified Betway South Africa** market odds. Tuesday/Wednesday UCL and Saturday/Sunday domestic **cross-day windows** may be `NO BET`. It never accesses bookmaker accounts or places wagers.

## Files — read in order
1. `START_HERE_PROMPT.md` — paste directly into Claude Code.
2. `CLAUDE.md` — persistent project rules for Claude Code.
3. `docs/01_SCOPE_AND_DECISIONS.md` — specifications and non-goals.
4. `docs/02_SOURCE_REGISTER.md` — actual free sources, access caveats, red flags, citations/links.
5. `docs/03_DATA_CONTRACT.md` — typed entities, timestamps, exact quote capture, settlement compatibility.
6. `docs/04_MODELS_AND_VALIDATION.md` — model choices, dependence, leak-free backtesting, evidence standards.
7. `docs/05_SELECTION_RISK_AND_SETTLEMENT.md` — approval gates, risk rules, quoted odds, bankroll ledger.
8. `docs/06_COUNCIL_AND_AUDIT.md` — Council integration and adversarial review protocol.
9. `docs/07_BUILD_PLAN_ACCEPTANCE.md` — phased delivery, hard acceptance tests, STOP/GO criteria.
10. `docs/08_OPERATING_RUNBOOK.md` — two-day windows, final verification and settlement.
11. `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md` — window aggregation, bookmaker submission deadline, starter uncertainty, and no 10.00 cap.
11. `docs/09_FAILURE_POSTMORTEM.md` — explicit retrospective of earlier failures.
12. `schemas/` — example and JSON schema for the output contract.
13. `reference/odds_math.py` + `tests/test_odds_math.py` — tiny standard-library **arithmetic reference** and tests only. **NOT** a prediction or selection engine.
14. `.env.example` and `.gitignore` — configuration hygiene.

## First interaction with Claude Code
Extract the ZIP to a **new** folder, open Command Prompt in that folder, run `claude`, then paste `START_HERE_PROMPT.md`. Have Claude give you **a feasibility/source-rights audit and tests FIRST**, not slip picks. Existing Claude/MT5 projects must not be modified.

## Critical reality checks
- 10.00 decimal odds require **>10% joint hit probability just to break even** on an unboosted accumulator; a high-confidence *winning outcome* and a 10.00+ payout are fundamentally different propositions.
- A player's historical mean is not their probability for today's game.
- A matched published statistic is not necessarily Betway's settlement statistic.
- Even a genuine positive expected-value strategy loses individual tickets, often several in succession.
- Public free data coverage and legally usable automated data collection may be insufficient. If so, the system must stay in **DATA_BLOCKED / RESEARCH_ONLY**, rather than invent forecasts or scrape around restrictions.
- The user's original R100 is a spending cap, not a guaranteed recoverable investment.

## Tooling principles
Python, SQLite, pandas/NumPy/SciPy/scikit-learn (after compatibility checks), pytest, Git, Windows Task Scheduler, local HTML/Markdown reports. Claude Code is a **developer/orchestrator**; Python produces numerical probabilities. Any cloud AI usage may incur its own subscription/usage cost; do not claim Claude Code inference is free. No MCP server is required for an MVP.

## 12 October correction: single cross-day windows, uncapped 10.00+ odds
Read `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md` before using the launch tool. **10.00 is the minimum accepted Betway combined decimal odds; there is no upper cap.** Scan both days, rank evidence-backed picks across the whole two-day window, and do not force either day to contribute a leg. Wednesday props cannot be appended to a Tuesday ticket after its first included match has started. The launch tool scans 18 fixtures and is research-only, not a validated betting engine.
