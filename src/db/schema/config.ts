// Commercial configuration. Data, not code: Covenant changes a price or a weight by
// editing a row. Seeded from the Phase 0 document (src/db/seed-data.ts).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { billingPeriod, opportunityTypeOrigin, revenueModel, scoreAxis, serviceUnit, signalKind } from "./enums";

export const covenantServices = pgTable(
  "covenant_services",
  {
    id: id(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    // Null until the capabilities guide is read directly; never guessed.
    category: text("category"),
    unit: serviceUnit("unit").notNull(),
    revenueModel: revenueModel("revenue_model").notNull(),
    billingPeriod: billingPeriod("billing_period").notNull(),
    // Whole rand. "From 5,500" = low 5500, high null. Unpublished = both null.
    priceLowZar: integer("price_low_zar"),
    priceHighZar: integer("price_high_zar"),
    published: boolean("published").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check("covenant_services_published_has_price", sql`not ${t.published} or ${t.priceLowZar} is not null`),
    check(
      "covenant_services_unpublished_no_price",
      sql`${t.published} or (${t.priceLowZar} is null and ${t.priceHighZar} is null)`,
    ),
    check(
      "covenant_services_price_range",
      sql`${t.priceHighZar} is null or (${t.priceLowZar} is not null and ${t.priceHighZar} >= ${t.priceLowZar})`,
    ),
    check("covenant_services_price_positive", sql`${t.priceLowZar} is null or ${t.priceLowZar} > 0`),
  ],
);

export const opportunityTypes = pgTable("opportunity_types", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  origin: opportunityTypeOrigin("origin").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

// opportunity_type → covenant_service. Many-to-many: rfq_system maps to two services.
export const opportunityTypeServices = pgTable(
  "opportunity_type_services",
  {
    opportunityTypeId: uuid("opportunity_type_id")
      .notNull()
      .references(() => opportunityTypes.id, { onDelete: "cascade" }),
    covenantServiceId: uuid("covenant_service_id")
      .notNull()
      .references(() => covenantServices.id, { onDelete: "restrict" }),
    // 1 = first choice where a type maps to alternatives ("X or Y").
    preference: smallint("preference").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.opportunityTypeId, t.covenantServiceId] }),
    check("opportunity_type_services_preference", sql`${t.preference} >= 1`),
  ],
);

// finding → opportunity_type. Keyed by audit check key; the check set lands in Phase 6.
export const findingOpportunityMappings = pgTable(
  "finding_opportunity_mappings",
  {
    id: id(),
    checkKey: text("check_key").notNull(),
    opportunityTypeId: uuid("opportunity_type_id")
      .notNull()
      .references(() => opportunityTypes.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("finding_opportunity_mappings_unique").on(t.checkKey, t.opportunityTypeId)],
);

// The five documented triggers plus the friction signals from the benchmark reasoning.
export const signalTypes = pgTable(
  "signal_types",
  {
    id: id(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    kind: signalKind("kind").notNull(),
    // Null = not yet classified by the source documents.
    axis: scoreAxis("axis"),
    // web_underperformance: counts toward intent only with an independent commercial signal.
    intentRequiresIndependentSignal: boolean("intent_requires_independent_signal").notNull().default(false),
    // procurement_scorecard: may only be raised by a human operator. Enforced by trigger.
    humanOnly: boolean("human_only").notNull().default(false),
    // Linear decay to zero over this many days. Null = not documented.
    decayDays: integer("decay_days"),
    detectableFrom: text("detectable_from"),
    group: text("group"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [check("signal_types_decay_positive", sql`${t.decayDays} is null or ${t.decayDays} > 0`)],
);

// signal_type → opportunity_type. Completes finding → signal → opportunity type → service.
export const signalTypeOpportunityTypes = pgTable(
  "signal_type_opportunity_types",
  {
    signalTypeId: uuid("signal_type_id")
      .notNull()
      .references(() => signalTypes.id, { onDelete: "cascade" }),
    opportunityTypeId: uuid("opportunity_type_id")
      .notNull()
      .references(() => opportunityTypes.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.signalTypeId, t.opportunityTypeId] })],
);

export const icpSegments = pgTable("icp_segments", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  definition: text("definition").notNull(),
  // Structured criteria (industry, area, size band, exclusions); shape validated by Zod.
  criteria: jsonb("criteria"),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

export const icpSegmentServices = pgTable(
  "icp_segment_services",
  {
    icpSegmentId: uuid("icp_segment_id")
      .notNull()
      .references(() => icpSegments.id, { onDelete: "cascade" }),
    covenantServiceId: uuid("covenant_service_id")
      .notNull()
      .references(() => covenantServices.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.icpSegmentId, t.covenantServiceId] })],
);

export const disqualifiers = pgTable("disqualifiers", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  evidenceRequirement: text("evidence_requirement"),
  // Capitalisation and ethical alignment are largely undetectable from a website:
  // surfaced as verification prompts, not scored.
  detectableFromWebsite: boolean("detectable_from_website").notNull(),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

const weight = (name: string) => numeric(name, { precision: 5, scale: 4 }).notNull();

// Versioned scoring configuration. One column per dimension so the sum-to-1 rule is a
// plain CHECK. Weights are frozen once any score references the set (trigger).
export const weightSets = pgTable(
  "weight_sets",
  {
    id: id(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    notes: text("notes"),
    createdBy: text("created_by"),
    buyingSignal: weight("w_buying_signal"),
    icpFit: weight("w_icp_fit"),
    digitalOpportunity: weight("w_digital_opportunity"),
    serviceFit: weight("w_service_fit"),
    commercialPotential: weight("w_commercial_potential"),
    contactability: weight("w_contactability"),
    evidenceQuality: weight("w_evidence_quality"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("weight_sets_name_version").on(t.name, t.version),
    uniqueIndex("weight_sets_single_active").on(t.isActive).where(sql`${t.isActive}`),
    check(
      "weight_sets_range",
      sql`least(${t.buyingSignal}, ${t.icpFit}, ${t.digitalOpportunity}, ${t.serviceFit}, ${t.commercialPotential}, ${t.contactability}, ${t.evidenceQuality}) >= 0
        and greatest(${t.buyingSignal}, ${t.icpFit}, ${t.digitalOpportunity}, ${t.serviceFit}, ${t.commercialPotential}, ${t.contactability}, ${t.evidenceQuality}) <= 1`,
    ),
    check(
      "weight_sets_sum_to_one",
      sql`abs(${t.buyingSignal} + ${t.icpFit} + ${t.digitalOpportunity} + ${t.serviceFit} + ${t.commercialPotential} + ${t.contactability} + ${t.evidenceQuality} - 1) < 0.0001`,
    ),
  ],
);

// Thresholds, caps and capacity. Value shape per key is validated by Zod
// (src/db/settings.ts); null value = NOT_CONFIGURED, never a guessed default.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  description: text("description").notNull(),
  updatedBy: text("updated_by"),
  ...timestamps(),
});
