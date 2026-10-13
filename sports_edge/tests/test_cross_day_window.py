import unittest
from datetime import datetime, date, timedelta
from decimal import Decimal
from reference.window_contract import (
    accepts_minimum_combined_odds, validate_cross_day_commit, can_append_to_submitted_ticket,
    validate_append, starter_gate, check_window_risk, settle_with_voids, window_dates, window_id,
    MAXIMUM_COMBINED_DECIMAL_ODDS,
)

TZ = '+02:00'
TUE = datetime.fromisoformat('2026-10-13T21:00:00+02:00')
WED = datetime.fromisoformat('2026-10-14T21:00:00+02:00')
TUE_EVENING = datetime.fromisoformat('2026-10-13T20:35:00+02:00')


class TestCrossDayWindow(unittest.TestCase):
    def test_10_is_minimum_not_ceiling(self):  # policy acceptance test 4
        for x in ('10.00', '12.87', '12.879', '25', '25.00', '40', '40.00', '150'):
            self.assertTrue(accepts_minimum_combined_odds(x))
        self.assertFalse(accepts_minimum_combined_odds('9.99'))
        self.assertIsNone(MAXIMUM_COMBINED_DECIMAL_ODDS)

    def test_tuesday_and_wednesday_can_be_in_one_precommitted_ticket(self):  # policy test 1
        self.assertEqual(validate_cross_day_commit(kickoffs=[TUE, WED], submitted_at=TUE_EVENING,
                                                   accepted_combo_price='25', combo_verified=True), [])

    def test_wednesday_only_selection_allowed(self):
        self.assertEqual(validate_cross_day_commit(kickoffs=[WED], submitted_at=TUE_EVENING,
                                                   accepted_combo_price='12', combo_verified=True), [])

    def test_cannot_submit_after_earliest_leg_begins(self):
        now = datetime.fromisoformat('2026-10-13T21:01:00+02:00')
        self.assertIn('EARLIEST_INCLUDED_KICKOFF_PASSED', validate_cross_day_commit(
            kickoffs=[TUE, WED], submitted_at=now, accepted_combo_price='25', combo_verified=True))

    def test_exact_first_kickoff_is_already_too_late(self):
        self.assertIn('EARLIEST_INCLUDED_KICKOFF_PASSED', validate_cross_day_commit(
            kickoffs=[TUE, WED], submitted_at=TUE, accepted_combo_price='25', combo_verified=True))

    def test_bookmaker_accepted_price_required(self):  # policy test 5
        self.assertIn('COMBINED_PRICE_UNVERIFIED', validate_cross_day_commit(
            kickoffs=[TUE, WED], submitted_at=TUE_EVENING, accepted_combo_price='99', combo_verified=False))

    def test_below_minimum_combined_price(self):
        self.assertIn('COMBINED_PRICE_BELOW_MINIMUM', validate_cross_day_commit(
            kickoffs=[TUE, WED], submitted_at=TUE_EVENING, accepted_combo_price='9.99', combo_verified=True))

    def test_no_append_to_placed_ticket(self):  # policy test 2
        self.assertFalse(can_append_to_submitted_ticket(ticket_has_begun=True))
        self.assertFalse(can_append_to_submitted_ticket(ticket_has_begun=False))
        after_tue = datetime.fromisoformat('2026-10-13T21:30:00+02:00')
        self.assertEqual(validate_append(original_kickoffs=[TUE], attempted_at=after_tue),
                         ['CANNOT_APPEND_TO_STARTED_TICKET'])
        self.assertEqual(validate_append(original_kickoffs=[TUE], attempted_at=TUE_EVENING),
                         ['CANNOT_APPEND_TO_SUBMITTED_TICKET'])

    def test_zero_leg_rejected(self):
        self.assertEqual(validate_cross_day_commit(kickoffs=[], submitted_at=TUE, accepted_combo_price='10',
                                                   combo_verified=True), ['NO_SELECTIONS'])

    def test_no_naive_timezones(self):
        now = datetime.fromisoformat('2026-10-13T20:35:00')
        self.assertIn('TIMEZONE_REQUIRED', validate_cross_day_commit(
            kickoffs=[TUE, WED], submitted_at=now, accepted_combo_price='10', combo_verified=True))


class TestStarterGate(unittest.TestCase):  # policy acceptance test 3
    def test_wednesday_prop_marked_confirmed_on_tuesday_fails(self):
        reasons = starter_gate(market='player_sot', kickoff=WED, decision_at=TUE_EVENING, starter_confirmed=True,
                               lineup_published_at=TUE_EVENING - timedelta(minutes=5), starter_evidence_present=True)
        self.assertIn('STARTER_NOT_CONFIRMED', reasons)
        self.assertIn('PENDING_LINEUP', reasons)

    def test_tuesday_prop_with_official_lineup_evidence_passes_gate(self):
        lineup = datetime.fromisoformat('2026-10-13T20:00:00+02:00')
        self.assertEqual(starter_gate(market='player_shots', kickoff=TUE, decision_at=TUE_EVENING,
                                      starter_confirmed=True, lineup_published_at=lineup,
                                      starter_evidence_present=True), [])

    def test_lineup_time_claimed_days_early_not_credible(self):
        early = datetime.fromisoformat('2026-10-12T12:00:00+02:00')
        reasons = starter_gate(market='player_booking', kickoff=TUE, decision_at=TUE_EVENING, starter_confirmed=True,
                               lineup_published_at=early, starter_evidence_present=True)
        self.assertIn('LINEUP_PUBLICATION_TIME_NOT_CREDIBLE', reasons)

    def test_team_markets_unaffected(self):
        self.assertEqual(starter_gate(market='team_corners', kickoff=WED, decision_at=TUE_EVENING,
                                      starter_confirmed=False), [])


class TestWindowRisk(unittest.TestCase):  # policy acceptance test 7
    def test_exposure_not_reset_on_second_day(self):
        tickets = [{'ticket_id': 'TUE', 'stake_zar': '2.50', 'legs': [2]},
                   {'ticket_id': 'WED', 'stake_zar': '2.50', 'legs': [3]},
                   {'ticket_id': 'WED2', 'stake_zar': '0.50', 'legs': [4]}]
        out = check_window_risk(window_start_balance_zar='100.00', tickets=tickets)
        self.assertEqual(out['TUE'], [])
        self.assertEqual(out['WED'], [])
        self.assertIn('WINDOW_EXPOSURE_EXCEEDED', out['WED2'])

    def test_r20_on_r100_rejected(self):
        out = check_window_risk(window_start_balance_zar='100', tickets=[{'ticket_id': 'X', 'stake_zar': '20', 'legs': []}])
        self.assertIn('TICKET_STAKE_EXCEEDS_CAP', out['X'])

    def test_duplicate_exposure(self):
        out = check_window_risk(window_start_balance_zar='100', tickets=[
            {'ticket_id': 'A', 'stake_zar': '1', 'legs': [2, 3]}, {'ticket_id': 'B', 'stake_zar': '1', 'legs': [3]}])
        self.assertIn('DUPLICATE_EXPOSURE', out['B'])

    def test_unknown_balance(self):
        out = check_window_risk(window_start_balance_zar=None, tickets=[{'ticket_id': 'A', 'stake_zar': '1', 'legs': []}])
        self.assertEqual(out['A'], ['WINDOW_BALANCE_UNKNOWN'])


class TestSettlement(unittest.TestCase):  # policy acceptance test 8
    def test_void_reprices_without_rewriting_accepted_odds(self):
        r = settle_with_voids(accepted_odds='12.00', voided_leg_odds=['2.00'], void_rule_verified=True)
        self.assertEqual(r['accepted_odds_original'], Decimal('12.00'))
        self.assertEqual(r['effective_odds_settled'], Decimal('6'))
        self.assertFalse(r['minimum_met_at_settlement'])

    def test_void_rule_unverified(self):
        r = settle_with_voids(accepted_odds='12.00', voided_leg_odds=['2.00'])
        self.assertIsNone(r['effective_odds_settled'])
        self.assertIn('VOID_RULE_UNVERIFIED', r['notes'])

    def test_boost_ignored_without_terms(self):
        r = settle_with_voids(accepted_odds='10.00', boost_multiplier='1.03')
        self.assertEqual(r['effective_odds_settled'], Decimal('10.00'))
        self.assertFalse(r['boost_applied'])


class TestWindowConstruction(unittest.TestCase):
    def test_ucl_and_weekend_ids(self):
        ucl = window_dates('ucl', '2026-10-13')
        self.assertEqual(ucl, [date(2026, 10, 13), date(2026, 10, 14)])
        self.assertEqual(window_id('ucl', ucl), 'UCL_2026-10-13_14')
        wk = window_dates('weekend', '2026-10-31')
        self.assertEqual(window_id('weekend', wk), 'WEEKEND_2026-10-31_11-01')

    def test_wrong_start_weekday(self):
        with self.assertRaises(ValueError):
            window_dates('weekend', '2026-10-18')  # Sunday


if __name__ == '__main__':
    unittest.main()
