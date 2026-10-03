# Covenant Studios — Growth Intelligence (M0)

Internal growth intelligence platform for Covenant Studios. M0 answers one question: can Covenant's
commercial judgement be turned into a repeatable, evidence-backed system that identifies commercially
relevant opportunities?

Operating rule: optimise for commercially relevant conversations created per hour of human effort,
never for the number of leads discovered.

## Phase 1 — current-state assessment

The repository held only a one-line README at the start of M0, so the project is treated as greenfield.
There were no existing dependencies, conventions, migrations, tests or deployment configuration to
inherit.

| Area | State after Phase 1 |
| --- | --- |
| Stack | Next.js 16 (App Router) + TypeScript 5.9, strict mode |
| Database | PostgreSQL 16, accessed through Drizzle (`src/db`) |
| Migrations | drizzle-kit, output to `drizzle/` (Phase 2 schema below) |
| Jobs | pg-boss worker process (`src/worker`), same database, no handlers yet |
| Validation | Zod; environment validated on first database use (`src/lib/env.ts`) |
| HTTP / parsing | undici and cheerio installed for the fetch layer (Phase 5) |
| Tests | Vitest (`tests/`) |
| Deployment | `UNKNOWN`: not decided until the target environment is inspected |

Architecture: one Next.js application plus one worker process against one Postgres database. No
microservices, no Redis, no message broker. Adding any other load-bearing dependency needs a named
problem and approval first.

TypeScript is pinned to 5.9 rather than 7.x because Next.js tooling has not been verified against the
native compiler.

`npm audit` reports 4 moderate findings, all from an old esbuild inside `drizzle-kit`. drizzle-kit is a
dev-only CLI and is never deployed.

## Phase 2 — database schema

Source of truth: the Phase 0 document's data model, opportunity taxonomy, mapping table, scoring
weights, intent gate and benchmark dataset. Schema code lives in `src/db/schema/`, migrations in
`drizzle/`, the configuration seed in `src/db/seed-data.ts`.

### Layers kept separate

| Layer | Tables |
| --- | --- |
| Identity | `companies`, `company_aliases`, `company_duplicate_candidates`, `company_merges`, `company_non_matches`, `duplicate_resolutions`, `contacts`, `contact_channels`, view `company_roots` |
| Observed facts | `sources`, `source_records` (one retrieval each: page, robots.txt, CSV, operator statement) |
| Evidence | `evidence`, view `evidence_provenance` |
| Deterministic audit | `audits`, `audit_findings`, `audit_finding_evidence`, `finding_verifications` |
| Commercial signals | `signals`, `signal_evidence`, `signal_findings` |
| Opportunity interpretation | `opportunities`, `opportunity_findings`, `opportunity_signals` |
| Pursuit and intent gate | `leads`, `lead_disqualifications` |
| Scoring | `scores`, `score_dimensions`, `score_dimension_evidence` |
| Human judgement | `judgements`, `judgement_evidence` |
| Benchmark (evaluation only) | `benchmark_categories`, `benchmark_cases` |
| Ingestion | `csv_import_rows` |
| AI brief and cost | `ai_models`, `ai_runs`, `ai_run_packet_evidence`, `opportunity_briefs`, `brief_claims`, `brief_claim_evidence` |
| Configuration | `service_categories`, `covenant_services`, `opportunity_types`, `opportunity_type_services`, `finding_opportunity_mappings`, `signal_types`, `signal_type_opportunity_types`, `icp_segments`, `icp_segment_services`, `disqualifiers`, `judgement_reasons`, `weight_sets`, `settings` |
| Operations | `system_events` |

There is no generic `leads` mega-table: a lead holds only the pursuit state, the intent gate and a
pointer to its current score.

### Guarantees enforced by the database

- **Provenance.** `evidence.source_record_id` is `NOT NULL` with a foreign key. Source URL and retrieval
  time come from the source record, read through `evidence_provenance`. A fetched source must have a
  URL; an operator statement or manual entry must be attributed.
- **Claim taxonomy.** `INFERRED` requires an `inference_rule`; `UNKNOWN` cannot carry a value.
  Opportunities can only be `INFERRED` or `REPORTED`, never `VERIFIED`.
- **Evidence is immutable** (trigger). Only `superseded_by_id` and `last_verified_at` may change, and a
  supersession cannot be undone.
- **Identity.** At most one active company per domain (partial unique index). Domains must be
  normalised (lower case, no scheme, no `www.`). Name collisions are allowed. Possible duplicates
  live in `company_duplicate_candidates` as `proposed` until a human resolves them. A merge sets
  `status = merged` + `merged_into_id` and deletes nothing.
- **Blocked audits.** `SOURCE_BLOCKED` requires a `block_reason` and the source record proving it
  (e.g. the robots.txt retrieval). `FAILED` requires an error code. A `FAIL` finding requires a severity.
- **Human-only signals** (trigger). A `signal_types.human_only` type (`procurement_scorecard`) can only
  be raised by `detected_by = operator`.
- **Opportunity → service** (trigger). An opportunity may only name a service that its type maps to
  in `opportunity_type_services`.
- **Intent gate.** `COMMERCIAL_OPPORTUNITY` and `OUTREACH_READY` require `intent_gate_status = PASSED`
  (CHECK), and a pass must record its basis. A human override needs an actor and a reason. Digital
  weakness alone cannot put a lead in a qualified state.
- **Channel suitability.** Recorded separately from `lead_state` (`segment_fit`,
  `outreach_channel_suitability` + reason), so category 15 organisations stay visible.
- **Scores.** Total 0–100; confidence and evidence quality 0–1, in separate columns. Score runs and
  their dimensions are append-only (trigger). Weights must sum to 1, only one set can be active, and a
  set's weights are frozen once any score uses it (trigger). Adjusting weights means a new version.
- **Judgements.** Append-only (trigger). A `review` judgement must reference a score **of the same lead**
  (composite foreign key). A `benchmark_blind` judgement must have no score, because the operator
  judges before seeing system output. Reason `other` requires notes. Reason codes come from the
  `judgement_reasons` lookup table (foreign key), so a new code is a row, not a migration.
- **Human-only disqualifiers** (trigger). A disqualifier with `human_only` can only be recorded against
  evidence produced by an operator, so it can never fire automatically.
- **Benchmark cases.** One per category, one per company. Selection criteria, typicality rationale,
  alternatives considered and selector are required. The linked human verdict must be a
  `benchmark_blind` judgement (composite foreign key). A disagreement outcome requires a diagnosis.
- **Evidence-id binding.** A brief claim can only cite evidence that was in the packet sent on the
  same AI run (composite foreign key into `ai_run_packet_evidence`).

### Decisions worth knowing

- **Facts live only in evidence.** `companies` holds identity (domain, display name, normalised name).
  Industry, location, size and similar are evidence rows (`claim_key = company.industry`, …).
- **Weights are columns, not rows.** One numeric column per dimension makes "sums to 1" a plain CHECK.
  Adding a dimension is a migration, which is right because each dimension needs code in `core/scoring`.
- **`PENDING_EVALUATION` lead state** was added in front of the four Phase 0 states for a lead whose gate
  has not run yet.
- **Decay is not stored.** Signals keep `observed_at` (and optional `decays_at`); decay is applied at read
  time, per Phase 0.
- **Freshness is not stored.** Rows carry `last_verified_at`; the freshness state is derived from the
  `freshness_refresh_days` setting.
- **Category verdicts are never read by the pipeline.** They exist only in `benchmark_categories`. No
  companies were created from categories.
- **Seed never overwrites.** `npm run db:setup` inserts missing configuration and leaves operator edits
  alone. Settings without a documented value are seeded as `null` (NOT_CONFIGURED).
- **JSONB is limited** to `icp_segments.criteria`, `settings.value` and `system_events.context`. The first
  two are validated with Zod in `src/db/validation.ts`.
- **Enums only for closed sets.** Taxonomies Covenant may extend are lookup tables: service categories
  and judgement reason codes. The remaining enums (claim types, lead and gate states, verdicts, audit,
  fetch and finding states, score dimensions) are fixed by the architecture. Changing them means code
  changes as well, so a migration is the right cost.
- **Configuration provenance.** `settings`, `signal_types`, `disqualifiers` and `judgement_reasons` carry
  `config_origin`: `documented` (from a source document), `default` (an operator-adjustable default
  agreed with Covenant, not a fact) or `operator` (edited by an operator; the seed never touches it).
- **Tables beyond the Phase 0 entity list.** `finding_verifications` stays: finding accuracy (≥ 95%) and
  the false-positive rate are M0 hard gates. They need a stored human truth label per finding, kept
  apart from the deterministic finding itself, with history. `evidence_derivations` was dropped in
  Phase 3: nothing in M0 writes `INFERRED` evidence rows. Audit output is `VERIFIED`, ingest and operator
  input are `REPORTED`, and interpretations live in `opportunities` and `brief_claims` with their own
  evidence links. See DEFERRED.
- `is_demo` is on `companies` only. The production insert guard belongs with deployment and is not built.

## Phase 3 — company ingestion

Manual entry and CSV import, with no fetching, auditing or AI.

- **Pure core functions** (`src/core/`, no I/O):
  - `normaliseDomain` reduces a website to its identity domain: lower case, punycode, no scheme, path,
    port, credentials or `www.`. It rejects emails, IP addresses and hosts with no suffix. Shared
    platforms (Facebook, Instagram, Linktree, wa.me, Google Sites…) are not a company's own domain.
    Such a company is imported without a domain, and the URL is kept as evidence.
  - `normaliseCompanyName` strips SA legal forms such as (Pty) Ltd, CC and NPC. `splitTradingAs` splits
    "X t/a Y" into a legal name and a trading name.
  - `normalisePhone` produces E.164 (+27…). `normaliseEmail` lower-cases and validates.
  - `parseCsv` is an RFC 4180 parser.
  - `validateCompanyInput` reports every issue in a row. `findDuplicateCandidates` proposes pairs.
- **Identity rule.** An exact domain match is the same company. The row is recorded as
  `matched_existing` and nothing is written to the existing company. Everything else creates a company
  and proposes `company_duplicate_candidates` for a human:
  - name similarity at or above the `dedupe_name_similarity_threshold` setting (default 0.6)
  - subdomain relations
  - shared phone numbers or email addresses

  Nothing is ever merged. Subdomains are not collapsed to a registrable domain, because that needs the
  public suffix list (a new dependency). A subdomain relation is proposed as a candidate instead.
- **Provenance.**
  - Each CSV file is one `source_records` row (`csv_import`) holding the raw file, a SHA-256 hash, the
    file name and the operator.
  - A manual entry is a `manual_entry` source record holding the submitted fields.
  - Every supplied field becomes `REPORTED` evidence, attributed through its source record. The locator
    reads like `row 7, column "Website"`.
  - Phone and email become `contact_channels` linked to their evidence. Legal and trading names become
    aliases.
- **CSV rows are never discarded.** Every data row lands in `csv_import_rows` with its line number,
  raw values, status and issue codes plus readable detail:
  - `imported`
  - `matched_existing`
  - `invalid` (validation errors, wrong column count)
  - `failed` (unexpected error)

  Each row runs in its own savepoint, so one failing row never stops the batch. Problems with the
  whole file are rejected before anything is written: unparseable, no name column, over 5 MB or 5,000
  rows, or an identical file already imported.
- **Interfaces.** Command line only, until the lead review UI (Phase 12) and authentication exist:

```sh
npm run import:csv -- prospects.csv --by "Khotso"
npm run company:add -- --name "Acme Supplies (Pty) Ltd" --website acme.co.za --phone "041 123 4567" --by "Khotso"
```

  Recognised CSV columns, case-insensitive: name/company/company name/business name, website/url/domain,
  legal name, trading name, industry/sector, location/city/town/area, phone/telephone/tel,
  email/e-mail. Other columns are reported as ignored.

## Phase 4 — identity resolution

A human resolves every proposed duplicate. Each decision records actor, timestamp and a required
reason in the append-only `duplicate_resolutions` table.

| Action | Effect |
| --- | --- |
| Confirm | Merges the pair, keeping the company the operator names (`--keep`). Every other open candidate for the same pair is resolved with it |
| Reject | Records a permanent `company_non_matches` row. A trigger blocks any future candidate for that pair, on any basis |
| Defer | Parks the candidate as `deferred`. It can still be confirmed or rejected later |
| Unmerge | Reverses a merge. The `company_merges` row is kept and marked unmerged, and the candidates it confirmed return to `proposed` |

**A merge moves nothing.** The loser keeps every source record, evidence row, audit, finding, signal,
opportunity, lead and score it owns, with its original `company_id`. It only gains
`status = merged` and `merged_into_id = <winner>`. The loser's display name, legal and trading names
(as `merged_identity`) and its domain (as `merged_domain`) become aliases of the winner, tagged with
the merge's id.

Reads that want everything about a business go through the `company_roots` view, which maps every
company to the active root of its cluster. Because nothing moved, the immutable evidence and score
triggers never come into play, every provenance chain stays as it was, and unmerge is exact: it deletes
the merge-tagged aliases and flips the loser back to active. The tests snapshot every other table
before a merge, after it and after the unmerge, and assert they are identical.

Guards:
- Only two active companies can be merged; a trigger also refuses a merge into a non-active company,
  so cycles are impossible.
- An unmerge is refused if the loser's domain has meanwhile been taken by another active company.
- Import resolves a merged company's domain to its cluster root, so a later CSV row cannot recreate
  the merged identity as a new company.
- Alias uniqueness is on the exact value, so names that differ only by legal form are both kept.

```sh
npm run duplicates -- list [--status proposed|deferred|confirmed_duplicate|rejected]
npm run duplicates -- confirm <candidateId> --keep <companyId> --by "Khotso" --reason "Same supplier, typo"
npm run duplicates -- reject  <candidateId> --by "Khotso" --reason "Separate businesses"
npm run duplicates -- defer   <candidateId> --by "Khotso" --reason "Need to call them"
npm run duplicates -- unmerge <mergeId>     --by "Khotso" --reason "Wrong merge"
npm run duplicates -- show    <companyId>
```

### Phase 4 configuration corrections

- **Reason codes** are the controlled list of 13 from Phase 0. The earlier codes `good_service_fit`,
  `poor_digital_presence` and `no_obvious_budget` are retired (`active = false`), not deleted. A trigger
  stops new judgements from using a retired code.
- **`commercial_potential_floor_zar` = 3500** applies to `initial_value`: the lowest published
  full-project entry price. Add-ons (from R250) and retainers (from R450/mo) are not entry points. The
  definition is stored in the setting's description so it is not re-derived. Seeded descriptions
  follow the code unless an operator has edited the row.
- **Delivery terms** are settings, `documented`: 2–4 week cycles, fixed quotes locked at sign-off, 50%
  deposit, 30-day post-launch warranty.
- **Prices** match the transcription supplied with the Phase 4 authorization exactly, and a test now
  pins them.

## Running locally

Requires Node 22.12+ and PostgreSQL.

```sh
cp .env.example .env        # set DATABASE_URL
npm install
npm run db:setup            # apply migrations + idempotent configuration seed
npm run dev                 # app on :3000, health at /api/health
npm run worker              # background job worker
npm run typecheck && npm test   # DB tests create and drop a throwaway database via DATABASE_URL
```

## Deferred

Items that belong to a later milestone are recorded here with their reason, dependency, expected value
and target phase, and are not built in M0.

| Item | Reason | Dependency | Expected value | Target |
| --- | --- | --- | --- | --- |
| Outreach tables (`outreach_messages`, `outreach_personalisation`, `outreach_events`, `suppressions`) | M0 must never send; drafting is optional and test-only | Phase 0 compliance section, attorney review | Compliant send path | M3 |
| `activities`, `deals` | Pipeline outcomes are not part of M0 | Outreach | Attribution of revenue | M4 |
| `overrides` (generic AI-vs-human field overrides) | The only M0 override is the intent gate's, stored on `leads` | Lead review UI beyond M0 | Story 8 | M1 |
| Users and roles tables | M0 actor columns are plain text; admin/operator auth is not in the build list | Auth decision | Access control | M1 |
| `evidence_derivations` (links an `INFERRED` evidence row to the evidence it was reasoned from) | Dropped in Phase 3: no M0 component writes `INFERRED` evidence rows | A layer that writes inferred facts, e.g. AI industry classification | Full inference chains for inferred company facts | M1 |
| Operator UI for manual entry, CSV upload and duplicate resolution | No authentication yet; the CLI covers M0 operation | Auth, lead review UI | Operator workflow without a terminal | Phase 12 / M1 |
| CSV enrichment of an existing company | An exact domain match writes nothing, so a CSV cannot add evidence to a company that already exists | A rule for attributing new REPORTED evidence to an existing identity | Keeping records current from repeat imports | M4 |
| Lead reconciliation on merge | A merge leaves each company's leads where they are, so a cluster can hold two open leads | Lead state machine (Phases 10–11) | One pursuit per business | Phase 10 |
| `is_demo` production insert guard | Needs the deployment environment decided | Deployment | Test-data isolation | Deployment |
