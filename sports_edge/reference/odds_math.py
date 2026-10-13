"""Minimal, deterministic financial arithmetic reference for future tests.

NOT a prediction model. NOT a bankroll optimizer. NOT an executable betting system.
All functions are valid only under stated binary win/loss assumptions; voids,
pushes, promotions and bookmaker-specific settlement require separate verified logic.
"""
from decimal import Decimal, ROUND_HALF_UP


def decimal_value(value: str | int | float | Decimal) -> Decimal:
    """Convert through str to avoid exposing binary floating-point artefacts."""
    if isinstance(value, bool):
        raise ValueError("Boolean is not an acceptable numeric value")
    return Decimal(str(value))


def validate_odds(value: str | int | float | Decimal) -> Decimal:
    odds = decimal_value(value)
    if not odds.is_finite() or odds <= 1:
        raise ValueError("Decimal odds must be finite and strictly greater than 1")
    return odds


def validate_probability(value: str | int | float | Decimal) -> Decimal:
    p = decimal_value(value)
    if not p.is_finite() or not (Decimal(0) <= p <= Decimal(1)):
        raise ValueError("Probability must be finite and in [0,1]")
    return p


def combined_reference_odds(*legs: str | int | float | Decimal) -> Decimal:
    """Only a hypothetical product; NOT an accepted bookmaker combined price."""
    if not legs:
        raise ValueError("No legs supplied")
    product = Decimal(1)
    for leg in legs:
        product *= validate_odds(leg)
    return product


def break_even_probability(odds: str | int | float | Decimal) -> Decimal:
    return Decimal(1) / validate_odds(odds)


def expected_roi_binary(
    win_probability: str | int | float | Decimal,
    odds: str | int | float | Decimal,
) -> Decimal:
    """Return per-unit-stake expected net ROI; no void/push/fees."""
    return validate_probability(win_probability) * validate_odds(odds) - Decimal(1)


def payout_if_win(stake: str | int | float | Decimal, odds: str | int | float | Decimal) -> Decimal:
    amount = decimal_value(stake)
    if not amount.is_finite() or amount < 0:
        raise ValueError("Invalid stake")
    return (amount * validate_odds(odds)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def over_half_integer_count(line: str | float | Decimal) -> int:
    """For count markets only: over 2.5 => 3+; integer lines need push rules."""
    x = decimal_value(line)
    if not x.is_finite() or x < 0 or x % 1 != Decimal("0.5"):
        raise ValueError("Only nonnegative half-integer count thresholds supported")
    return int(x + Decimal("0.5"))


def allowable_ticket_stake(available_balance: str | int | Decimal) -> Decimal:
    """Protective draft: <= 2.5% of AVAILABLE funds, rounded DOWN to cents."""
    balance = decimal_value(available_balance)
    if not balance.is_finite() or balance < 0:
        raise ValueError("Invalid balance")
    return (balance * Decimal("0.025")).quantize(Decimal("0.01"), rounding="ROUND_DOWN")
