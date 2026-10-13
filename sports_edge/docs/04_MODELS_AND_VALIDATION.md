# 04 — Modelling standard, probabilities, uncertainty and backtesting

## Stage A: First prove honest baselines
Do NOT start with flashy neural networks, ten independent agents or complex Bayesian frameworks. For each candidate market:
1. Define target variable in **Betway settlement terms**, then map from source events. Flag ambiguous maps.
2. Estimate raw recent empirical hit rate and properly weighted career/season history, with denominators: starts, appearances, minutes and opposing team quality. Report denominators and uncertainty.
3. Establish baseline using hierarchical shrinkage toward league/role/team prior so a player with four matches is not treated as a stable specialist. Only pre-match features count.
4. Use fixtures/time, projected starts and minutes with a distribution (not fixed 90m). Conditional on minutes, estimate prop counts; marginalise over minutes and lineup eligibility.
5. Compare against simple empirical or market-implied probabilities. If complex model doesn't reliably beat a strong baseline **out of sample**, don't deploy it.

## Candidate distribution families (compare, don't blindly assume)
- **Shots:** player count per expected minutes; Poisson benchmark, negative-binomial with overdispersion, hierarchical effects for player, role, team, opponent, tactical matchup, and available match tempo. Model 0-event games and effects of early substitutions.
- **Shots on target:** either independent event rate tested against reality, or hierarchical shot count model plus conditional shot-on-target classification (binomial/beta-binomial) to respect SOT <= shots. Verify provider semantics: blocked shots, goals, saved, woodwork, penalties, deflections. Do not infer SOT from xG alone.
- **Outside-box SOT:** separate shot-location map and on-target classification; apply in/out box boundary using tested provider coordinates, player sample/effective minutes and match-specific opponent adjustment. Most candidates likely data-insufficient; default disabled.
- **Bookings:** a first-booking probability / time hazard or logistic Bernoulli conditioned on minutes/starting and position, fouling propensity, opponent dribbles/fouls drawn, referee tendencies and match context. Do not model cards as goals. Separate specific player booked from team booking totals and booking points.
- **Corners:** Poisson benchmark vs negative-binomial/zero-inflated if justified; team attack/defence, venue, match tempo, possible score-state distribution, lineup/wing play, opponent corner concessions. Capture full distribution, not just mean.
- **Known unavailable covariates** stay missing; avoid post hoc narratives about referee, injury, formation or motivation.

## Core mathematical invariants
- `p_break_even = 1 / decimal_odds` for binary win/lose, absent pushes/voids/fees; raw implied price not no-vig probability.
- `EV_per_R1 = p_win*(odds-1) - (1 - p_win)` = `p_win*odds - 1`, where all remaining possibilities lose; adjust for void/push/boost/fees when present.
- **Lower-bound edge** should survive probability uncertainty, executable-odds deterioration and source/settlement risk. Establish quantitative thresholds on validation data, not to fit the final holdout. If optimistic EV positive but conservative EV <= 0, reject or mark research-only.
- For a 10.00 odds accumulator, unboosted break-even win chance is 10%. Do not conflate model calibration confidence with probability of winning.
- For independent legs only, joint probability is product of event probabilities; **independence is a modelling assumption, not a default right**. Multiple correlated same-match/player events require joint-event simulation or bookmaker's correlated pricing with verified prediction distribution. The actual accepted slip quote overrides simplistic product odds.
- **Do not use an arbitrary 10% haircut of averages and call it a confidence interval.** Use resampling, hierarchical posterior/predictive distribution or empirically calibrated uncertainty under proper data splits.

## Backtesting and chronological split
1. Define data availability/access dates; test periods must follow real chronology. Avoid random shuffle across games or leaking same match through correlated targets.
2. Training period -> time-forward validation for hyperparameter selection -> sealed out-of-sample holdout -> live forward paper-trade. Do not tune on locked holdout. Use rolling-origin experiments as data permits.
3. Pre-register feature set, probability thresholds, model/calibration method and policies before paper-forward period.
4. Every published candidate, rejected leg, assumed probability, quote timestamp and decision is an append-only row **before kickoff**. Never write hindsight forecasts.
5. When historical pre-kickoff player prop prices aren't available, backtest **probability prediction accuracy only**, NOT historical real-money ROI/CLV. Establish a prospective manual quote archive; evaluate pricing/ROI only after sufficient genuine historical quotes accumulate.
6. Evaluate by market, season, player cohort, odds band, competition and sample size. Count winners AND non-bets. Show missingness and reasons.

## Required metrics
- Brier score and log loss on binary thresholds, plus reliability bins and proper weighting; assess relative to honest bookmaker-informed baselines where prices known.
- Count distribution calibration and ranked probability score/negative log likelihood as appropriate.
- Empirical calibration curves, interval coverage, uncertainty and overconfidence diagnostics; model-vs-baseline comparisons with uncertainty intervals.
- Full returns: settled ROI, drawdown, ticket hit rate, largest losing streak, turnover, stake-weighted returns, proportion of eligible candidates, and selected-accumulator joint calibration. Show gross/net and voids separately.
- Close-to-kickoff price tracking and CLV *only if actual comparable quotes exist*; do not infer close from a different bookmaker or market.
- Correct multiple-comparison and strategy-selection bias: the engine tests many players, lines, sports and markets; don't treat a handful of lucky retrospective picks as proof.
- Robustness: lineups, injury removals, recent role changes, minutes uncertainty, bookmaker-price deterioration, alternative settlement maps, late data corrections, stronger/worse opponents.

## Approval framework before even considering user-manual real bets
- A documented legal/usable data source for chosen market and sufficiently complete current-season + historical coverage.
- Reproducible pipeline, passing integrity tests, no leakage, and trustworthy calibration vs a basic benchmark on held-out/pre-registered forward data.
- Actual contemporaneous Betway quotes, market-specific settlement compatibility, and reliable manual bet history.
- Robust out-of-sample positive expected value, with a statistical uncertainty assessment that does not hinge on a handful of big accumulator wins. No arbitrary ROI promise or '100 bets = proof'.
- When evaluation remains underpowered, label `MODEL_UNVALIDATED`. The system remains in paper mode.

## Statistical sample caution
With a 10% true hit rate, 100 **independent** 10x tickets would produce only ~10 wins on average and still have high variance; overlapping legs make the effective sample smaller. The required evaluation length should come from the desired power/precision and the actual observed hit rate, not a marketing-sized number.
