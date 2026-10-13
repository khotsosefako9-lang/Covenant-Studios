# 08 — Operating runbook: UCL Tuesday–Wednesday / domestic Saturday–Sunday

## One-time setup (after extracting ZIP)
1. Open Windows Command Prompt in a NEW local `sports-edge` directory and run `claude` using the already installed Claude Code CLI. Paste `START_HERE_PROMPT.md` and tell Claude to perform Phase 0 only. The ZIP contains docs/reference tests; no completed engine.
2. Claude checks `py --version` and dependency wheels in an isolated `.venv`; the user's existing Python 3.14.8 may work with current SoccerData, but every chosen package must be checked. Never uninstall/change MT5 or other live project dependencies.
3. If no licensed player-event source is feasible, keep only research/manual-input prototypes. Do NOT bypass web access blocks.
4. Store API keys only in excluded local `.env`, never in reports or Git. Do not request Betway usernames/passwords, 2FA, cookies, account session tokens or remote control.

## Before each cross-day window: data and candidate discovery
- Update allowed datasets within quotas and snapshot fixtures; record data latency.
- Run model scoring with effective samples and true availability dates; assemble candidate markets but label `PROVISIONAL` pending lineups and actual prices.
- Evaluate Tuesday+Wednesday UCL or Saturday+Sunday domestic fixtures as ONE candidate-pool/window; do not demand that either day contribute legs. One primary ticket per window or NO BET. 10.00 is a MINIMUM accepted combined odds, not a fixed target or cap.

## Each day, before the earliest INCLUDED kickoff: final verification and ticket freeze
- After official lineups (around one hour before kickoff, but do not infer exact timing), confirm each player starts and the quoted market exists.
- User manually copies Betway SA original wording, decimal price, screenshot timestamp and final odds. The program validates identifiers, market threshold, rule status, quote freshness, risk and uncertainty. If uncertain -> NO BET.
- If cross-match accumulator, check all relevant markets are permitted together and actual Betway accepted total odds. For same-match Bet Builder, capture the real quoted combination and use a proper joint model or reject it.
- Run Council if available; any veto stops. Report the individual estimate lower bound, break-even, joint ticket probability, reasons against betting, max allowed stake.
- If user independently places a bet, enter accepted price/stake/reference manually. The system may never assert placement succeeded based on a proposed slip.

## Monday: settlement & audit
- Independently reconcile market-specific official statistic with bookmaker settlement and any voids/refunds; record changed results as versions.
- Mark earlier predictions immutable. Append realised returns and diagnostic errors, including no-bet decisions and rejected legs.
- Publish rolling calibration and drawdown metrics; do NOT alter the model on the basis of one loss or one large win.

## Scheduling
Use Windows Task Scheduler only for offline Python fetch/score/report tasks once legal and source permissions are confirmed. Local PC must be on and permitted tasks allowed to run. Full Claude Council passes are manual unless explicit agreement on ongoing usage/cost. Avoid exposing account credentials.

## Emergency STOP
Trigger `DISABLED_DATA`, `DISABLED_MODEL`, `DISABLED_MARKET` or `DISABLED_RISK` status if:
- terms disallow access/use; source starts blocking; data missing/changed labels;
- player identity wrong; starting status unverified; unusual lineup;
- odds drift, market removed, promotion unclear, settlement dispute;
- inconsistent data provenance or leakage alert;
- weekend loss limit reached, manual pause or affordability concerns.
No fallback guess or paid-service upgrade. Stop, provide a factual cause, and propose only a compliant fix.

## Cross-day precommitment and no-append rule
For an accumulator spanning Tuesday and Wednesday (or Saturday and Sunday), the bookmaker must accept ALL legs before the **first included kickoff**. A Wednesday player’s starter cannot usually be confirmed on Tuesday: keep such props `PENDING_LINEUP` and BLOCK them under current strict rules. Tuesday verified player props + Wednesday verified team corners could be feasible if available as an accepted combination. Never promise that an accepted Tuesday bet can later be amended by adding Wednesday legs. A new Wednesday-only slip is a separate ticket and must share the existing exposure ledger. Read `docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md`.
