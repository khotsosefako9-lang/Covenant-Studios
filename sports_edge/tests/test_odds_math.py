import unittest
from decimal import Decimal
from reference.odds_math import (
    combined_reference_odds,
    break_even_probability,
    expected_roi_binary,
    payout_if_win,
    over_half_integer_count,
    allowable_ticket_stake,
)


class ArithmeticOnlyTests(unittest.TestCase):
    def test_product_is_not_accepted_betway_odds(self):
        self.assertEqual(combined_reference_odds("2.70", "3.00", "1.59"), Decimal("12.879000"))

    def test_reference_break_even(self):
        self.assertAlmostEqual(float(break_even_probability("10.00")), 0.10)

    def test_edge_is_not_winner_confidence(self):
        self.assertEqual(expected_roi_binary("0.357", "3.00"), Decimal("0.07100"))
        self.assertLess(Decimal("0.357"), Decimal("0.407"))

    def test_negative_ev_case(self):
        self.assertLess(expected_roi_binary("0.30", "3.00"), 0)

    def test_payout_includes_stake(self):
        self.assertEqual(payout_if_win("2.50", "12.879"), Decimal("32.20"))

    def test_count_threshold(self):
        self.assertEqual(over_half_integer_count("2.5"), 3)
        self.assertEqual(over_half_integer_count("0.5"), 1)
        with self.assertRaises(ValueError):
            over_half_integer_count("3.0")  # Potential push needs separate policy.

    def test_risk_ceiling(self):
        self.assertEqual(allowable_ticket_stake("100.00"), Decimal("2.50"))
        self.assertEqual(allowable_ticket_stake("95.00"), Decimal("2.37"))

    def test_bad_values_rejected(self):
        with self.assertRaises(ValueError):
            break_even_probability("0.99")
        with self.assertRaises(ValueError):
            expected_roi_binary("1.2", "2.00")
        with self.assertRaises(ValueError):
            payout_if_win("-1", "2.00")


if __name__ == "__main__":
    unittest.main()
