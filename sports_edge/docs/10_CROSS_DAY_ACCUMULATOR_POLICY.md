# 10 — Two-day windows and uncapped combined-odds policy (supersedes any day-by-day slip requirement)

## Product requirements — explicitly confirmed by user 12 October 2026
- A **betting window** is a logical collection of fixtures over configurable dates. Default examples: UCL Tuesday + Wednesday; domestic football Saturday + Sunday. It is **ONE primary candidate accumulator for the window**, not a mandatory slip every day. There may be NO BET for the entire window.
- Candidate selections may span either date or be drawn only from one date when that's where supported value exists; do not require both dates to contribute a selection. Present day-level watchlists, but group candidate tickets by **window**.
- A bookmaker-accepted **decimal combined price must be >= 10.00**. **There is no imposed maximum combined odds.** 12, 18, 25, 40+ are eligible *only if they pass identical independent value, uncertainty, dependence, rules, data-quality, and risk gates*. Odds magnitude is never evidence of an edge. The target is not 'as close as possible to 10.00', nor 'highest possible odds'.
- Never append extra legs to reach 10.00, pad a slip, or prefer a high-odds longshot solely on nominal payout. Ranking must include conservative expected value **and uncertainty/variance**, while clearly showing extremely low joint win probability at long prices.
- Use a **single window-level bank ledger/risk budget**: do not reset exposure between Tuesday and Wednesday or Saturday and Sunday; an unsettled accumulator stake is tied up. Prevent duplication of the same exposure across draft/accepted tickets.

## Pre-commitment timing: the key gotcha
For a combined Tuesday + Wednesday ticket, **all selections and the bookmaker's accepted combo must be submitted before the first included leg starts**, e.g. before a Tuesday evening match if one is included. It is **not possible to place a Tuesday bet and append Wednesday legs to that exact ticket after Tuesday's matches have started**. Betway acceptance and a contemporaneous screenshot of the **actual combined** decimal odds are prerequisites; multiplying quoted single-market prices is only illustrative. Never label a cross-day combination EXECUTABLE without verifying the book actually permits the exact props together.

### Wednesday player-lineup conflict
Official Wednesday starting XIs will usually be unavailable before Tuesday kickoffs. Do NOT label Wednesday's starter as confirmed in advance. Under the current fail-closed starter rule this **blocks a player prop on Wednesday being pre-committed on Tuesday**. Options that do not silently waive safeguards:
1. Build a Tuesday–Wednesday ticket from **Tuesday props whose XIs are confirmed** and Wednesday **team/match corner markets** with independently verified settlement and modelling. These still need true bookmaker-accepted combo odds and as-of precommit evidence.
2. Show Wednesday player props as **PENDING_LINEUP research-only** in an uncommitted watchlist, not as accepted Tuesday ticket legs.
3. If a future version adopts a probabilistic lineup + non-starter/void policy, first implement and separately validate it, obtain explicit user approval to relax the strict starter rule, and record the acceptance/void consequences. Do not enable by default.
4. Build a **Wednesday-only** ticket after Wednesday lineups when appropriate, but it is a *different ticket* within the same overall Tuesday–Wednesday research window, not an amendment to any Tuesday wager. Do not duplicate risk or claim to have created one cross-day ticket.

### Quote timing and lifecycle
- Every candidate, accepted leg and window ticket requires timestamped as-of evidence. All accepted-leg markets must be available at the same decision timestamp and must be offered together. A quote from an earlier day can go stale even when the fixture remains a day away.
- Freeze ticket state and accepted price at submission. On later days: update settlements and observations only; **do not rewrite historical predictions or accepted prices**. Requote for any NEW ticket, never quietly revise an open ticket.
- On suspension/void of one leg, Betway's precise house rules govern repricing: a previously >=10.00 accepted slip may ultimately settle at lower effective odds. Log original odds and settled effective price separately. Do not claim the original goal is still met after a void or invent a bonus boost.
- Correlated markets require a credible joint distribution and bookmaker acceptance. Never multiply independent marginals for same-match or linked leg outcomes.
- Restrict risk to documented window bankroll/exposure rules. NO BET is the default when evidence is insufficient.

## Reporting & scheduling
- Group by `window_id` such as `UCL_2026-10-13_14` and `WEEKEND_2026-10-17_18`, with timezone `Africa/Johannesburg` and UTC timestamps in storage.
- Provide one **window accumulator report** plus optional Tuesday/Wednesday or Saturday/Sunday **daily watchlist** and separate last-minute preflight results.
- Display all leg event times, oldest/freshest quote times, submission/earliest-kickoff deadline, accepted Betway total odds, min odds threshold, joint win chance, expected value with uncertainty, selected/rejected/voided, and specific risk status.
- No requirement to complete an algorithm or make a pick by the first date; the system should cover all matches in the full window from the outset. For the Oct 13–14 launch, research-only preflight can scan all 18 fixtures; full validated betting remains blocked.

## Acceptance tests that must pass
1. A ticket with verified Tue and Wed fixtures is **eligible for window grouping**, but requires all legs accepted before the earliest kickoff.
2. An attempted additional Wednesday leg after an already-placed Tuesday leg was started must be rejected with `CANNOT_APPEND_TO_STARTED_TICKET`.
3. A Wednesday player prop marked starter confirmed before lineups are published fails `STARTER_NOT_CONFIRMED` unless supported by actual official evidence (never assume).
4. Odds exactly 10.00 meet minimum; 9.99 fail; 12.87 / 25.00 / 40.00 are **not rejected by an artificial max**.
5. Unverified bookmaker **combined** odds reject an otherwise good ticket; product of singles is NOT an accepted price.
6. Unqualified legs and unknown dependence still reject even if combined price exceeds 10.00.
7. Risk is applied over the entire window and cannot be reset on Wednesday/Sunday.
8. Voids and boosts recompute as separate *settlement* accounting, without rewriting originally accepted prices or turning an ex-ante qualification into a false claim of realised 10x payout.
