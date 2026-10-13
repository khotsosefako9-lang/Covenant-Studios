# 06 — Council skill protocol, adversarial review and independent tests

## Discovery and verification
Claude should inspect `~/.claude/skills/`, project `.claude/skills/`, older `.claude/commands/`, installed relevant Claude plugins and synced skill list through Claude's official skill discovery. Show exact found file paths and inspect `SKILL.md` contents, relevant helper files, permissions and invocation syntax. The user already has a Council skill in another context; it is NOT supplied in this package and must not be claimed present until located. Do not copy/modify it without user instruction.

If skill absent or instructions incompatible: `COUNCIL_UNAVAILABLE`. Still do data/source audit, but no report may claim Council review occurred. Never invent six fictional 'independent' experts who all agree.

## The Council's roles and veto authority
1. **Data/provenance auditor:** validate as-of evidence, permissions, identity, injuries, odds source/expiry, event definition, sample completeness. VETO for broken evidence.
2. **Quantitative/statistical reviewer:** inspect baseline, likelihood, conditional minutes, shrinkage, model-calibration diagnostics, uncertainty, multiple testing, and conservative EV. VETO for unsupported inference.
3. **Market/settlement reviewer:** inspect exact Betway SA market/threshold, shots vs SOT, corners taken, booking points, void rules, correlated bet limitations, accepted combined odds. VETO for mismatched contract.
4. **Football/tactical reviewer:** verify only sourced contextual flags (confirmed lineups, role/venue/fixture density, opponent matchup, injuries and replacements). No unsupported stories; can request research.
5. **Risk/bankroll reviewer:** ensure individual slip and weekend exposure, no churn, no capital guarantees, withdrawal viability, exact payout computations, no chasing. VETO on breach.
6. **Devil's advocate/independent critic:** identify two strongest falsifiable explanations for why the estimated edge is a data artefact. Demand stress tests, not rhetorical debate.

## Inputs to Council
Provide **machine-produced** structured evidence for each candidate: data snapshot SHA, code/model SHA, timestamps, quote evidence ID, sample counts, credible intervals, calibration evidence, rejected variants, model risks, joint-dependence evidence, and current project mode. Council should not read a persuasive narrative before raw data. All citations link to raw records rather than another AI response.

## Output
Per candidate reviewer: `PASS`, `VETO`, or `INSUFFICIENT_EVIDENCE`, accompanied by a plain reason and specific required test/data. Unanimity is neither necessary nor sufficient. Any VETO = reject. `PASS` from all reviewers still does not waive statistical/data gates.

The final report must contain:
- numerical gate decisions from deterministic code (authoritative)
- Council objections, evidence reviewed, and actionable changes (advisory or veto)
- `MODEL_UNVALIDATED`, `NO_BET` or `ELIGIBLE_PAPER_ONLY` state
- plain-language explanation of why a losing outcome was possible even if edge positive.

## Mandatory post-match review
Compare logged pre-match predictions with settled event counts and contract; do not backfit explanation after seeing results. Retain model loss/error and both correct and incorrect picks. Review every slip and all considered markets, not only winners.

## Cost control
Local scoring and scheduling run on Python; invoke Council manually when Claude Code account limits permit. Never turn a recurring cloud AI call on that may charge or deplete tokens without permission. If running without Claude, programmatically enforce gates and mark Council unavailable.
