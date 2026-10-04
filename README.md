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

## Phase 5 — fetch layer

`src/fetch/` is the only code permitted to contact prospect infrastructure. An architecture test fails
the build if any other file imports undici, `node:http(s)`, `node:net` or `node:tls`, or calls
`fetch()`.

### Identity

```
User-Agent: CovenantStudiosBot/0.1 (+https://www.covenant-studios.co.za)
robots.txt product token: CovenantStudiosBot
```

It is a constant in `src/fetch/identity.ts`, not a setting, so it cannot be rotated. Every source record
stores the exact User-Agent it was fetched with.

### What a fetch does

1. **Pause switch.** If `fetch_paused` is on, nothing is requested. The switch is checked before every
   attempt, retry and redirect hop, and a missing setting counts as paused.
2. **Cache.** A page fetched `OK` within `fetch_cache_ttl_hours` is served from its stored record with no
   request. After that, the fetch is a conditional request (`If-None-Match` / `If-Modified-Since`). A
   `304` is recorded as `OK` with `revalidated_from_id` pointing at the record that holds the body. A
   `200` whose content hash equals the previous one returns `unchanged: true`. Either way, downstream
   analysis can skip it.
3. **robots.txt for every host in the chain**, including cross-host redirect targets, per RFC 9309:
   - It is stored as its own source record (`purpose = robots`) and reused for up to 24 hours.
   - It is matched on our product token, falling back to `*`; the longest rule wins and ties go to allow.
   - 4xx means allow; 429, 5xx or no response means complete disallow.
   - A disallowed page is recorded as `SOURCE_BLOCKED` with no request made. The database enforces this:
     no HTTP status, no body, and a link to the robots record that blocked it.
   - Nothing retries a disallow.
4. **Politeness.**
   - One request at a time per host.
   - At least `fetch_min_delay_ms` (2s) between the end of one request and the start of the next,
     raised to robots `Crawl-delay` when that is longer.
   - A 429's `Retry-After` holds that host until it expires.
   - A per-host request budget per run (`fetch_host_budget_per_run`), robots.txt included.
5. **Limits.**
   - Connect and read timeouts.
   - A body cap with a hard abort (`fetch_max_body_bytes`): an oversized `Content-Length` is refused
     before download, and a streamed body is cut off at the cap.
   - Only HTML is read; any other content type is recorded and its body never read.
   - Manual redirects with a hop cap and loop detection.
   - Up to 3 retries for transient failures (timeouts, connection errors, 5xx), backing off at 2×, 4×
     and 8× the host's gap. There are no retries for robots disallow, 403, 429 or TLS failures.
6. **One source record per fetch**, whatever happens. It holds the outcome, status, attempts, redirect
   chain, validators, content hash and body.

Outcomes (`fetch_outcome`) are data states:

| Outcome | Meaning |
| --- | --- |
| `OK` | Page retrieved, or revalidated by a 304 |
| `SOURCE_BLOCKED` | robots.txt disallows it; nothing was requested |
| `BLOCKED_BY_SERVER` | 403 or 429 |
| `HTTP_ERROR` | Any other non-2xx, e.g. 404, or 5xx after retries |
| `TIMEOUT` | Connect or read timeout |
| `UNREACHABLE` | Connection refused, DNS failure, reset |
| `TLS_ERROR` | Certificate or TLS failure; verification is never relaxed |
| `TOO_LARGE` | Body over the cap |
| `REDIRECT_LOOP` | Loop or hop cap exceeded |
| `UNSUPPORTED_CONTENT_TYPE` | Not HTML |

The earlier lowercase labels were renamed in place (migration 0004, `RENAME VALUE`), so no stored row
changed.

**Politeness floors are part of the settings schema.** The delay can't go below 2s, retries can't go
above 3, and the robots cache can't exceed 24 hours. Operators can make the crawler slower or stricter,
never faster.

### Forbidden, and not behind any flag

- User-agent rotation or browser user-agent strings
- Proxies or IP rotation
- CAPTCHA handling
- Headless browsers
- Disabling TLS verification
- Any route around robots.txt

An architecture test scans the source (code, not comments) for these and fails the build if one
appears. `FetchRun` accepts a transport (`dispatcher`) for tests and for egress a hosting network
mandates. It can't change the User-Agent or bypass robots.txt, both of which are applied above the
transport. Only the opt-in live test passes one.

### Commands

```sh
npm run fetch -- status
npm run fetch -- pause  --by "Khotso"
npm run fetch -- resume --by "Khotso"
npm run fetch -- url https://example.co.za/ [--company <companyId>]
```

### Company-scoped reads

A merged company keeps its own rows, so reading by one `company_id` silently misses everything its
cluster absorbed. `src/db/company-scope.ts` is the default read path:
- `inCompanyCluster(column, companyId)`
- `getCompanyEvidence`
- `getCompanyFindings`
- `getCompanySignals`

Any member id resolves to the whole cluster. An architecture test fails on a direct
`eq(<table>.companyId, …)` filter outside identity code, and a test asserts that a merged company's
evidence, findings and signals surface through a cluster read.

### Robustness fixes found while testing

- Destroying an undici response body without an error listener raised an uncaught `AbortError`, which
  would have killed the worker on every oversized or non-HTML response. Abandoned bodies are now
  destroyed quietly, and error bodies are drained.
- The Postgres pool had no `error` listener, so a server-side termination of an idle connection (restart,
  failover) would have crashed the process. It is now logged, and the client is replaced.

## Phase 6 — deterministic website audit

`src/audit/` turns a fetched homepage into findings. There is no AI anywhere in this layer, and an
architecture test fails the build if it imports any. It makes no requests of its own: every request
goes through the fetch layer, with robots.txt, the per-host limiter and the request budget applied.
It parses with `cheerio/slim`, which has no network code.

### Triage comes first

A client-rendered site gives a static parser an empty document, and every content and conversion
check would fire on it. Before any check runs, `src/audit/shell.ts` classifies the page:

| Audit status | When | Findings |
| --- | --- | --- |
| `RENDER_REQUIRED` | An empty framework mount point (`#root`, `#app`, `#__next`, `app-root`, …) with little text; a `<noscript>` asking for JavaScript; scripts with almost no text; or text under 1% of the markup with inline script most of it | **None** |
| `NO_CONTENT` | Under 120 characters of visible text and no shell signal (empty page, SVG-only page, meta-refresh page) | **None** |
| `SHARED_PLATFORM` | The web presence is a Facebook/Linktree-style page, not the company's own site; nothing is requested | **None** |
| `SOURCE_BLOCKED` | robots.txt disallows the homepage (the robots record is the proof), or the server answers 403 | **None** |
| `COMPLETED` | The page is auditable | One per enabled check |

The detector's reasons and metrics are stored on the audit (`status_detail`). Doubt resolves toward
silence: a wrongly detected shell costs one missed audit, while a missed shell produces a page of false
findings. Headless rendering is not built and needs separate approval.

### Findings

Each finding records:
- the check key and version
- a status: `PASS`, `FAIL`, `NOT_APPLICABLE` or `INDETERMINATE`, plus `ERROR` if the check itself threw,
  which never stops the other checks
- a severity, on `FAIL` only
- a confidence from the check's own rules
- a detail sentence

Evidence rows are `VERIFIED`, `producer = audit`, with the exact excerpt and its location (a CSS path
such as `body > header > nav > a:nth-of-type(3)`, a text offset, or the request it came from). Each
row cites the source record it was observed in: the page, or the probe request for HTTP, sitemap,
link, PDF and profile checks. Checks are switched on or off in the `audit_checks` table, without a
deploy.

Wording-based checks only judge English pages. On a page declared as another language, or detected as
one, they return `INDETERMINATE`. Language-neutral signals still count: `tel:`, `mailto:` and WhatsApp
links, forms, phone numbers.

### The check set (`audit_checks`, version `m0.1`)

| Check | FAIL severity | Rule | Evidence recorded |
| --- | --- | --- | --- |
| `tech.https` | high | Requests https://<domain>/. FAIL only when HTTPS could not be reached at all while HTTP could. | Outcome of the HTTPS request and, on FAIL, of the HTTP request that succeeded. |
| `tech.certificate_valid` | high | FAIL only for errors browsers also reject (expired, wrong hostname, self-signed). Chain errors are INDETERMINATE. | The TLS error code returned for the HTTPS request. |
| `tech.http_redirects_to_https` | medium | Requests http://<domain>/ and checks where it ends. | The HTTP request's outcome and final URL. |
| `tech.viewport_meta` | medium | PASS when <meta name=viewport> sets width=device-width. | The viewport meta tag, or its absence from <head>. |
| `tech.html_weight` | low | Size of the HTML document alone (not images, scripts or styles, which are not downloaded); FAIL above 1 MB. | HTML byte size and counts of referenced scripts, stylesheets and images. |
| `tech.response_time` | low | Time to response headers, one measurement from the audit server; FAIL above 3 seconds. | Measured milliseconds to response headers. |
| `tech.title` | medium | PASS for a non-empty, non-placeholder <title>. | The <title> text. |
| `tech.meta_description` | low | PASS for a non-empty <meta name=description>. | The meta description text. |
| `tech.canonical` | low | PASS for a canonical link on the same site; FAIL (low) when it points to another site; FAIL (info) when absent. | The canonical link href. |
| `tech.indexable` | high | FAIL when a robots meta tag or X-Robots-Tag header says noindex (or none). | The robots meta tag and X-Robots-Tag header values. |
| `tech.sitemap` | info | Requests the sitemap named in robots.txt, else /sitemap.xml. PASS for 200 with an XML type. | The sitemap request's status and content type. |
| `tech.headings` | low | FAIL (low) with no visible h1; FAIL (info) for several h1s or skipped heading levels. | The h1 text(s) and any skipped level. |
| `tech.broken_internal_links` | medium | Requests up to 5 internal links from the homepage, in document order. FAIL when one returns 404 or 410. | Each sampled link's URL and status. |
| `conv.primary_cta_first_screen` | medium | PASS when an action link/button (quote, book, contact, call, shop, tel:/mailto:/WhatsApp) starts within the first 700 characters of non-navigation text. Markup order, not rendered layout. | The first action element found, its text, CSS path and text offset. |
| `conv.contact_path` | high | PASS for any of: tel:, mailto: or WhatsApp link, enquiry form (incl. embedded), contact page link, or a phone number or email address in the text. | The first contact path found and its location, or the list of signals sought. |
| `conv.click_to_call` | medium | PASS with a tel: link. FAIL only when a phone number appears as plain text outside any link (a number that is itself a link, e.g. to WhatsApp, is tappable). NOT_APPLICABLE when no phone number is published. | The tel: link, or the plain-text phone number. |
| `conv.whatsapp_link` | info | PASS for a wa.me / api.whatsapp.com / whatsapp: link. | The WhatsApp link, or its absence. |
| `conv.enquiry_form` | low | PASS for an on-page enquiry form or a known embedded form provider. INDETERMINATE when only a form-provider script is present. | The form element or embed, and its location. |
| `conv.form_required_fields` | medium | Counts fields marked required (required / aria-required) in the first enquiry form; FAIL above 6. | The required-field count and the form's location. |
| `conv.form_position` | low | Text offset of the first enquiry form; FAIL beyond 2,500 characters. Markup order only, so confidence is moderate. | The form's text offset and location. |
| `conv.trust_signals` | low | PASS for testimonials, reviews, ratings, client logos/'trusted by', accreditations, or review-provider embeds/structured data. | The first trust signal found. |
| `conv.services_named` | low | PASS when the page names what the business offers. FAIL only for a thin page (under 150 words, at most one heading); otherwise INDETERMINATE. | The heading or phrase that names the offer. |
| `conv.pricing_info` | info | PASS for rand amounts, ZAR, 'from R…', per-month/hour prices or a pricing/rates/packages section. | The first price or pricing wording found. |
| `content.business_identity` | low | PASS when the company's name appears in the title, h1, og:site_name, logo alt text or copyright line. FAIL only when none of those elements exist. | The element in which the name was found, or the identifying elements present. |
| `content.location_stated` | low | PASS for an address, a South African place name, a service-area statement, postal-address structured data or a maps link. | The place, address or map link found. |
| `content.copyright_year` | low | FAIL when the latest copyright year is two or more years before retrieval. A lagging year is a weak staleness signal, so confidence is low. | The copyright line and its latest year. |
| `content.latest_dated_content` | low | Uses only machine-readable dates (<time datetime>, published/modified meta, JSON-LD). FAIL when the newest is over 24 months before retrieval. | The newest date found and where. |
| `content.heavy_catalogue` | medium | Requests up to 3 linked PDFs (catalogues first) without downloading them; FAIL when a declared size exceeds 10 MB. | Each PDF's URL, link text and declared Content-Length. |
| `content.social_links` | info | PASS for links to Facebook, Instagram, LinkedIn, X, TikTok or YouTube profiles (share buttons excluded). | The profile URLs found. |
| `content.social_links_resolve` | low | Requests up to 4 linked profiles. FAIL only on 404/410. Platforms that refuse automated access give INDETERMINATE. | Each profile request's outcome. |

`info` severity means "observed absence of an optional feature" (no WhatsApp link, no prices, no
sitemap, no social links), not a defect. These observations only matter when combined with segment
signals later.

No check asserts traffic, search rankings, domain authority, conversion rates or SEO performance. An
architecture test scans every string in `src/audit` for such claims and fails the build if one appears.

### Testing

- **Per-check fixture tests** (`tests/audit/checks.test.ts`): every check, every status it can produce,
  and the evidence it cites.
- **The control set** (`tests/audit/controls.test.ts`): six well-built sites where the correct result is
  silence — a Gqeberha plumber, an industrial PPE supplier, a rugby union, a law firm, a server-rendered
  Next.js shop with a large data blob, and a WordPress studio with an 80-link mega-menu and a cookie
  banner. The bar is stricter than "no high severity": no FAIL at low or above on any control, and
  every info-level observation is listed explicitly.
- **Hostile fixtures** (`tests/audit/triage.test.ts`): empty page, two malformed documents, React,
  Angular and Vue shells, an Afrikaans page, a 3.4 MB page, an SVG-only page and a meta-refresh page.
- **End to end** (`tests/audit/run.test.ts`): fixture sites through the real fetch layer into Postgres,
  covering:
  - persisted evidence
  - every whole-audit status
  - Facebook/Linktree making zero requests
  - a disabled check being skipped
  - a 48 MB catalogue measured without downloading it
  - every request staying on the fixture host

### Decisions worth knowing

- **Page weight is the HTML document only.** True total weight means downloading every image, script
  and stylesheet: dozens of requests per prospect, against the politeness budget. The check measures
  the HTML and records how many resources it references; the name says what it measures.
- **The audit reads the homepage only.** A missing homepage form is `INDETERMINATE` when a contact page
  is linked, because that page was not read.
- **"First screen" is markup order, not rendered layout.** Navigation text does not count, so mega-menus
  don't push the hero out. Confidence is moderate.
- **Certificate errors.** Node rejects incomplete chains that browsers repair, so only expired, wrong
  hostname or self-signed certificates FAIL; other TLS errors are `INDETERMINATE`.
- **Dates come from the retrieval record.** Staleness is judged against when the page was fetched, never
  the wall clock, so re-evaluating a stored page gives the same answer. Only machine-readable dates
  count.

### Command

```sh
npm run audit -- <companyId> [--url <url>]
```

## Phase 7 — evidence and provenance (verification)

Mostly a verification phase. The storage built in Phase 2 held, and so did the writers from Phases 3
and 6, with one exception found by the new invariants (below).

### What was already true

- An evidence row without a source record is refused by the database: `NOT NULL` plus a foreign key.
  Deleting a cited source record is also refused, and evidence cannot be rewritten (Phase 2 trigger).
  The provenance test asserts all three again.
- Exactly two code paths write evidence, each with a fixed claim type: ingest writes `REPORTED`, the
  audit writes `VERIFIED`. Nothing writes `INFERRED`. An architecture test now pins this.

### What was wrong

Audit evidence observed in a probe (sampled links, sitemap, PDFs, profiles) was stamped with the
homepage's retrieval time, a few seconds before the request that observed it. The runner now stamps
each evidence row with the retrieval time of the source record it cites. No stored data needed repair.

### What was added

- **"Where did this come from"**: `npm run provenance -- <evidence|finding|company> <id> [--claim <prefix>]`
  prints the full chain:
  - the claim, its value and excerpt, claim type, confidence, and its location in the document
  - the evidence row
  - the source record: URL or CSV file, retrieval time, outcome, User-Agent, robots record, content hash
  - freshness against its refresh window
  - the findings it supports

  `src/provenance/chain.ts` is the API Phase 12 will render.
- **Freshness at read time** (`src/core/freshness.ts`). It is computed from `observed_at` (or a later
  `last_verified_at`) against the Phase 0 windows: website audit 90 days, contact channel 180, company
  profile 180. It returns fresh or stale and the Phase 0 recency factor (1 inside the window, linearly
  down to 0.4 at twice the window). Nothing about freshness is stored.
- **Signal decay at read time.** Strength decays linearly to zero over the signal type's `decay_days`,
  from `observed_at` (`getCompanySignalsNow`). The unused stored `signals.decays_at` column was dropped
  (migration 0006).
- **Data-quality invariants** (`src/quality/invariants.ts`). Run with `npm run quality` (exit code 1 on
  any violation), or nightly by the worker (pg-boss schedule `data-quality`, 02:13 UTC, results recorded
  in `system_events`).
  - Phase 0: no evidence without a source record; one active company per domain; scores within 0–100;
    confidences within 0–1; qualified leads scored after their latest audit; no fresh mark past its
    window. The only stored freshness mark is a contact channel's `verified` state.
  - Provenance: every cited source record is locatable; each writer's claim types; no `INFERRED` rows
    yet; audit evidence is never observed before its retrieval; finding evidence belongs to the same
    company cluster; every FAIL cites evidence; every completed audit names its page; every company name
    is evidenced.
  - The two outreach invariants report `not_applicable` until M3.
  - Each invariant is proven by a test that corrupts the data and expects it to fire.
- **Standing regression suite.** `npm run test:controls` runs the six-site control set and the severity
  pins (`tests/audit/severity-pins.test.ts`). It runs automatically before `npm run build`, so a new
  control finding at low or above, or any change to a check's severity, fails the build until the pin
  is updated deliberately.

## Running locally

Requires Node 22.12+ and PostgreSQL.

```sh
cp .env.example .env        # set DATABASE_URL
npm install
npm run db:setup            # apply migrations + idempotent configuration seed
npm run dev                 # app on :3000, health at /api/health
npm run worker              # background job worker
npm run typecheck && npm test   # DB tests create and drop a throwaway database via DATABASE_URL
npm run test:controls           # control set + severity pins (also runs before every build)
npm run quality                 # data-quality invariants
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
| Cross-process rate limiting | The per-host limiter is in-process; M0 runs one fetching worker | A second worker process | Politeness held across processes and restarts (advisory lock + next-request time per host) | Before scaling workers |
| Reading the contact page | The audit reads the homepage only; form checks are INDETERMINATE when a contact page is linked | A second page fetch per audit within the host budget | Fewer INDETERMINATE form results | After the benchmark shows how often it matters |
| True total page weight | Needs every asset downloaded: dozens of extra requests per prospect | Approval to spend the politeness budget on assets | A real page-weight figure | Not before M1 |
| Wording checks in Afrikaans and isiXhosa | Vocabulary checks are English-only and abstain elsewhere | Bilingual vocabulary lists checked by a fluent speaker | Fewer INDETERMINATE results on SA sites | After the benchmark |
| `/bot` page on covenant-studios.co.za | The User-Agent should point site owners at an explanation and an opt-out | The Covenant website being updated | Site owners can identify and contact the crawler | Next time the site is touched |
| Rendering JavaScript-only pages | Phase 0 makes headless rendering opt-in per check; no browser in Phase 5 | The audit check set (Phase 6) identifying checks that need it | Audits of JS-only sites | Phase 6 or later, with approval |
| Charset from `<meta charset>` | The body is decoded by the `Content-Type` charset, else UTF-8; reading `<meta>` is parsing | Phase 6 parsing | Correct text on pages that declare their charset only in HTML | Phase 6 |
| `is_demo` production insert guard | Needs the deployment environment decided | Deployment | Test-data isolation | Deployment |
