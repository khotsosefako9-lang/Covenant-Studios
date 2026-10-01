// Evaluation layer only. Nothing in the pipeline reads these tables: category verdicts
// are expected labels for measurement, never rules.
import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./common";
import { benchmarkOutcome, judgementContext, leadState, verdict } from "./enums";
import { companies } from "./identity";
import { judgements, leads, scores } from "./leads";

// The sampling frame: business categories, not companies.
export const benchmarkCategories = pgTable(
  "benchmark_categories",
  {
    id: id(),
    datasetVersion: text("dataset_version").notNull(),
    number: smallint("number").notNull(),
    name: text("name").notNull(),
    expectedVerdict: verdict("expected_verdict").notNull(),
    // e.g. "for cold outreach" on category 15.
    verdictQualifier: text("verdict_qualifier"),
    commercialDriver: text("commercial_driver").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("benchmark_categories_version_number").on(t.datasetVersion, t.number)],
);

// One real, auditable company chosen to represent a category, with the selection recorded.
export const benchmarkCases = pgTable(
  "benchmark_cases",
  {
    id: id(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => benchmarkCategories.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "restrict" }),
    selectionCriteria: text("selection_criteria").notNull(),
    typicalityRationale: text("typicality_rationale").notNull(),
    alternativesConsidered: text("alternatives_considered").notNull(),
    atypicalNotes: text("atypical_notes"),
    selectedBy: text("selected_by").notNull(),
    selectedAt: tstz("selected_at").notNull().defaultNow(),
    // Blind human verdict (must be a benchmark_blind judgement).
    humanJudgementId: uuid("human_judgement_id"),
    humanJudgementContext: judgementContext("human_judgement_context"),
    // System assessment snapshot at comparison time.
    systemScoreId: uuid("system_score_id").references(() => scores.id, { onDelete: "restrict" }),
    systemLeadState: leadState("system_lead_state"),
    outcome: benchmarkOutcome("outcome"),
    diagnosis: text("diagnosis"),
    comparedAt: tstz("compared_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("benchmark_cases_category").on(t.categoryId),
    uniqueIndex("benchmark_cases_company").on(t.companyId),
    foreignKey({
      columns: [t.humanJudgementId, t.humanJudgementContext],
      foreignColumns: [judgements.id, judgements.context],
    }).onDelete("restrict"),
    check(
      "benchmark_cases_judgement_is_blind",
      sql`(${t.humanJudgementId} is null) = (${t.humanJudgementContext} is null)
        and ${t.humanJudgementContext} is distinct from 'review'`,
    ),
    check(
      "benchmark_cases_comparison_complete",
      sql`${t.outcome} is null or (${t.humanJudgementId} is not null and ${t.systemScoreId} is not null and ${t.systemLeadState} is not null and ${t.comparedAt} is not null)`,
    ),
    check(
      "benchmark_cases_disagreement_diagnosed",
      sql`${t.outcome} is null or ${t.outcome} = 'agreement' or ${t.diagnosis} is not null`,
    ),
  ],
);
