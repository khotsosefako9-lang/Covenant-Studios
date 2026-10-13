#!/usr/bin/env python3
"""Fail-closed, standard-library preflight for cross-day football prop windows.

Windows: UEFA Champions League Tuesday+Wednesday and domestic Saturday+Sunday (configurable).
One candidate ticket per window or NO BET. This never makes forecasts or wagering decisions,
does not connect to bookmakers, and intentionally never labels an offer a real-money
recommendation.

Commands:
  init         [--window ID]   copy blank quote/observation/ticket CSVs into data/
  audit        [--window ID]   audit every fixture, quote row and draft ticket; writes reports/
  new-window   --kind ucl|weekend --start YYYY-MM-DD   create a future window (blank fixtures)
  list-windows                 list configured windows
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path
from decimal import Decimal, InvalidOperation

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from reference.window_contract import (  # noqa: E402
    MINIMUM_COMBINED_DECIMAL_ODDS, WINDOW_KINDS, PLAYER_MARKETS, check_window_risk,
    starter_gate, validate_append, validate_cross_day_commit, window_dates, window_id,
    window_exposure_limits,
)

LAUNCH = ROOT / 'launch'
WINDOWS = LAUNCH / 'windows'
DATA = ROOT / 'data'
REPORTS = ROOT / 'reports'
ZONE = dt.timezone(dt.timedelta(hours=2))  # Africa/Johannesburg: UTC+2, no DST.
MAX_AGE = dt.timedelta(minutes=10)
DEFAULT_WINDOW = 'UCL_2026-10-13_14'
ALLOWED = {'player_shots', 'player_sot', 'player_booking', 'team_corners', 'match_corners'}
FIELDS = ['fixture_id', 'market', 'entity_name', 'threshold', 'selection', 'odds_decimal', 'bookmaker',
          'observed_at_sast', 'evidence_path', 'starter_confirmed', 'rules_confirmed',
          'source_rights_confirmed', 'market_definition_matched', 'probability_model_validated',
          'model_id', 'model_p', 'conservative_p', 'model_evidence', 'independent_council_veto']
# Added for the strict starter rule; absent columns read as blank and therefore fail closed.
STARTER_FIELDS = ['lineup_published_at_sast', 'starter_evidence_path']
QUOTE_FIELDS = FIELDS + STARTER_FIELDS
TICKET_FIELDS = ['ticket_id', 'status', 'leg_csv_lines', 'accepted_combined_odds', 'combined_odds_verified',
                 'combined_evidence_path', 'quoted_at_sast', 'submitted_at_sast', 'stake_zar',
                 'dependence_method', 'joint_model_id', 'joint_p', 'joint_conservative_p',
                 'amends_ticket_id']
FIXTURE_FIELDS = ['fixture_id', 'date', 'home', 'away', 'kickoff_sast', 'fixture_source',
                  'verification_status', 'checked_at_sast', 'verification_evidence']
OFFICIALLY_VERIFIED = 'VERIFIED_OFFICIAL'
OBSERVATION_FIELDS = ['fixture_id', 'entity_name', 'match_date', 'provider', 'source_url',
                      'source_license_verified', 'available_as_of_sast', 'playing_minutes', 'shots', 'sot',
                      'corners_taken', 'yellow_cards', 'red_cards', 'raw_evidence_path', 'notes']
EVIDENCE_TYPES = {'.png', '.jpg', '.jpeg', '.webp', '.pdf'}


# ---------------------------------------------------------------- window config

def load_window(window=DEFAULT_WINDOW):
    path = WINDOWS / f'{window}.json'
    if not path.is_file():
        raise FileNotFoundError(f'No window config {path}; run `list-windows` or `new-window`')
    config = json.loads(path.read_text(encoding='utf-8'))
    if config.get('window_id') != window:
        raise ValueError(f'{path} declares window_id {config.get("window_id")!r}')
    if config.get('maximum_decimal_odds') is not None:
        raise ValueError('Window config must not impose a maximum combined price')
    if Decimal(config['minimum_accepted_decimal_odds']) != MINIMUM_COMBINED_DECIMAL_ODDS:
        raise ValueError('Window minimum combined price must be 10.00')
    return config


def data_file(config, key):
    return DATA / config['data_files'][key]


def load_fixtures(window=DEFAULT_WINDOW):
    config = load_window(window)
    rows = []
    for filename in config['fixture_files']:
        with (LAUNCH / filename).open(newline='', encoding='utf-8-sig') as stream:
            reader = csv.DictReader(stream)
            missing = set(FIXTURE_FIELDS) - set(reader.fieldnames or [])
            if missing:
                raise ValueError(f'{filename} missing columns: ' + ', '.join(sorted(missing)))
            rows.extend(reader)
    fixtures = {r['fixture_id']: r for r in rows}
    if len(fixtures) != len(rows):
        raise ValueError('Duplicate fixture IDs across days')
    allowed_dates = set(config['dates'])
    for r in rows:
        if r['date'] not in allowed_dates:
            raise ValueError(f"{r['fixture_id']} date {r['date']} is outside window {window}")
        if parse_instant(r['kickoff_sast']).astimezone(ZONE).date().isoformat() != r['date']:
            raise ValueError(f"{r['fixture_id']} kickoff does not fall on its listed date")
    return fixtures


def list_windows():
    return sorted(p.stem for p in WINDOWS.glob('*.json'))


def new_window(kind, start, now=None):
    """Create a window config + header-only fixture files. Never invents fixtures."""
    dates = window_dates(kind, start)
    wid = window_id(kind, dates)
    spec = WINDOW_KINDS[kind]
    config_path = WINDOWS / f'{wid}.json'
    if config_path.exists():
        print(f'Preserved existing {config_path}')
        return wid
    WINDOWS.mkdir(exist_ok=True)
    fixture_files = []
    for d in dates:
        name = f'fixtures/{wid}/fixtures_{d.isoformat()}.csv'
        target = LAUNCH / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_text(','.join(FIXTURE_FIELDS) + '\n', encoding='utf-8')
        fixture_files.append(name)
    config = {
        'window_id': wid, 'kind': kind, 'competition': spec['competition'], 'days_label': spec['label'],
        'local_timezone': 'Africa/Johannesburg', 'dates': [d.isoformat() for d in dates],
        'fixture_files': fixture_files,
        'data_files': {'quotes': f'quotes_{wid}.csv', 'observations': f'observations_{wid}.csv',
                       'tickets': f'tickets_{wid}.csv'},
        'accumulator_policy': 'ONE_COMBINED_CROSS_DAY_TICKET', 'minimum_accepted_decimal_odds': '10.00',
        'maximum_decimal_odds': None, 'primary_ticket_max_count': 1,
        'submission_must_precede_earliest_selected_kickoff': True, 'winner_predictions_default_enabled': False,
        'window_start_available_balance_zar': None, 'mode': 'RESEARCH_ONLY',
        'created_at_utc': (now or dt.datetime.now(dt.timezone.utc)).isoformat(),
        'rules': 'Fixtures must be entered by hand from the official competition source and marked '
                 'VERIFIED_OFFICIAL only after checking it. All legs and their accepted combined price must be '
                 'fixed before the earliest included kickoff; no appending to a submitted ticket. Future-day '
                 'starters cannot be marked confirmed before the actual team sheet.',
    }
    config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Created {config_path} (fixtures are blank: enter and verify them by hand)')
    return wid


# ---------------------------------------------------------------- parsing helpers

def parse_instant(value):
    when = dt.datetime.fromisoformat(value.strip())
    if when.tzinfo is None or when.utcoffset() is None:
        raise ValueError('timezone offset missing')
    return when.astimezone(dt.timezone.utc)


def to_decimal(value):
    x = Decimal(value.strip())
    if not x.is_finite():
        raise InvalidOperation('non-finite')
    return x


def truth(value):
    return str(value).strip().lower() in {'true', 'yes', '1'}


def _has_supported_magic(path):
    try:
        with path.open('rb') as stream:
            head = stream.read(16)
    except OSError:
        return False
    ext = path.suffix.lower()
    if ext == '.png':
        return head.startswith(b'\x89PNG\r\n\x1a\n')
    if ext in {'.jpg', '.jpeg'}:
        return head.startswith(b'\xff\xd8\xff')
    if ext == '.webp':
        return head.startswith(b'RIFF') and head[8:12] == b'WEBP'
    if ext == '.pdf':
        return head.startswith(b'%PDF-')
    return False


def evidence_problem(value, prefix='EVIDENCE'):
    """Return a blocker code for a screenshot path, or None when a real image/PDF file exists."""
    evidence = (value or '').strip()
    if not evidence:
        return f'{prefix}_MISSING'
    if '..' in Path(evidence).parts or Path(evidence).is_absolute():
        return f'{prefix}_PATH_UNSAFE'
    if not (ROOT / evidence).is_file():
        return f'{prefix}_FILE_NOT_FOUND'
    if Path(evidence).suffix.lower() not in EVIDENCE_TYPES:
        return f'{prefix}_FILETYPE_INVALID'
    if not _has_supported_magic(ROOT / evidence):
        return f'{prefix}_FILE_SIGNATURE_INVALID'
    return None


# ---------------------------------------------------------------- leg gate

def vet(row, fixtures, now=None):
    """Returns explicit blockers; no rows are approved as real-money picks."""
    now = now or dt.datetime.now(dt.timezone.utc)
    row = {**{k: '' for k in STARTER_FIELDS}, **row}
    reasons = []
    missing = [f for f in FIELDS if f not in row]
    if missing:
        return ['SCHEMA_MISSING:' + ','.join(missing)]
    fixture = fixtures.get(row['fixture_id'])
    kickoff = None
    if fixture is None:
        reasons.append('FIXTURE_UNKNOWN')
    else:
        kickoff = parse_instant(fixture['kickoff_sast'])
        if now >= kickoff:
            reasons.append('KICKOFF_PASSED')
        if fixture.get('verification_status', '').strip() != OFFICIALLY_VERIFIED:
            reasons.append('FIXTURE_NOT_OFFICIALLY_VERIFIED')
    if row['market'] not in ALLOWED:
        reasons.append('MARKET_NOT_ENABLED')
    if not row['entity_name'].strip():
        reasons.append('IDENTITY_MISSING')
    if not row['selection'].strip():
        reasons.append('SELECTION_MISSING')
    if not row['threshold'].strip():
        reasons.append('EXACT_LINE_MISSING')
    try:
        price = to_decimal(row['odds_decimal'])
        if price <= 1 or price > Decimal('10000'):
            reasons.append('BAD_ODDS')
    except (InvalidOperation, ValueError):
        reasons.append('BAD_ODDS')
        price = None
    if row['bookmaker'].strip().lower() not in {'betway za', 'betway south africa', 'betway.co.za'}:
        reasons.append('BOOKMAKER_NOT_BETWAY_ZA')
    try:
        observed = parse_instant(row['observed_at_sast'])
        if observed > now:
            reasons.append('QUOTE_FROM_FUTURE')
        elif now - observed > MAX_AGE:
            reasons.append('QUOTE_STALE')
        if kickoff is not None and observed >= kickoff:
            reasons.append('QUOTE_POST_KICKOFF')
    except (ValueError, TypeError):
        reasons.append('QUOTE_TIMESTAMP_INVALID')
    problem = evidence_problem(row['evidence_path'])
    if problem:
        reasons.append({'EVIDENCE_MISSING': 'SCREENSHOT_EVIDENCE_MISSING'}.get(problem, problem))
    if row['market'] in PLAYER_MARKETS:
        if kickoff is None:
            reasons.append('STARTER_NOT_CONFIRMED')
        else:
            try:
                published = parse_instant(row['lineup_published_at_sast']) if row['lineup_published_at_sast'].strip() else None
            except ValueError:
                published = None
            reasons.extend(starter_gate(
                market=row['market'], kickoff=kickoff, decision_at=now,
                starter_confirmed=truth(row['starter_confirmed']), lineup_published_at=published,
                starter_evidence_present=evidence_problem(row['starter_evidence_path']) is None))
    if not truth(row['rules_confirmed']):
        reasons.append('SETTLEMENT_RULES_UNVERIFIED')
    if not truth(row['market_definition_matched']):
        reasons.append('DATA_MARKET_MISMATCH')
    if not truth(row['source_rights_confirmed']):
        reasons.append('SOURCE_RIGHTS_UNVERIFIED')
    if not truth(row['probability_model_validated']):
        reasons.append('MODEL_UNVALIDATED')
    if not row['model_id'].strip() or not row['model_evidence'].strip():
        reasons.append('MODEL_PROVENANCE_MISSING')
    try:
        p = to_decimal(row['model_p'])
        lower = to_decimal(row['conservative_p'])
        if not (0 < lower <= p <= 1):
            reasons.append('INVALID_PROBABILITIES')
        if price is not None and lower * price <= Decimal('1'):
            reasons.append('LOWER_BOUND_NONPOSITIVE_EV')
    except (InvalidOperation, ValueError):
        reasons.append('MODEL_PROBABILITY_MISSING')
    if truth(row['independent_council_veto']):
        reasons.append('COUNCIL_VETO')
    # Conservative by design: even complete individual rows are not sufficient to build
    # a bet; the correlated joint model + bookmaker accepted combined price are absent.
    if not reasons:
        reasons.append('PAPER_RESEARCH_ONLY_JOINT_MODEL_NOT_VALIDATED')
    return reasons


LEG_PAPER_MARKER = 'PAPER_RESEARCH_ONLY_JOINT_MODEL_NOT_VALIDATED'


# ---------------------------------------------------------------- ticket gate

def vet_ticket(ticket, quotes, fixtures, now, tickets_by_id=None):
    """Window-level ticket gate. A ticket is never approved; it lists every blocker found.

    `quotes` maps CSV line number -> quote row. Legs may come from either window day.
    """
    reasons = []
    tickets_by_id = tickets_by_id or {}
    if ticket.get('amends_ticket_id', '').strip():
        original = tickets_by_id.get(ticket['amends_ticket_id'].strip())
        kicks = []
        if original is not None:
            for line in _leg_lines(original)[0]:
                q = quotes.get(line)
                if q and q['fixture_id'] in fixtures:
                    kicks.append(parse_instant(fixtures[q['fixture_id']]['kickoff_sast']))
        try:
            attempted = parse_instant(ticket['quoted_at_sast'])
        except (ValueError, TypeError):
            attempted = now
        reasons.extend(validate_append(original_kickoffs=kicks, attempted_at=attempted))
    lines, bad = _leg_lines(ticket)
    if bad:
        reasons.append('LEG_REFERENCE_INVALID')
    if not lines:
        return reasons + ['NO_SELECTIONS']
    legs = []
    for line in lines:
        q = quotes.get(line)
        if q is None:
            reasons.append(f'LEG_NOT_FOUND:{line}')
            continue
        legs.append((line, q))
    try:
        decision_at = parse_instant(ticket['submitted_at_sast']) if ticket.get('submitted_at_sast', '').strip() \
            else parse_instant(ticket['quoted_at_sast'])
    except (ValueError, TypeError):
        decision_at = None
        reasons.append('TICKET_TIMESTAMP_INVALID')
    kickoffs = []
    fixture_ids = []
    for line, q in legs:
        leg_reasons = [r for r in vet(q, fixtures, decision_at or now) if r != LEG_PAPER_MARKER]
        if leg_reasons:
            reasons.append(f'LEG_BLOCKED:{line}')
        if q['fixture_id'] in fixtures:
            kickoffs.append(parse_instant(fixtures[q['fixture_id']]['kickoff_sast']))
            fixture_ids.append(q['fixture_id'])
            if decision_at is not None and q['market'] in PLAYER_MARKETS:
                gate = starter_gate(market=q['market'], kickoff=kickoffs[-1], decision_at=decision_at,
                                    starter_confirmed=False)
                if 'PENDING_LINEUP' in gate:
                    reasons.append(f'PENDING_LINEUP:{line}')
        try:
            if decision_at is not None and abs(parse_instant(q['observed_at_sast']) - decision_at) > MAX_AGE:
                reasons.append(f'LEG_QUOTE_NOT_CONTEMPORANEOUS:{line}')
        except (ValueError, TypeError):
            pass
    if decision_at is not None and kickoffs:
        price = ticket.get('accepted_combined_odds', '').strip() or None
        reasons.extend(validate_cross_day_commit(
            kickoffs=kickoffs, submitted_at=decision_at, accepted_combo_price=price,
            combo_verified=truth(ticket.get('combined_odds_verified', ''))))
    # A draft that was not submitted before its earliest leg started can no longer be submitted.
    if kickoffs and not ticket.get('submitted_at_sast', '').strip() and now >= min(kickoffs) \
            and 'EARLIEST_INCLUDED_KICKOFF_PASSED' not in reasons:
        reasons.append('EARLIEST_INCLUDED_KICKOFF_PASSED')
    problem = evidence_problem(ticket.get('combined_evidence_path', ''), 'COMBINED_EVIDENCE')
    if problem:
        reasons.append(problem)
    if len(set(fixture_ids)) != len(fixture_ids) and not ticket.get('dependence_method', '').strip():
        reasons.append('SAME_FIXTURE_DEPENDENCE_UNMODELLED')
    if len(set(lines)) != len(lines):
        reasons.append('DUPLICATE_LEG')
    # No joint-probability model is validated in this project yet: never multiply marginals.
    reasons.append('JOINT_MODEL_NOT_VALIDATED')
    return reasons


def _leg_lines(ticket):
    out, bad = [], False
    for part in (ticket.get('leg_csv_lines') or '').replace(',', ';').split(';'):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            bad = True
    return out, bad


# ---------------------------------------------------------------- commands

def init(window=DEFAULT_WINDOW):
    config = load_window(window)
    DATA.mkdir(exist_ok=True)
    for key, header in (('quotes', QUOTE_FIELDS), ('observations', OBSERVATION_FIELDS), ('tickets', TICKET_FIELDS)):
        target = data_file(config, key)
        if target.exists():
            print(f'Preserved existing {target}')
        else:
            target.write_text(','.join(header) + '\n', encoding='utf-8')
            print(f'Created {target}')


def _read_csv(path, required):
    with path.open(newline='', encoding='utf-8-sig') as stream:
        reader = csv.DictReader(stream)
        missing_headers = set(required) - set(reader.fieldnames or [])
        if missing_headers:
            raise ValueError(f'{path.name} missing CSV columns: ' + ', '.join(sorted(missing_headers)))
        return list(reader)


def audit(now=None, window=DEFAULT_WINDOW):
    config = load_window(window)
    REPORTS.mkdir(exist_ok=True)
    fixtures = load_fixtures(window)
    if any(not data_file(config, k).exists() for k in ('quotes', 'observations', 'tickets')):
        init(window)
    entries = _read_csv(data_file(config, 'quotes'), FIELDS)
    tickets = _read_csv(data_file(config, 'tickets'), TICKET_FIELDS)
    now = now or dt.datetime.now(dt.timezone.utc)

    results = []
    quotes_by_line = {}
    for i, row in enumerate(entries, start=2):
        quotes_by_line[i] = row
        reasons = vet(row, fixtures, now)
        status = 'PENDING_LINEUP' if 'PENDING_LINEUP' in reasons else 'BLOCKED'
        results.append({'csv_line': i, 'fixture_id': row['fixture_id'], 'selection': row['selection'],
                        'market': row['market'], 'blockers': reasons, 'status': status})

    tickets_by_id = {t['ticket_id']: t for t in tickets}
    risk = check_window_risk(
        window_start_balance_zar=config.get('window_start_available_balance_zar'),
        tickets=[{'ticket_id': t['ticket_id'], 'stake_zar': t['stake_zar'], 'legs': _leg_lines(t)[0]}
                 for t in tickets])
    ticket_results = []
    for t in tickets:
        reasons = vet_ticket(t, quotes_by_line, fixtures, now, tickets_by_id) + risk.get(t['ticket_id'], [])
        ticket_results.append({'ticket_id': t['ticket_id'], 'leg_csv_lines': _leg_lines(t)[0],
                               'accepted_combined_odds': t['accepted_combined_odds'] or None,
                               'blockers': reasons, 'status': 'BLOCKED'})
    if len(tickets) > config.get('primary_ticket_max_count', 1):
        for tr in ticket_results:
            tr['blockers'].append('MORE_THAN_ONE_PRIMARY_TICKET_IN_WINDOW')

    days = []
    for d in config['dates']:
        day_fixtures = sorted((f for f in fixtures.values() if f['date'] == d), key=lambda f: f['kickoff_sast'])
        day = {'date': d, 'fixture_count': len(day_fixtures),
               'earliest_kickoff_sast': day_fixtures[0]['kickoff_sast'] if day_fixtures else None,
               'fixtures': []}
        for f in day_fixtures:
            rows = [r for r in results if r['fixture_id'] == f['fixture_id']]
            kickoff = parse_instant(f['kickoff_sast'])
            if now >= kickoff:
                state = 'KICKED_OFF'
            elif not rows:
                state = 'WATCHLIST_NO_QUOTES'
            elif any(r['status'] == 'PENDING_LINEUP' for r in rows):
                state = 'PENDING_LINEUP'
            else:
                state = 'BLOCKED'
            day['fixtures'].append({**{k: f[k] for k in FIXTURE_FIELDS}, 'watchlist_state': state,
                                    'quote_rows': len(rows)})
        days.append(day)
    earliest = min((parse_instant(f['kickoff_sast']) for f in fixtures.values()), default=None)
    upcoming = [parse_instant(f['kickoff_sast']) for f in fixtures.values() if parse_instant(f['kickoff_sast']) > now]
    unverified = sorted(f['fixture_id'] for f in fixtures.values()
                        if f['verification_status'].strip() != OFFICIALLY_VERIFIED)
    window_blockers = []
    if not fixtures:
        window_blockers.append('NO_FIXTURES_ENTERED')
    if unverified:
        window_blockers.append('FIXTURES_NOT_OFFICIALLY_VERIFIED')
    if not entries:
        window_blockers.append('NO_BETWAY_ZA_QUOTES')
    if not tickets:
        window_blockers.append('NO_CANDIDATE_TICKET')
    window_blockers += ['NO_VALIDATED_PROBABILITY_MODEL', 'JOINT_MODEL_NOT_VALIDATED']
    if config.get('window_start_available_balance_zar') in (None, ''):
        window_blockers.append('WINDOW_BALANCE_UNKNOWN')
    limits = None
    if config.get('window_start_available_balance_zar') not in (None, ''):
        limits = {k: str(v) for k, v in window_exposure_limits(config['window_start_available_balance_zar']).items()}

    report = {
        'report_kind': 'CROSS_DAY_WINDOW_PROP_PREFLIGHT', 'window_id': config['window_id'],
        'competition': config['competition'], 'report_created_at_utc': now.isoformat(),
        'evaluation_window': config['dates'], 'local_timezone': 'Africa/Johannesburg',
        'mode': 'RESEARCH_ONLY', 'betting_decision': 'NO BET',
        'reason': 'No validated, bookmaker-confirmed and joint-probability-assessed accumulator. Tool never authorises bets.',
        'window_blockers': window_blockers,
        'fixture_count': len(fixtures), 'fixtures_not_officially_verified': unverified,
        'earliest_window_kickoff_sast': earliest.astimezone(ZONE).isoformat() if earliest else None,
        'next_upcoming_kickoff_sast': min(upcoming).astimezone(ZONE).isoformat() if upcoming else None,
        'quotes_count': len(entries), 'tickets_count': len(tickets),
        'minimum_combined_odds': '10.00', 'maximum_combined_odds': None,
        'window_exposure_limits_zar': limits, 'days': days, 'entries': results, 'tickets': ticket_results,
    }
    stem = f"{config['window_id']}_PREFLIGHT"
    dest = REPORTS / f'{stem}.json'
    dest.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    md = REPORTS / f'{stem}.md'
    md.write_text(_markdown(config, report, now), encoding='utf-8')
    print(f"Window {config['window_id']}: final decision NO BET; {len(fixtures)} fixtures; "
          f"{len(entries)} quote rows; {len(tickets)} draft tickets.\n"
          f"Window blockers: {', '.join(window_blockers)}\nSaved: {md}\nSaved: {dest}")
    return report


def _sast(value):
    return parse_instant(value).astimezone(ZONE).strftime('%a %d %b %H:%M')


def _markdown(config, report, now):
    L = [f"# {config['window_id']} — cross-day research preflight ({config['competition']})", '',
         f'- Checked: {now.astimezone(ZONE).isoformat()} (Africa/Johannesburg)',
         f"- Window dates: {' + '.join(config['dates'])} — ONE candidate ticket for the whole window, or NO BET",
         '- Mode: RESEARCH ONLY', '- Final decision: **NO BET**',
         '- Reason: No qualifying, statistically validated accumulator can be inferred from this tool.',
         f"- Window blockers: {', '.join(report['window_blockers'])}",
         f"- Fixture count: {report['fixture_count']} (not officially verified: {len(report['fixtures_not_officially_verified'])})",
         f"- Manual quote rows: {report['quotes_count']} | draft tickets: {report['tickets_count']}",
         '- Minimum Betway-accepted combined decimal odds: 10.00 (no maximum; not a target)',
         f"- Window exposure limits: {report['window_exposure_limits_zar'] or 'UNKNOWN — window start balance not entered'}",
         '']
    if report['earliest_window_kickoff_sast']:
        L.append(f"Submission deadline for a ticket = the earliest kickoff among the legs it actually includes. "
                 f"Earliest kickoff in the window: {_sast(report['earliest_window_kickoff_sast'])} SAST.")
        L.append('')
    for day in report['days']:
        L += [f"## Daily watchlist — {day['date']} (preliminary; not a mandatory ticket)", '']
        if not day['fixtures']:
            L.append('- No fixtures entered. Enter them by hand from the official source; none were invented.')
        for f in day['fixtures']:
            L.append(f"- {f['kickoff_sast'][11:16]} SAST — {f['home']} vs {f['away']} ({f['fixture_id']}) — "
                     f"{f['watchlist_state']}; fixture check: {f['verification_status'] or 'UNVERIFIED'}")
        L.append('')
    L += ['## Manual quote audit', '']
    if not report['entries']:
        L.append('- None. The blank quote template is intentional; no prices or players were invented.')
    for item in report['entries']:
        L.append(f"- CSV line {item['csv_line']}: {item['fixture_id']} / {item['market']} / "
                 f"{item['selection'] or '<no selection>'} — **{item['status']}**: {', '.join(item['blockers'])}")
    L += ['', '## Window ticket audit', '']
    if not report['tickets']:
        L.append('- No draft ticket. NO BET is the default for the whole window.')
    for t in report['tickets']:
        L.append(f"- Ticket {t['ticket_id']} legs {t['leg_csv_lines']} accepted odds "
                 f"{t['accepted_combined_odds'] or 'UNVERIFIED'} — **BLOCKED**: {', '.join(t['blockers'])}")
    L += ['', '## Important', '',
          'This is not an automated bet picker. No AI confidence score or raw Poisson estimate can bypass a missing calibrated probability model.',
          'Source permissions, bookmaker market settlement, exact lineups, and fresh quote screenshot must be checked before any interpretation.',
          'A window ticket must include ALL legs and the exact bookmaker-accepted combined price BEFORE the earliest selected kickoff. Second-day legs cannot be added to a ticket once submitted.',
          'Second-day player props stay PENDING_LINEUP until that day\'s official team sheets; they cannot be pre-committed on day one under the strict starter rule.',
          'Minimum bookmaker-accepted combined odds are 10.00 decimal; no upper limit, but never add a weak leg to boost payout.',
          'Risk exposure is counted across the whole window and is not reset on the second day.',
          'Never automatically assemble accumulators from independent-leg probability multiplication.', '']
    return '\n'.join(L)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Fail-closed cross-day prop window audit; research only')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('init', 'audit'):
        p = sub.add_parser(name)
        p.add_argument('--window', default=DEFAULT_WINDOW)
    p = sub.add_parser('new-window')
    p.add_argument('--kind', choices=sorted(WINDOW_KINDS), required=True)
    p.add_argument('--start', required=True, help='Tuesday for ucl, Saturday for weekend (YYYY-MM-DD)')
    sub.add_parser('list-windows')
    args = parser.parse_args(argv)
    if args.command == 'init':
        init(args.window)
    elif args.command == 'audit':
        audit(window=args.window)
    elif args.command == 'new-window':
        wid = new_window(args.kind, args.start)
        init(wid)
    else:
        print('\n'.join(list_windows()))


if __name__ == '__main__':
    main()
