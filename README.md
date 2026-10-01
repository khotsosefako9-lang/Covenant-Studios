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
| Migrations | drizzle-kit, output to `drizzle/`; no schema yet (Phase 2) |
| Jobs | pg-boss worker process (`src/worker`), same database, no handlers yet |
| Validation | Zod; environment validated at startup (`src/lib/env.ts`) |
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

## Running locally

Requires Node 22.12+ and PostgreSQL.

```sh
cp .env.example .env        # set DATABASE_URL
npm install
npm run dev                 # app on :3000, health at /api/health
npm run worker              # background job worker
npm run typecheck && npm test
```

## Deferred

Items that belong to a later milestone are recorded here with their reason, dependency, expected value
and target phase, and are not built in M0.

| Item | Reason | Dependency | Expected value | Target |
| --- | --- | --- | --- | --- |
| _none yet_ | | | | |
