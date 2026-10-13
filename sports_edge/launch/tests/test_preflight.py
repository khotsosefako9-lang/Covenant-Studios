import csv
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import launch.preflight as pf
from launch.preflight import load_fixtures, vet, vet_ticket, FIELDS, to_decimal

SAST = dt.timezone(dt.timedelta(hours=2))
NOW = dt.datetime(2026, 10, 13, 18, 0, tzinfo=SAST)
PNG = b'\x89PNG\r\n\x1a\n' + b'test_only'


def verified(fixtures):
    """Test-only copy marked officially verified; the real CSVs are not."""
    return {k: {**v, 'verification_status': 'VERIFIED_OFFICIAL'} for k, v in fixtures.items()}


class TestUCLLaunch(unittest.TestCase):
    def setUp(self):
        self.fixtures = load_fixtures()
        self.row = {key: '' for key in pf.QUOTE_FIELDS}
        self.row.update(fixture_id='UCL26-1013-LEN-SPO', market='player_shots',
            entity_name='Example Player', threshold='3+', selection='Example Player 3+ shots',
            odds_decimal='2.1', bookmaker='Betway ZA', observed_at_sast='2026-10-13T17:56:00+02:00',
            evidence_path='data/nonexistent.png', starter_confirmed='true', rules_confirmed='true',
            source_rights_confirmed='true', market_definition_matched='true',
            probability_model_validated='true', model_id='test-model', model_p='0.56',
            conservative_p='0.52', model_evidence='test-only', independent_council_veto='false',
            lineup_published_at_sast='2026-10-13T17:45:00+02:00', starter_evidence_path='data/nonexistent.png')

    def test_18_window_fixtures(self):
        self.assertEqual(len(self.fixtures), 18)
        self.assertEqual(sum(f['date'] == '2026-10-13' for f in self.fixtures.values()), 9)
        self.assertEqual(sum(f['date'] == '2026-10-14' for f in self.fixtures.values()), 9)
        self.assertEqual(self.fixtures['UCL26-1014-MCI-PSG']['date'], '2026-10-14')
        self.assertEqual(self.fixtures['UCL26-1013-LEN-SPO']['kickoff_sast'], '2026-10-13T18:45:00+02:00')

    def test_fixtures_not_claimed_official(self):
        # uefa.com could not be reached from the build container: never claim official verification.
        self.assertTrue(all(f['verification_status'] != 'VERIFIED_OFFICIAL' for f in self.fixtures.values()))
        self.assertIn('FIXTURE_NOT_OFFICIALLY_VERIFIED', vet(self.row, self.fixtures, NOW))

    def test_no_fake_evidence(self):
        self.assertIn('EVIDENCE_FILE_NOT_FOUND', vet(self.row, self.fixtures, NOW))

    def test_unverified_model_blocked(self):
        self.row['probability_model_validated'] = 'false'
        self.assertIn('MODEL_UNVALIDATED', vet(self.row, self.fixtures, NOW))

    def test_market_disabled(self):
        self.row['market'] = 'outside_box_sot'
        self.assertIn('MARKET_NOT_ENABLED', vet(self.row, self.fixtures, NOW))

    def test_old_quote(self):
        self.row['observed_at_sast'] = '2026-10-13T17:20:00+02:00'
        self.assertIn('QUOTE_STALE', vet(self.row, self.fixtures, NOW))

    def test_post_kickoff_quote(self):
        self.row['observed_at_sast'] = '2026-10-13T19:00:00+02:00'
        self.assertIn('QUOTE_POST_KICKOFF', vet(self.row, self.fixtures, NOW))

    def test_wrong_bookmaker(self):
        self.row['bookmaker'] = 'Betway UK'
        self.assertIn('BOOKMAKER_NOT_BETWAY_ZA', vet(self.row, self.fixtures, NOW))

    def test_unverified_starter(self):
        self.row['starter_confirmed'] = 'false'
        self.assertIn('STARTER_NOT_CONFIRMED', vet(self.row, self.fixtures, NOW))

    def test_wednesday_player_prop_on_tuesday_is_pending_lineup(self):
        self.row['fixture_id'] = 'UCL26-1014-MCI-PSG'
        self.row['lineup_published_at_sast'] = '2026-10-13T17:45:00+02:00'  # claimed; impossible
        reasons = vet(self.row, self.fixtures, NOW)
        self.assertIn('STARTER_NOT_CONFIRMED', reasons)
        self.assertIn('PENDING_LINEUP', reasons)

    def test_wednesday_corners_not_blocked_by_lineup_rule(self):
        self.row.update(fixture_id='UCL26-1014-MCI-PSG', market='match_corners', starter_confirmed='false')
        reasons = vet(self.row, self.fixtures, NOW)
        self.assertNotIn('STARTER_NOT_CONFIRMED', reasons)
        self.assertNotIn('PENDING_LINEUP', reasons)

    def test_starter_claim_without_lineup_evidence(self):
        self.row['lineup_published_at_sast'] = ''
        reasons = vet(self.row, self.fixtures, NOW)
        self.assertIn('STARTER_NOT_CONFIRMED', reasons)
        self.assertIn('LINEUP_PUBLICATION_TIME_MISSING', reasons)
        self.assertIn('STARTER_EVIDENCE_MISSING', reasons)

    def test_legacy_csv_without_starter_columns_fails_closed(self):
        legacy = {k: v for k, v in self.row.items() if k in FIELDS}
        self.assertIn('STARTER_NOT_CONFIRMED', vet(legacy, self.fixtures, NOW))

    def test_negative_edge(self):
        self.row['conservative_p'] = '0.3'
        self.assertIn('LOWER_BOUND_NONPOSITIVE_EV', vet(self.row, self.fixtures, NOW))

    def test_no_independence_assumption(self):
        self.row['evidence_path'] = 'launch/fixtures_2026-10-13.csv'  # file exists, not a real screenshot
        self.assertIn('EVIDENCE_FILETYPE_INVALID', vet(self.row, self.fixtures, NOW))

    def test_no_real_money_decision_even_with_valid_photo(self):
        path = Path(__file__).resolve().parent / 'temp_evidence.png'
        path.write_bytes(PNG)
        try:
            self.row['evidence_path'] = self.row['starter_evidence_path'] = 'launch/tests/temp_evidence.png'
            reasons = vet(self.row, verified(self.fixtures), NOW)
            self.assertEqual(reasons, ['PAPER_RESEARCH_ONLY_JOINT_MODEL_NOT_VALIDATED'])
        finally:
            path.unlink(missing_ok=True)

    def test_no_bad_numeric_values(self):
        self.row['odds_decimal'] = 'NaN'
        self.assertIn('BAD_ODDS', vet(self.row, self.fixtures, NOW))

    def test_no_non_utc_timestamp(self):
        self.row['observed_at_sast'] = '2026-10-13T17:56:00'
        self.assertIn('QUOTE_TIMESTAMP_INVALID', vet(self.row, self.fixtures, NOW))


class TestWindowTicket(unittest.TestCase):
    def setUp(self):
        self.fixtures = verified(load_fixtures())
        self.tmp = tempfile.TemporaryDirectory()
        base = {key: '' for key in pf.QUOTE_FIELDS}
        base.update(market='team_corners', entity_name='Team', threshold='Over 4.5', selection='Over 4.5',
                    odds_decimal='2.0', bookmaker='Betway ZA', observed_at_sast='2026-10-13T20:30:00+02:00',
                    rules_confirmed='true', source_rights_confirmed='true', market_definition_matched='true',
                    probability_model_validated='true', model_id='m', model_p='0.6', conservative_p='0.55',
                    model_evidence='e', independent_council_veto='false')
        self.quotes = {2: {**base, 'fixture_id': 'UCL26-1013-ARS-LIL'},
                       3: {**base, 'fixture_id': 'UCL26-1014-MCI-PSG'},
                       4: {**base, 'fixture_id': 'UCL26-1014-MCI-PSG', 'market': 'player_shots'}}
        self.ticket = {k: '' for k in pf.TICKET_FIELDS}
        self.ticket.update(ticket_id='T1', status='DRAFT', leg_csv_lines='2;3', accepted_combined_odds='25.00',
                           combined_odds_verified='true', quoted_at_sast='2026-10-13T20:31:00+02:00', stake_zar='2.00')

    def tearDown(self):
        self.tmp.cleanup()

    def test_tue_wed_ticket_never_approved(self):
        now = dt.datetime(2026, 10, 13, 20, 32, tzinfo=SAST)
        reasons = vet_ticket(self.ticket, self.quotes, self.fixtures, now)
        self.assertIn('JOINT_MODEL_NOT_VALIDATED', reasons)
        self.assertNotIn('EARLIEST_INCLUDED_KICKOFF_PASSED', reasons)
        self.assertNotIn('COMBINED_PRICE_BELOW_MINIMUM', reasons)  # 25.00 is not rejected by a cap

    def test_wednesday_player_leg_in_tuesday_ticket_is_pending(self):
        self.ticket['leg_csv_lines'] = '2;4'
        reasons = vet_ticket(self.ticket, self.quotes, self.fixtures, dt.datetime(2026, 10, 13, 20, 32, tzinfo=SAST))
        self.assertIn('PENDING_LINEUP:4', reasons)
        self.assertIn('LEG_BLOCKED:4', reasons)

    def test_draft_after_earliest_leg_kickoff(self):
        reasons = vet_ticket(self.ticket, self.quotes, self.fixtures, dt.datetime(2026, 10, 13, 21, 5, tzinfo=SAST))
        self.assertIn('EARLIEST_INCLUDED_KICKOFF_PASSED', reasons)

    def test_append_after_tuesday_started_rejected(self):
        add = {**self.ticket, 'ticket_id': 'T2', 'leg_csv_lines': '3', 'amends_ticket_id': 'T1',
               'quoted_at_sast': '2026-10-13T21:30:00+02:00'}
        reasons = vet_ticket(add, self.quotes, self.fixtures, dt.datetime(2026, 10, 13, 21, 31, tzinfo=SAST),
                             {'T1': self.ticket})
        self.assertIn('CANNOT_APPEND_TO_STARTED_TICKET', reasons)

    def test_unverified_combined_price(self):
        self.ticket['combined_odds_verified'] = 'false'
        reasons = vet_ticket(self.ticket, self.quotes, self.fixtures, dt.datetime(2026, 10, 13, 20, 32, tzinfo=SAST))
        self.assertIn('COMBINED_PRICE_UNVERIFIED', reasons)
        self.assertIn('COMBINED_EVIDENCE_MISSING', reasons)

    def test_same_fixture_dependence(self):
        self.ticket['leg_csv_lines'] = '3;4'
        reasons = vet_ticket(self.ticket, self.quotes, self.fixtures, dt.datetime(2026, 10, 13, 20, 32, tzinfo=SAST))
        self.assertIn('SAME_FIXTURE_DEPENDENCE_UNMODELLED', reasons)

    def test_audit_end_to_end_is_no_bet(self):
        tmp = Path(self.tmp.name)
        with mock.patch.object(pf, 'DATA', tmp / 'data'), mock.patch.object(pf, 'REPORTS', tmp / 'reports'):
            report = pf.audit(now=dt.datetime(2026, 10, 13, 17, 0, tzinfo=SAST))
        self.assertEqual(report['betting_decision'], 'NO BET')
        self.assertEqual(report['fixture_count'], 18)
        self.assertIsNone(report['maximum_combined_odds'])
        self.assertEqual([d['fixture_count'] for d in report['days']], [9, 9])
        self.assertIn('FIXTURES_NOT_OFFICIALLY_VERIFIED', report['window_blockers'])
        self.assertTrue((tmp / 'reports' / 'UCL_2026-10-13_14_PREFLIGHT.md').is_file())


class TestFutureWindows(unittest.TestCase):
    def test_new_weekend_and_ucl_windows(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            with mock.patch.object(pf, 'LAUNCH', tmp), mock.patch.object(pf, 'WINDOWS', tmp / 'windows'), \
                    mock.patch.object(pf, 'DATA', tmp / 'data'), mock.patch.object(pf, 'REPORTS', tmp / 'reports'):
                wid = pf.new_window('weekend', '2026-10-17')
                self.assertEqual(wid, 'WEEKEND_2026-10-17_18')
                config = pf.load_window(wid)
                self.assertEqual(config['dates'], ['2026-10-17', '2026-10-18'])
                self.assertIsNone(config['maximum_decimal_odds'])
                self.assertEqual(pf.load_fixtures(wid), {})  # nothing invented
                report = pf.audit(now=dt.datetime(2026, 10, 16, 12, 0, tzinfo=SAST), window=wid)
                self.assertIn('NO_FIXTURES_ENTERED', report['window_blockers'])
                self.assertEqual(report['betting_decision'], 'NO BET')
                self.assertEqual(pf.new_window('ucl', '2026-10-20'), 'UCL_2026-10-20_21')
                with self.assertRaises(ValueError):
                    pf.new_window('ucl', '2026-10-21')  # Wednesday is not a UCL window start


if __name__ == '__main__':
    unittest.main()
