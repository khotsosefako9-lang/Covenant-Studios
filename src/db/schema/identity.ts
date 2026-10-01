// Company identity. A company is an identity; facts about it live in `evidence`.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./common";
import {
  channelKind,
  channelVerification,
  companyAliasKind,
  companyCreatedVia,
  companyStatus,
  duplicateCandidateStatus,
  duplicateMatchBasis,
} from "./enums";
import { evidence } from "./provenance";

export const companies = pgTable(
  "companies",
  {
    id: id(),
    // Primary identity key: lower-case host, no scheme, no "www.". Null until identified.
    domain: text("domain"),
    // Operator-facing label. Legal/trading names are aliases; other facts are evidence.
    displayName: text("display_name").notNull(),
    normalisedName: text("normalised_name").notNull(),
    status: companyStatus("status").notNull().default("active"),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    createdVia: companyCreatedVia("created_via").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    lastVerifiedAt: tstz("last_verified_at"),
    ...timestamps(),
  },
  (t) => [
    // Two active records may never share a domain. Name collisions are allowed.
    uniqueIndex("companies_active_domain").on(t.domain).where(sql`${t.status} = 'active' and ${t.domain} is not null`),
    index("companies_normalised_name").on(t.normalisedName),
    check(
      "companies_domain_normalised",
      sql`${t.domain} is null or (${t.domain} = lower(${t.domain}) and ${t.domain} !~ '^www\\.' and ${t.domain} !~ '[/:@\\s]' and ${t.domain} ~ '\\.')`,
    ),
    check(
      "companies_merge_consistent",
      sql`(${t.status} = 'merged') = (${t.mergedIntoId} is not null) and ${t.mergedIntoId} is distinct from ${t.id}`,
    ),
  ],
);

export const companyAliases = pgTable(
  "company_aliases",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: companyAliasKind("kind").notNull(),
    value: text("value").notNull(),
    normalisedValue: text("normalised_value").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("company_aliases_unique").on(t.companyId, t.kind, t.normalisedValue),
    index("company_aliases_normalised").on(t.normalisedValue),
  ],
);

// Possible duplicates, proposed by dedupe and resolved only by a human.
export const companyDuplicateCandidates = pgTable(
  "company_duplicate_candidates",
  {
    id: id(),
    companyAId: uuid("company_a_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    companyBId: uuid("company_b_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    matchBasis: duplicateMatchBasis("match_basis").notNull(),
    matchedValue: text("matched_value").notNull(),
    similarity: numeric("similarity", { precision: 4, scale: 3 }),
    status: duplicateCandidateStatus("status").notNull().default("proposed"),
    resolvedBy: text("resolved_by"),
    resolvedAt: tstz("resolved_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("company_duplicate_candidates_pair").on(t.companyAId, t.companyBId, t.matchBasis),
    index("company_duplicate_candidates_b").on(t.companyBId),
    check("company_duplicate_candidates_ordered", sql`${t.companyAId} < ${t.companyBId}`),
    check("company_duplicate_candidates_similarity", sql`${t.similarity} is null or ${t.similarity} between 0 and 1`),
    check(
      "company_duplicate_candidates_resolution",
      sql`(${t.status} = 'proposed') = (${t.resolvedBy} is null and ${t.resolvedAt} is null)`,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fullName: text("full_name"),
    role: text("role"),
    isDecisionMaker: boolean("is_decision_maker"),
    // Contact facts are evidence-backed like everything else.
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    lastVerifiedAt: tstz("last_verified_at"),
    ...timestamps(),
  },
  (t) => [index("contacts_company").on(t.companyId)],
);

// Company-level or person-level channel. Used for contactability and phone/email dedupe.
export const contactChannels = pgTable(
  "contact_channels",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    kind: channelKind("kind").notNull(),
    value: text("value").notNull(),
    normalisedValue: text("normalised_value").notNull(),
    verification: channelVerification("verification").notNull().default("unverified"),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    lastVerifiedAt: tstz("last_verified_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("contact_channels_unique").on(t.companyId, t.kind, t.normalisedValue),
    index("contact_channels_lookup").on(t.kind, t.normalisedValue),
  ],
);
