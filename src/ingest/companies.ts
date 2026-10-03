// Company ingestion: manual entry and CSV import. Writes identity, a source record,
// REPORTED evidence for every supplied field, and proposed duplicate candidates.
// Never fetches, audits, calls AI or merges companies.
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { parseCsv } from "@/core/csv";
import { type DuplicateCandidate, type IdentityProfile, findDuplicateCandidates } from "@/core/identity/duplicates";
import { normaliseCompanyName } from "@/core/identity/name";
import {
  type CompanyField,
  type CompanyInput,
  type Issue,
  type ValidCompany,
  mapCsvHeader,
  rowToInput,
  validateCompanyInput,
} from "@/core/ingest/validate";
import * as s from "@/db/schema/index";
import { parseSetting } from "@/db/validation";

type Db = NodePgDatabase<typeof s>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

export type RowStatus = "imported" | "matched_existing" | "invalid" | "failed";

export interface RowResult {
  rowNumber: number;
  status: RowStatus;
  companyId: string | null;
  issues: Issue[];
}

export interface ImportReport {
  sourceRecordId: string;
  traceId: string;
  ignoredColumns: string[];
  rows: RowResult[];
  candidates: DuplicateCandidate[];
  counts: Record<RowStatus, number>;
}

export type CsvImportResult = { ok: true; report: ImportReport } | { ok: false; code: string; message: string };

export type ManualEntryResult =
  | { ok: true; status: "imported"; companyId: string; sourceRecordId: string; warnings: Issue[]; candidates: DuplicateCandidate[] }
  | { ok: false; status: "matched_existing"; companyId: string; message: string }
  | { ok: false; status: "invalid"; errors: Issue[]; warnings: Issue[] };

interface Context {
  profiles: IdentityProfile[];
  byDomain: Map<string, string>;
  nameThreshold: number;
}

async function loadContext(tx: Tx): Promise<Context> {
  const [setting] = await tx
    .select({ value: s.settings.value })
    .from(s.settings)
    .where(eq(s.settings.key, "dedupe_name_similarity_threshold"));
  if (!setting) throw new Error("Setting dedupe_name_similarity_threshold is missing; run npm run db:setup");
  const nameThreshold = parseSetting("dedupe_name_similarity_threshold", setting.value);

  const companies = await tx
    .select({ id: s.companies.id, domain: s.companies.domain, normalisedName: s.companies.normalisedName })
    .from(s.companies)
    .where(eq(s.companies.status, "active"));
  const channels = companies.length
    ? await tx
        .select({ companyId: s.contactChannels.companyId, kind: s.contactChannels.kind, value: s.contactChannels.normalisedValue })
        .from(s.contactChannels)
        .where(inArray(s.contactChannels.kind, ["phone", "email"]))
    : [];
  const profiles = new Map<string, IdentityProfile>(
    companies.map((c) => [c.id, { id: c.id, domain: c.domain, normalisedName: c.normalisedName, phones: [], emails: [] }]),
  );
  for (const ch of channels) {
    const p = profiles.get(ch.companyId);
    if (p) (ch.kind === "phone" ? p.phones : p.emails).push(ch.value);
  }
  const byDomain = new Map<string, string>();
  for (const c of companies) if (c.domain) byDomain.set(c.domain, c.id);
  return { profiles: [...profiles.values()], byDomain, nameThreshold };
}

type Locate = (field: CompanyField) => string;

/** Creates the company, its aliases, evidence and channels, and proposes duplicates. */
async function createCompany(
  tx: Tx,
  company: ValidCompany,
  createdVia: "manual" | "csv",
  sourceRecordId: string,
  locate: Locate,
  ctx: Context,
): Promise<{ companyId: string; candidates: DuplicateCandidate[] }> {
  const observedAt = new Date();
  const [row] = await tx
    .insert(s.companies)
    .values({
      domain: company.domain,
      displayName: company.displayName,
      normalisedName: company.normalisedName,
      createdVia,
      lastVerifiedAt: null,
    })
    .returning({ id: s.companies.id });
  if (!row) throw new Error("company insert returned no row");
  const companyId = row.id;

  const evidenceFor = async (field: CompanyField, claimKey: string, claim: string, value: string, excerpt?: string) => {
    const [e] = await tx
      .insert(s.evidence)
      .values({
        companyId,
        sourceRecordId,
        producer: "ingest",
        claimKey,
        claim,
        claimType: "REPORTED",
        value,
        excerpt: excerpt ?? value,
        locator: locate(field),
        observedAt,
      })
      .returning({ id: s.evidence.id });
    if (!e) throw new Error("evidence insert returned no row");
    return e.id;
  };

  await evidenceFor("name", "company.name", "Company name as reported", company.displayName);
  if (company.domain) {
    await evidenceFor("website", "company.domain", "Company website domain as reported", company.domain, company.website ?? undefined);
  }
  if (company.webPresenceUrl) {
    await evidenceFor("website", "company.web_presence_url", "Web presence on a shared platform as reported", company.webPresenceUrl);
  }
  if (company.industry) await evidenceFor("industry", "company.industry", "Industry as reported", company.industry);
  if (company.location) await evidenceFor("location", "company.location", "Location as reported", company.location);

  for (const [kind, field, value] of [
    ["legal_name", "legal_name", company.legalName],
    ["trading_name", "trading_name", company.tradingName],
  ] as const) {
    if (!value) continue;
    await evidenceFor(field, `company.${kind}`, `${kind === "legal_name" ? "Legal" : "Trading"} name as reported`, value);
    await tx
      .insert(s.companyAliases)
      .values({ companyId, kind, value, normalisedValue: normaliseCompanyName(value) })
      .onConflictDoNothing();
  }

  const profile: IdentityProfile = { id: companyId, domain: company.domain, normalisedName: company.normalisedName, phones: [], emails: [] };
  if (company.phone) {
    const evidenceId = await evidenceFor("phone", "company.phone", "Company phone number as reported", company.phone.raw);
    await tx.insert(s.contactChannels).values({
      companyId,
      kind: "phone",
      value: company.phone.raw,
      normalisedValue: company.phone.normalised,
      evidenceId,
    });
    profile.phones.push(company.phone.normalised);
  }
  if (company.email) {
    const evidenceId = await evidenceFor("email", "company.email", "Company email address as reported", company.email.raw);
    await tx.insert(s.contactChannels).values({
      companyId,
      kind: "email",
      value: company.email.raw,
      normalisedValue: company.email.normalised,
      evidenceId,
    });
    profile.emails.push(company.email.normalised);
  }

  const candidates = findDuplicateCandidates(profile, ctx.profiles, ctx.nameThreshold);
  if (candidates.length) {
    await tx
      .insert(s.companyDuplicateCandidates)
      .values(
        candidates.map((c) => ({
          companyAId: c.companyAId,
          companyBId: c.companyBId,
          matchBasis: c.matchBasis,
          matchedValue: c.matchedValue,
          similarity: c.similarity === null ? null : String(c.similarity),
        })),
      )
      .onConflictDoNothing();
  }

  ctx.profiles.push(profile);
  if (company.domain) ctx.byDomain.set(company.domain, companyId);
  return { companyId, candidates };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function sourceId(tx: Tx, key: string): Promise<string> {
  const [row] = await tx.select({ id: s.sources.id }).from(s.sources).where(eq(s.sources.key, key));
  if (!row) throw new Error(`Source ${key} is missing; run npm run db:setup`);
  return row.id;
}

// Drizzle wraps driver errors as "Failed query: <sql> params: <values>"; report the
// underlying database message instead, which is what an operator can act on.
function errorMessage(e: unknown): string {
  let err = e;
  while (err instanceof Error && err.cause instanceof Error) err = err.cause;
  return err instanceof Error ? err.message : String(e);
}

/**
 * Imports a CSV file. File-level problems (unparseable, too large, no name column,
 * already imported) reject the whole file before anything is written. Otherwise every
 * data row is recorded in csv_import_rows: imported, matched to an existing domain,
 * invalid (with reasons) or failed (unexpected error). One bad row never stops the rest.
 */
export async function importCsv(db: Db, args: { content: string; fileName: string; actor: string }): Promise<CsvImportResult> {
  const actor = args.actor.trim();
  if (actor === "") return { ok: false, code: "actor_missing", message: "An operator name is required" };
  if (Buffer.byteLength(args.content, "utf8") > MAX_CSV_BYTES) {
    return { ok: false, code: "file_too_large", message: `File is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB` };
  }
  const parsed = parseCsv(args.content);
  if (!parsed.ok) return { ok: false, code: "csv_unparseable", message: `Line ${parsed.line}: ${parsed.message}` };
  const [header, ...dataRows] = parsed.records;
  if (!header) return { ok: false, code: "csv_empty", message: "The file is empty" };
  if (dataRows.length === 0) return { ok: false, code: "csv_no_rows", message: "The file has a header but no rows" };
  if (dataRows.length > MAX_CSV_ROWS) {
    return { ok: false, code: "too_many_rows", message: `The file has ${dataRows.length} rows; the limit is ${MAX_CSV_ROWS}` };
  }
  const mapping = mapCsvHeader(header.values);
  if (!mapping.ok) return { ok: false, code: "csv_header", message: mapping.message };

  const contentHash = sha256(args.content);
  const traceId = randomUUID();

  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ id: s.sourceRecords.id, fetchedAt: s.sourceRecords.fetchedAt })
      .from(s.sourceRecords)
      .where(and(eq(s.sourceRecords.retrievalMethod, "csv_import"), eq(s.sourceRecords.contentHash, contentHash)));
    if (previous) {
      return {
        ok: false as const,
        code: "already_imported",
        message: `This exact file was already imported at ${previous.fetchedAt.toISOString()} (source record ${previous.id})`,
      };
    }

    const [record] = await tx
      .insert(s.sourceRecords)
      .values({
        sourceId: await sourceId(tx, "csv_import"),
        retrievalMethod: "csv_import",
        fetchedAt: new Date(),
        fetchOutcome: "not_applicable",
        contentType: "text/csv",
        contentHash,
        byteSize: Buffer.byteLength(args.content, "utf8"),
        rawContent: args.content,
        fileName: args.fileName,
        attributedTo: actor,
        traceId,
      })
      .returning({ id: s.sourceRecords.id });
    if (!record) throw new Error("source record insert returned no row");

    const ctx = await loadContext(tx);
    const rows: RowResult[] = [];
    const candidates: DuplicateCandidate[] = [];
    const width = header.values.length;

    for (const rec of dataRows) {
      let result: RowResult;
      try {
        result = await tx.transaction(async (sp) => {
          if (rec.values.length !== width) {
            return {
              rowNumber: rec.line,
              status: "invalid" as const,
              companyId: null,
              issues: [{ code: "column_count", message: `Row has ${rec.values.length} values; the header has ${width}` }],
            };
          }
          const v = validateCompanyInput(rowToInput(mapping.columns, rec.values));
          if (!v.ok) return { rowNumber: rec.line, status: "invalid" as const, companyId: null, issues: [...v.errors, ...v.warnings] };
          const existing = v.company.domain ? ctx.byDomain.get(v.company.domain) : undefined;
          if (existing) {
            return {
              rowNumber: rec.line,
              status: "matched_existing" as const,
              companyId: existing,
              issues: [
                { code: "domain_exists", field: "website" as const, message: `${v.company.domain} already belongs to an existing company; nothing was created` },
                ...v.warnings,
              ],
            };
          }
          const colOf = (field: CompanyField) => header.values[mapping.columns.indexOf(field)] ?? field;
          const created = await createCompany(sp, v.company, "csv", record.id, (f) => `row ${rec.line}, column "${colOf(f)}"`, ctx);
          candidates.push(...created.candidates);
          return { rowNumber: rec.line, status: "imported" as const, companyId: created.companyId, issues: v.warnings };
        });
      } catch (e) {
        result = { rowNumber: rec.line, status: "failed", companyId: null, issues: [{ code: "unexpected_error", message: errorMessage(e) }] };
      }
      rows.push(result);
      await tx.insert(s.csvImportRows).values({
        sourceRecordId: record.id,
        rowNumber: result.rowNumber,
        rawValues: rec.values,
        status: result.status,
        companyId: result.companyId,
        issueCodes: result.issues.map((i) => i.code),
        issueDetail: result.issues.length ? result.issues.map((i) => i.message).join("; ") : null,
      });
    }

    const counts = { imported: 0, matched_existing: 0, invalid: 0, failed: 0 };
    for (const r of rows) counts[r.status]++;
    return {
      ok: true as const,
      report: { sourceRecordId: record.id, traceId, ignoredColumns: mapping.ignored, rows, candidates, counts },
    };
  });
}

/**
 * Adds one company entered by an operator. Invalid input and an already-known domain
 * are reported back without writing anything.
 */
export async function addCompanyManually(db: Db, args: { input: CompanyInput; actor: string }): Promise<ManualEntryResult> {
  const actor = args.actor.trim();
  const v = validateCompanyInput(args.input);
  if (actor === "") {
    return { ok: false, status: "invalid", errors: [{ code: "actor_missing", message: "An operator name is required" }], warnings: [] };
  }
  if (!v.ok) return { ok: false, status: "invalid", errors: v.errors, warnings: v.warnings };
  const company = v.company;

  return db.transaction(async (tx) => {
    const ctx = await loadContext(tx);
    const existing = company.domain ? ctx.byDomain.get(company.domain) : undefined;
    if (existing) {
      return {
        ok: false as const,
        status: "matched_existing" as const,
        companyId: existing,
        message: `${company.domain} already belongs to an existing company`,
      };
    }
    const payload = JSON.stringify(args.input);
    const [record] = await tx
      .insert(s.sourceRecords)
      .values({
        sourceId: await sourceId(tx, "manual_entry"),
        retrievalMethod: "manual_entry",
        fetchedAt: new Date(),
        fetchOutcome: "not_applicable",
        contentType: "application/json",
        contentHash: sha256(payload),
        byteSize: Buffer.byteLength(payload, "utf8"),
        rawContent: payload,
        attributedTo: actor,
        traceId: randomUUID(),
      })
      .returning({ id: s.sourceRecords.id });
    if (!record) throw new Error("source record insert returned no row");
    const created = await createCompany(tx, company, "manual", record.id, (f) => `field "${f}"`, ctx);
    return {
      ok: true as const,
      status: "imported" as const,
      companyId: created.companyId,
      sourceRecordId: record.id,
      warnings: v.warnings,
      candidates: created.candidates,
    };
  });
}
