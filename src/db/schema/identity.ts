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
  duplicateResolutionAction,
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
    // Set when the alias was carried over by a merge; an unmerge removes exactly these.
    mergeId: uuid("merge_id").references((): AnyPgColumn => companyMerges.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    // Exact values are unique, so names that differ only in legal form are both kept.
    uniqueIndex("company_aliases_unique").on(t.companyId, t.kind, t.value),
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

// A confirmed merge. Nothing moves: the loser keeps every row it owns and points at the
// winner through companies.merged_into_id, so an unmerge only has to flip it back.
export const companyMerges = pgTable(
  "company_merges",
  {
    id: id(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => companyDuplicateCandidates.id, { onDelete: "restrict" }),
    winnerId: uuid("winner_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    loserId: uuid("loser_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    mergedBy: text("merged_by").notNull(),
    reason: text("reason").notNull(),
    mergedAt: tstz("merged_at").notNull().defaultNow(),
    unmergedBy: text("unmerged_by"),
    unmergeReason: text("unmerge_reason"),
    unmergedAt: tstz("unmerged_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("company_merges_one_active_per_loser").on(t.loserId).where(sql`${t.unmergedAt} is null`),
    index("company_merges_winner").on(t.winnerId),
    check("company_merges_distinct", sql`${t.winnerId} <> ${t.loserId}`),
    check(
      "company_merges_unmerge_complete",
      sql`(${t.unmergedAt} is null) = (${t.unmergedBy} is null) and (${t.unmergedAt} is null) = (${t.unmergeReason} is null)`,
    ),
    check("company_merges_reason", sql`length(trim(${t.reason})) > 0`),
  ],
);

// A permanent human decision that two companies are not the same business.
// No duplicate candidate may be proposed for this pair again (enforced by trigger).
export const companyNonMatches = pgTable(
  "company_non_matches",
  {
    id: id(),
    companyAId: uuid("company_a_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    companyBId: uuid("company_b_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").references(() => companyDuplicateCandidates.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").notNull(),
    reason: text("reason").notNull(),
    decidedAt: tstz("decided_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("company_non_matches_pair").on(t.companyAId, t.companyBId),
    check("company_non_matches_ordered", sql`${t.companyAId} < ${t.companyBId}`),
    check("company_non_matches_reason", sql`length(trim(${t.reason})) > 0`),
  ],
);

// Append-only history of every decision on a duplicate candidate.
export const duplicateResolutions = pgTable(
  "duplicate_resolutions",
  {
    id: id(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => companyDuplicateCandidates.id, { onDelete: "cascade" }),
    action: duplicateResolutionAction("action").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    actedAt: tstz("acted_at").notNull().defaultNow(),
    mergeId: uuid("merge_id").references(() => companyMerges.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("duplicate_resolutions_candidate").on(t.candidateId, t.actedAt),
    check("duplicate_resolutions_reason", sql`length(trim(${t.reason})) > 0 and length(trim(${t.actor})) > 0`),
    check(
      "duplicate_resolutions_merge_link",
      sql`(${t.action} in ('confirm', 'unmerge')) = (${t.mergeId} is not null)`,
    ),
  ],
);
