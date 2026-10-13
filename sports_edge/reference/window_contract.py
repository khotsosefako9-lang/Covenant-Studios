"""Deterministic, RESEARCH ONLY window validation. Does not authorise betting.

Pure helpers for the cross-day window policy in docs/10_CROSS_DAY_ACCUMULATOR_POLICY.md:
window construction (UCL Tue+Wed, domestic Sat+Sun), one-ticket pre-commitment before the
earliest INCLUDED kickoff, no appending, strict starter evidence, window-level exposure and
separate void/boost settlement accounting. Nothing here estimates a probability.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN
from .odds_math import validate_odds, decimal_value

MINIMUM_COMBINED_DECIMAL_ODDS = Decimal('10.00')
MAXIMUM_COMBINED_DECIMAL_ODDS = None  # Deliberately no ceiling: 10.00 is a minimum, not a target.
PLAYER_MARKETS = frozenset({'player_shots', 'player_sot', 'player_booking'})

# Window kinds: weekday numbers (Mon=0) the window must start on and the number of days.
WINDOW_KINDS = {
    'ucl': {'prefix': 'UCL', 'start_weekday': 1, 'days': 2,
            'competition': 'UEFA Champions League', 'label': 'Tuesday + Wednesday'},
    'weekend': {'prefix': 'WEEKEND', 'start_weekday': 5, 'days': 2,
                'competition': 'Domestic football (user-selected leagues)', 'label': 'Saturday + Sunday'},
}

# Official team sheets are not published days ahead. A claimed starter confirmation earlier than
# this before kickoff is treated as not credible (fail closed). This is a plausibility guard,
# not a claim about the exact publication time.
LINEUP_EARLIEST_CREDIBLE_BEFORE_KICKOFF = timedelta(hours=2)

# Protective defaults from docs/05 (not optimised staking fractions).
TICKET_STAKE_FRACTION = Decimal('0.025')
WINDOW_EXPOSURE_FRACTION = Decimal('0.05')
WINDOW_EXPOSURE_ABSOLUTE_CAP_ZAR = Decimal('5.00')


def _aware(*values):
    return all(v.tzinfo is not None and v.utcoffset() is not None for v in values)


def accepts_minimum_combined_odds(actual_bookmaker_accepted_odds):
    """Only arithmetic eligibility, not an edge signal or betting approval."""
    return validate_odds(actual_bookmaker_accepted_odds) >= MINIMUM_COMBINED_DECIMAL_ODDS


def window_dates(kind, start):
    """Return the window dates; the start must fall on the kind's weekday (Tue for UCL, Sat for weekend)."""
    spec = WINDOW_KINDS.get(kind)
    if spec is None:
        raise ValueError(f'Unknown window kind {kind!r}; expected one of {sorted(WINDOW_KINDS)}')
    if isinstance(start, str):
        start = date.fromisoformat(start)
    if start.weekday() != spec['start_weekday']:
        raise ValueError(f"{kind} window must start on a {spec['label'].split(' ')[0]}; {start} is not")
    return [start + timedelta(days=i) for i in range(spec['days'])]


def window_id(kind, dates):
    """UCL_2026-10-13_14, WEEKEND_2026-10-17_18; month/year crossings keep the full later date part."""
    first, last = dates[0], dates[-1]
    if (first.year, first.month) == (last.year, last.month):
        tail = f'{last.day:02d}'
    elif first.year == last.year:
        tail = f'{last.month:02d}-{last.day:02d}'
    else:
        tail = last.isoformat()
    return f"{WINDOW_KINDS[kind]['prefix']}_{first.isoformat()}_{tail}"


def validate_cross_day_commit(*, kickoffs, submitted_at, accepted_combo_price, combo_verified):
    """Fail closed for timing/actual book price. No inferred probabilities or recommendations."""
    blockers = []
    if not kickoffs:
        return ['NO_SELECTIONS']
    if not _aware(*kickoffs, submitted_at):
        return ['TIMEZONE_REQUIRED']
    if submitted_at.astimezone(timezone.utc) >= min(x.astimezone(timezone.utc) for x in kickoffs):
        blockers.append('EARLIEST_INCLUDED_KICKOFF_PASSED')
    if not combo_verified or accepted_combo_price is None:
        # A product of displayed single prices is never an accepted combined price.
        blockers.append('COMBINED_PRICE_UNVERIFIED')
    else:
        try:
            if not accepts_minimum_combined_odds(accepted_combo_price):
                blockers.append('COMBINED_PRICE_BELOW_MINIMUM')
        except (ValueError, ArithmeticError):
            blockers.append('COMBINED_PRICE_INVALID')
    return blockers


def can_append_to_submitted_ticket(*, ticket_has_begun):
    """A submitted ticket is immutable; returns false even when only later games remain."""
    return False


def validate_append(*, original_kickoffs, attempted_at):
    """Any attempt to add a leg to an already submitted ticket is rejected with a specific reason."""
    if not original_kickoffs or not _aware(*original_kickoffs, attempted_at):
        return ['CANNOT_APPEND_TO_SUBMITTED_TICKET']
    if attempted_at.astimezone(timezone.utc) >= min(k.astimezone(timezone.utc) for k in original_kickoffs):
        return ['CANNOT_APPEND_TO_STARTED_TICKET']
    return ['CANNOT_APPEND_TO_SUBMITTED_TICKET']


def starter_gate(*, market, kickoff, decision_at, starter_confirmed, lineup_published_at=None,
                 starter_evidence_present=False):
    """Strict starter rule. Never assume; a claim before team sheets can exist fails closed.

    Returns [] when the market is not a player market or the starter claim is backed by
    official-lineup evidence published at a credible time before `decision_at`.
    """
    if market not in PLAYER_MARKETS:
        return []
    if not _aware(kickoff, decision_at):
        return ['STARTER_NOT_CONFIRMED', 'TIMEZONE_REQUIRED']
    earliest_credible = kickoff - LINEUP_EARLIEST_CREDIBLE_BEFORE_KICKOFF
    if decision_at < earliest_credible:
        # e.g. a Wednesday player prop evaluated on Tuesday: official XI cannot exist yet.
        return ['STARTER_NOT_CONFIRMED', 'PENDING_LINEUP']
    if not starter_confirmed:
        return ['STARTER_NOT_CONFIRMED']
    reasons = []
    if lineup_published_at is None or not _aware(lineup_published_at):
        reasons.append('LINEUP_PUBLICATION_TIME_MISSING')
    elif lineup_published_at < earliest_credible or lineup_published_at > decision_at or lineup_published_at >= kickoff:
        reasons.append('LINEUP_PUBLICATION_TIME_NOT_CREDIBLE')
    if not starter_evidence_present:
        reasons.append('STARTER_EVIDENCE_MISSING')
    return ['STARTER_NOT_CONFIRMED'] + reasons if reasons else []


def window_exposure_limits(available_balance_zar):
    """Per-ticket and whole-window caps computed ONCE at window start; never reset mid-window."""
    balance = decimal_value(available_balance_zar)
    if not balance.is_finite() or balance < 0:
        raise ValueError('Invalid balance')
    ticket = (balance * TICKET_STAKE_FRACTION).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
    window = min((balance * WINDOW_EXPOSURE_FRACTION).quantize(Decimal('0.01'), rounding=ROUND_DOWN),
                 WINDOW_EXPOSURE_ABSOLUTE_CAP_ZAR)
    return {'ticket_cap_zar': min(ticket, window), 'window_cap_zar': window}


def check_window_risk(*, window_start_balance_zar, tickets):
    """Evaluate stakes across ALL tickets in the window in order (Tue then Wed, Sat then Sun).

    `tickets`: iterable of dicts with `ticket_id`, `stake_zar` and `legs` (hashable leg keys).
    Exposure accumulates over the whole window; a later day does not get a fresh budget.
    Returns {ticket_id: [reasons]}.
    """
    out = {}
    if window_start_balance_zar in (None, ''):
        for t in tickets:
            out[t['ticket_id']] = ['WINDOW_BALANCE_UNKNOWN']
        return out
    limits = window_exposure_limits(window_start_balance_zar)
    used = Decimal('0')
    seen_legs = {}
    for t in tickets:
        reasons = []
        try:
            stake = decimal_value(t['stake_zar'])
            if not stake.is_finite() or stake <= 0:
                raise ValueError
        except (ValueError, ArithmeticError, KeyError):
            out[t['ticket_id']] = ['STAKE_INVALID']
            continue
        if stake > limits['ticket_cap_zar']:
            reasons.append('TICKET_STAKE_EXCEEDS_CAP')
        if used + stake > limits['window_cap_zar']:
            reasons.append('WINDOW_EXPOSURE_EXCEEDED')
        for leg in t.get('legs', ()):
            if leg in seen_legs and seen_legs[leg] != t['ticket_id']:
                reasons.append('DUPLICATE_EXPOSURE')
                break
        for leg in t.get('legs', ()):
            seen_legs.setdefault(leg, t['ticket_id'])
        used += stake  # Counted even when blocked: a draft must not free budget for a duplicate.
        out[t['ticket_id']] = reasons
    return out


def settle_with_voids(*, accepted_odds, voided_leg_odds=(), void_rule_verified=False,
                      boost_terms_verified=False, boost_multiplier=None):
    """Separate settlement accounting. The ex-ante accepted price is never rewritten.

    Effective odds after voids are only computed when the bookmaker's void rule has been
    verified (assumed rule: voided leg's odds divided out). Boosts are ignored unless terms
    are verified. `minimum_met_at_settlement` is reported separately from ex-ante eligibility.
    """
    original = validate_odds(accepted_odds)
    result = {'accepted_odds_original': original, 'effective_odds_settled': None,
              'boost_applied': False, 'notes': []}
    effective = original
    if voided_leg_odds:
        if not void_rule_verified:
            result['notes'].append('VOID_RULE_UNVERIFIED')
            result['minimum_met_at_settlement'] = None
            return result
        for leg in voided_leg_odds:
            effective = effective / validate_odds(leg)
    if boost_multiplier is not None:
        if boost_terms_verified:
            effective = effective * decimal_value(boost_multiplier)
            result['boost_applied'] = True
        else:
            result['notes'].append('BOOST_TERMS_UNVERIFIED_IGNORED')
    result['effective_odds_settled'] = effective
    result['minimum_met_at_settlement'] = effective >= MINIMUM_COMBINED_DECIMAL_ODDS
    return result
