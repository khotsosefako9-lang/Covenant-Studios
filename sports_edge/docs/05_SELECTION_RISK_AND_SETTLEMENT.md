# 05 — Eligibility gates, bankroll controls, money arithmetic and settlement

## Gates, in executable order (each is a hard stop)
G0 SOURCE: source exists, current and permits intended access/use; verified historical and current competition coverage.
G1 IDENTITY: fixture/player/team/competition unequivocal on observation date; transfer/alias/start status resolved.
G2 MARKET: Betway ZA exact selection, line, market, commencement, settlement definition, price, timestamp, source evidence. Quote not expired or changed; default manual refresh required within configurable short window (suggest 10 minutes pre-kickoff, revisit after confirmed lineups).
G3 MODEL: a market-specific, out-of-sample calibrated prediction exists. No LLM-invented inputs; effective sample and uncertainty reported. If model not validated, paper-only.
G4 EDGE: estimate withstands model-uncertainty lower bound, adverse executable odds movement, and expected void/refund/commission/fees where relevant. The conservative EV must clear a pre-registered positive buffer; otherwise REJECT.
G5 COMPATIBILITY: a legal bookmaker combination is confirmed (not an imagined Bet Builder). Joint success probability modelled with dependence and interval. Avoid contradictory, duplicative or overlapping selections.
G6 RISK: stake and entire weekend aggregated potential loss comply; settled/unsettled balance tracked.
G7 COUNCIL: reads immutable underlying evidence, tries to falsify thesis, can veto; Council approval cannot override Gates 0–6.
G8 USER: final lineup/odds/accepted odds manually rechecked immediately prior to any user decision. Manual placement only; after selection, record actual stake, accepted odds and bet ID manually.

## Initial risk constraints for hypothetical later use
- Reference bankroll: **R100** starting cash. This is NOT an investment principal with capital protection.
- Zero reloads/additional deposits; no chasing/stake escalation following losses; no automatic reinvestment schedule.
- Tentative exposure ceilings: **2.5% of current available bankroll per ticket**, **5% of current available bankroll per weekend**. In addition, no weekend exposure above initial R5 until explicitly reviewed. Compute weekend stake limit at session start; subtract every still-open and settled losing ticket stake for that weekend; do not reset on a winner or refund without recorded ledger rules. These are protective defaults, not statistically optimised staking fractions.
- If bookmaker minimum stake exceeds risk cap: NO BET. If funds blocked in unsettled bets: do not overstate available balance.
- No credit, borrowing, chasing losses, martingale, leveraged bets, bookmaker bonuses treated as guaranteed payouts, or betting funds earmarked for essentials.
- Bankroll ledger: available account cash, reserved stakes, realised net lifetime P&L and withdrawal amounts separately. Starting R100 may be withdrawn once account cash allows, after bookmaker FICA/withdrawal requirements; then record it as a withdrawal, not a winning trade or guarantee of recovered capital.
- Counters and stop states: daily/weekend loss limit, pause on data-integrity breach, pause on unexpected settlement mismatch, pause after an amended model, human-triggered pause, and periodic reassessment.

## Payout and boost semantics
For settled, binary win/lose at decimal odds O and stake S, total cash return on WIN = S*O and *net win profit* = S*(O-1). Loss = -S. Actual bookmaker 'boost' terms must be captured as a separate policy: percent may be applied to winnings, odds, payout, some markets excluded and caps may apply. Never infer boost maths from a promotional headline. Store screenshot **accepted total odds**, stake and payout and reconcile after settlement.

For a ticket with possible voided legs, settlement could reduce effective odds or void ticket entirely; apply Betway's exact offer rules, not generic uniform assumptions.

## Critical settlement rule checkpoints
- Betway SA football general rules say: corners count when TAKEN, not merely awarded; team/match corner data must match.
- Their general rules distinguish card *counts* and *booking points* with different weights. Do not interchange totals. Cards to staff/substitutes may be excluded.
- Their published football Player Markets clause says player bets void if player not in starting lineup. Confirm this applies to the individual product as displayed and identify any market-specific override.
- First scorer/penalty/own goal/blocked on-target/deflection/woodwork definitions vary across data feeds/bookmakers; get official market settlement criterion for each before enabling it.
- 90-min football includes added time but ordinarily not extra-time periods unless particular offer explicitly says otherwise.
- Cancellations, no-shows, abandoned fixtures, fixture postponements and data revisions must have explicit states and recalculation logic.

## What makes an accumulator invalid
- It contains a nonpositive conservative-edge leg.
- It reaches 10.00 solely by adding another weak leg.
- It mixes correlated lines and multiplies raw probabilities.
- It relies on unverified booster/foreign bookmaker prices.
- It uses exact player stats from fewer than the minimum effective observations established in model validation.
- It is presented as high-probability or nearly guaranteed despite 10.00+ payout.
- Any Betway accepted market/price has changed or is unavailable.

## Responsible gambling boundary
A strategy can make losing streaks even when model EV is positive. The spending cap is a limit on potential loss, not a plan to recover money. Never suggest funding losses through higher stakes. If desired data/evidence are absent, the safest strategy is to run research and paper-only logs.
