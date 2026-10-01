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
| Identity | `companies`, `company_aliases`, `company_duplicate_candidates`, `contacts`, `contact_channels` |
| Observed facts | `sources`, `source_records` (one retrieval each: page, robots.txt, CSV, operator statement) |
| Evidence | `evidence`, `evidence_derivations`, view `evidence_provenance` |
| Deterministic audit | `audits`, `audit_findings`, `audit_finding_evidence`, `finding_verifications` |
| Commercial signals | `signals`, `signal_evidence`, `signal_findings` |
| Opportunity interpretation | `opportunities`, `opportunity_findings`, `opportunity_signals` |
| Pursuit and intent gate | `leads`, `lead_disqualifications` |
| Scoring | `scores`, `score_dimensions`, `score_dimension_evidence` |
| Human judgement | `judgements`, `judgement_evidence` |
| Benchmark (evaluation only) | `benchmark_categories`, `benchmark_cases` |
| AI brief and cost | `ai_models`, `ai_runs`, `ai_run_packet_evidence`, `opportunity_briefs`, `brief_claims`, `brief_claim_evidence` |
| Configuration | `covenant_services`, `opportunity_types`, `opportunity_type_services`, `finding_opportunity_mappings`, `signal_types`, `signal_type_opportunity_types`, `icp_segments`, `icp_segment_services`, `disqualifiers`, `weight_sets`, `settings` |
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
  judges before seeing system output. Reason `other` requires notes.
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
- `is_demo` is on `companies` only. The production insert guard belongs with deployment and is not built.

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
| `is_demo` production insert guard | Needs the deployment environment decided | Deployment | Test-data isolation | Deployment |
