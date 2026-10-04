// Commercial configuration seed. Values marked "documented" are transcribed from the
// Phase 0 document (which takes them from the Capabilities & Strategic Growth Guide) or
// from Covenant's Phase 3 authorization. Values marked "default" are operator-adjustable
// defaults agreed in the Phase 3 authorization, not facts about Covenant. Anything neither
// source states stays null (NOT_CONFIGURED / UNKNOWN).
import type { SettingKey } from "./validation";

type Origin = "documented" | "default";

// Service groups, supplied with the Phase 3 authorization (Capabilities Guide groupings).
export const serviceCategories: { key: string; name: string; services: string[] }[] = [
  {
    key: "web_design_engineering",
    name: "Web Design & Engineering",
    services: [
      "campaign_conversion_page",
      "custom_business_website",
      "full_revenue_business_site",
      "sports_platform_build",
      "web_technical_delegation",
    ],
  },
  {
    key: "branding_creative_direction",
    name: "Branding & Creative Direction",
    services: ["bespoke_logo_mark", "full_brand_identity_system", "collateral_print_asset_add_on"],
  },
  {
    key: "content_media_production",
    name: "Content & Media Production",
    services: ["high_reach_reels_short_video", "core_content_pack", "growth_content_system", "matchday_sla_retainer"],
  },
  {
    key: "b2b_revenue_pipeline_strategy",
    name: "B2B Revenue & Pipeline Strategy",
    services: ["onsite_revenue_leak_audit", "key_account_outreach_architecture", "enterprise_growth_retainer"],
  },
  { key: "combined", name: "Combined", services: ["complete_business_launchpad"] },
];

// Judgement reason codes: the controlled list of 13 (Phase 0, supplied with the Phase 4
// authorization). Earlier codes not in this list are retired (active = false), never
// deleted, because existing judgements reference them.
export const judgementReasons: { key: string; label: string; sortOrder: number }[] = [
  { key: "strong_commercial_opportunity", label: "Strong commercial opportunity", sortOrder: 1 },
  { key: "strong_service_fit", label: "Strong service fit", sortOrder: 2 },
  { key: "strong_digital_opportunity", label: "Strong digital opportunity", sortOrder: 3 },
  { key: "strong_buying_signal", label: "Strong buying signal", sortOrder: 4 },
  { key: "too_small", label: "Too small", sortOrder: 5 },
  { key: "insufficient_budget_evidence", label: "Insufficient budget evidence", sortOrder: 6 },
  { key: "weak_intent", label: "Weak intent", sortOrder: 7 },
  { key: "wrong_industry", label: "Wrong industry", sortOrder: 8 },
  { key: "poor_service_fit", label: "Poor service fit", sortOrder: 9 },
  { key: "already_well_served", label: "Already well served", sortOrder: 10 },
  { key: "no_urgency", label: "No urgency", sortOrder: 11 },
  { key: "insufficient_evidence", label: "Insufficient evidence", sortOrder: 12 },
  { key: "other", label: "Other", sortOrder: 99 },
];

type Unit = "project" | "add_on" | "per_piece" | "retainer" | "bundle";

interface ServiceSeed {
  key: string;
  name: string;
  unit: Unit;
  low: number | null;
  high: number | null;
}

// Phase 0, "Services and price bands". "From X" = low X, no high.
export const services: ServiceSeed[] = [
  { key: "campaign_conversion_page", name: "Campaign Conversion Page", unit: "project", low: 3500, high: null },
  { key: "custom_business_website", name: "Custom Business Website", unit: "project", low: 5500, high: null },
  { key: "full_revenue_business_site", name: "Full Revenue Business Site", unit: "project", low: 10000, high: null },
  { key: "sports_platform_build", name: "Sports Platform Build", unit: "project", low: 45000, high: 65000 },
  { key: "bespoke_logo_mark", name: "Bespoke Logo Mark", unit: "project", low: 1200, high: null },
  { key: "full_brand_identity_system", name: "Full Brand Identity System", unit: "project", low: 3500, high: null },
  { key: "collateral_print_asset_add_on", name: "Collateral & Print Asset Add-On", unit: "add_on", low: 250, high: null },
  { key: "high_reach_reels_short_video", name: "High-Reach Reels & Short Video", unit: "per_piece", low: 1000, high: 3000 },
  { key: "core_content_pack", name: "Core Content Pack", unit: "retainer", low: 2000, high: null },
  { key: "growth_content_system", name: "Growth Content System", unit: "retainer", low: 3000, high: null },
  { key: "matchday_sla_retainer", name: "Matchday SLA Retainer", unit: "retainer", low: 8000, high: 12500 },
  { key: "web_technical_delegation", name: "Web & Technical Delegation", unit: "retainer", low: 450, high: 950 },
  { key: "complete_business_launchpad", name: "Complete Business Launchpad", unit: "bundle", low: 15000, high: 15000 },
  { key: "onsite_revenue_leak_audit", name: "Onsite Revenue Leak Audit", unit: "project", low: null, high: null },
  { key: "key_account_outreach_architecture", name: "Key Account Outreach Architecture", unit: "project", low: null, high: null },
  { key: "enterprise_growth_retainer", name: "Enterprise Growth Retainer", unit: "retainer", low: null, high: null },
];

// Phase 0, "Opportunity types". The last three are case-study derived.
export const opportunityTypes: { key: string; name: string; origin: "service_catalogue" | "case_study"; description?: string }[] = [
  { key: "website_rebuild", name: "Website rebuild", origin: "service_catalogue" },
  { key: "conversion_landing_page", name: "Conversion landing page", origin: "service_catalogue" },
  { key: "ecommerce", name: "E-commerce", origin: "service_catalogue" },
  { key: "website_maintenance", name: "Website maintenance", origin: "service_catalogue" },
  { key: "technical_website_improvement", name: "Technical website improvement", origin: "service_catalogue" },
  { key: "branding", name: "Branding", origin: "service_catalogue" },
  { key: "brand_identity", name: "Brand identity", origin: "service_catalogue" },
  { key: "sales_collateral", name: "Sales collateral", origin: "service_catalogue" },
  { key: "content", name: "Content", origin: "service_catalogue" },
  { key: "short_form_video", name: "Short-form video", origin: "service_catalogue" },
  { key: "social_content_system", name: "Social content system", origin: "service_catalogue" },
  { key: "sports_matchday_system", name: "Sports matchday system", origin: "service_catalogue" },
  { key: "sports_platform", name: "Sports platform", origin: "service_catalogue" },
  { key: "commercial_growth", name: "Commercial growth", origin: "service_catalogue" },
  { key: "lead_generation", name: "Lead generation", origin: "service_catalogue" },
  { key: "b2b_pipeline", name: "B2B pipeline", origin: "service_catalogue" },
  { key: "business_launch", name: "Business launch", origin: "service_catalogue" },
  { key: "rfq_system", name: "RFQ system", origin: "case_study", description: "Quotation engine, delivered under existing website services" },
  { key: "payment_checkout", name: "Payment checkout", origin: "case_study", description: "Direct card checkout, delivered under an existing website service" },
  { key: "client_portal", name: "Client portal", origin: "case_study", description: "Gated roster access, delivered under existing services" },
];

// Phase 0, "The mapping table". Array order = preference where a type has alternatives.
export const opportunityTypeServices: Record<string, string[]> = {
  conversion_landing_page: ["campaign_conversion_page"],
  website_rebuild: ["custom_business_website"],
  ecommerce: ["full_revenue_business_site"],
  sports_platform: ["sports_platform_build"],
  website_maintenance: ["web_technical_delegation"],
  technical_website_improvement: ["web_technical_delegation"],
  branding: ["bespoke_logo_mark"],
  brand_identity: ["full_brand_identity_system"],
  sales_collateral: ["collateral_print_asset_add_on"],
  short_form_video: ["high_reach_reels_short_video"],
  content: ["core_content_pack"],
  social_content_system: ["growth_content_system"],
  sports_matchday_system: ["matchday_sla_retainer"],
  business_launch: ["complete_business_launchpad"],
  commercial_growth: ["onsite_revenue_leak_audit", "enterprise_growth_retainer"],
  lead_generation: ["key_account_outreach_architecture"],
  b2b_pipeline: ["key_account_outreach_architecture"],
  rfq_system: ["custom_business_website", "full_revenue_business_site"],
  payment_checkout: ["full_revenue_business_site"],
  client_portal: ["full_revenue_business_site", "sports_platform_build"],
};

interface SignalTypeSeed {
  key: string;
  name: string;
  kind: "documented_trigger" | "friction";
  axis: "intent" | "opportunity" | null;
  intentRequiresIndependentSignal?: boolean;
  humanOnly?: boolean;
  decayDays: number;
  group?: string;
  detectableFrom?: string;
}

// Phase 0, "Commercial triggers as signal types" and "Signals extracted from the reasoning".
// Axis (for friction signals) and decay days are operator-adjustable defaults from the
// Phase 3 authorization. Friction signals decay with the audit that produced them: 90 days.
const INTENT_FRICTION = new Set(["sponsorship_inventory", "audience_scale", "high_value_products"]);
const friction = (group: string, keys: [string, string][]): SignalTypeSeed[] =>
  keys.map(([key, name]) => ({
    key,
    name,
    kind: "friction",
    axis: INTENT_FRICTION.has(key) ? "intent" : "opportunity",
    decayDays: 90,
    group,
  }));

export const signalTypes: SignalTypeSeed[] = [
  {
    key: "matchday_scramble",
    decayDays: 60,
    name: "Matchday scramble",
    kind: "documented_trigger",
    axis: "intent",
    detectableFrom: "Fixture cadence against posting cadence, inconsistent graphic treatment, late or missing matchday posts",
  },
  {
    key: "web_underperformance",
    decayDays: 90,
    name: "Outdated or underperforming web assets",
    kind: "documented_trigger",
    axis: "opportunity",
    intentRequiresIndependentSignal: true,
    detectableFrom: "Audit findings; counts as intent only with independent evidence of an operating, growing business",
  },
  {
    key: "procurement_scorecard",
    decayDays: 180,
    name: "Preferential procurement allocation",
    kind: "documented_trigger",
    axis: "intent",
    humanOnly: true,
    detectableFrom: "Human operator only. Automated detection may raise a verification prompt, never a signal",
  },
  {
    key: "brand_upgrade_need",
    decayDays: 120,
    name: "Upgrading brand presence",
    kind: "documented_trigger",
    axis: "intent",
    detectableFrom: "Inconsistent marks across channels, low-fidelity logo assets, presentation mismatched to company scale",
  },
  {
    key: "agency_fatigue",
    decayDays: 90,
    name: "Agency fatigue / budget creep",
    kind: "documented_trigger",
    axis: "intent",
    // Phase 8: a claim about a business's dissatisfaction with a supplier. Nothing on a
    // homepage evidences it unambiguously, so only an operator may record it.
    humanOnly: true,
    detectableFrom: "Public signals only: recent agency churn, hiring for in-house marketing, public complaints about scope or cost",
  },
  ...friction("Industrial and B2B supply", [
    ["high_value_products", "High-value products"],
    ["catalogue_friction", "Catalogue friction"],
    ["rfq_friction", "RFQ friction"],
    ["mobile_commercial_friction", "Mobile commercial friction"],
  ]),
  ...friction("Urgent trade services", [
    ["urgent_service_model", "Urgent service model"],
    ["whatsapp_conversion_opportunity", "WhatsApp conversion opportunity"],
    ["slow_mobile_experience", "Slow mobile experience"],
    ["lead_response_friction", "Lead response friction"],
  ]),
  ...friction("Sports organisations", [
    ["sponsorship_inventory", "Sponsorship inventory"],
    ["matchday_content_friction", "Matchday content friction"],
    ["audience_scale", "Audience scale"],
    ["attendance_opportunity", "Attendance opportunity"],
  ]),
  ...friction("Service businesses", [
    ["manual_order_handling", "Manual order handling"],
    ["no_qualification_path", "No qualification path"],
    ["pricing_opacity", "Pricing opacity"],
  ]),
];

// signal type → opportunity type (Phase 8). Operator-adjustable defaults derived from the
// Phase 0 benchmark reasoning and mapping table, not documented Covenant facts. Two
// types are deliberately unmapped: procurement_scorecard (the B-BBEE segment's service
// pull names no specific service) and agency_fatigue (no documented service follows from it).
export const signalTypeOpportunityTypes: Record<string, string[]> = {
  matchday_scramble: ["sports_matchday_system"],
  web_underperformance: ["website_rebuild", "technical_website_improvement"],
  brand_upgrade_need: ["brand_identity", "branding"],
  high_value_products: ["rfq_system"],
  catalogue_friction: ["rfq_system", "website_rebuild"],
  rfq_friction: ["rfq_system"],
  mobile_commercial_friction: ["website_rebuild"],
  urgent_service_model: ["conversion_landing_page"],
  whatsapp_conversion_opportunity: ["conversion_landing_page"],
  slow_mobile_experience: ["technical_website_improvement", "website_rebuild"],
  lead_response_friction: ["conversion_landing_page"],
  sponsorship_inventory: ["sports_platform", "sports_matchday_system"],
  matchday_content_friction: ["sports_matchday_system"],
  audience_scale: ["sports_platform"],
  attendance_opportunity: ["sports_matchday_system", "social_content_system"],
  manual_order_handling: ["payment_checkout"],
  no_qualification_path: ["conversion_landing_page"],
  pricing_opacity: ["conversion_landing_page"],
};

// Phase 0, "ICP segments". The B-BBEE segment's pull ("retainers, project work at
// volume") names no specific service, so it has no service mapping.
export const icpSegments: { key: string; name: string; definition: string; services: string[] }[] = [
  {
    key: "sports",
    name: "Sports",
    definition: "Provincial federations, competitive clubs, university sport departments with matchday inventory, ticketing or sponsorship",
    services: ["matchday_sla_retainer", "sports_platform_build"],
  },
  {
    key: "bbbee_corporate",
    name: "B-BBEE-conscious corporate",
    definition: "Mid-market and corporate buyers routing spend for scorecard recognition",
    services: [],
  },
  {
    key: "industrial_technical_trade",
    name: "Industrial / technical / trade",
    definition: "Engineering contractors, commercial mechanics, industrial suppliers dependent on sales pipelines",
    services: ["custom_business_website", "key_account_outreach_architecture"],
  },
  {
    key: "growth_founders",
    name: "Growth-focused founders",
    definition: "Operating companies with turnover, validated offering, leadership ready to invest",
    services: ["complete_business_launchpad", "growth_content_system"],
  },
];

// Phase 0, "Disqualifiers"; evidence rules are defaults from the Phase 3 authorization.
const HUMAN_ONLY = "Human-supplied evidence only. Never fires automatically.";
export const disqualifiers: { key: string; name: string; humanOnly: boolean; evidenceRequirement: string }[] = [
  { key: "zero_revenue_speculative", name: "Zero-revenue / speculative", humanOnly: true, evidenceRequirement: HUMAN_ONLY },
  { key: "uncapitalised_micro_operator", name: "Uncapitalised micro-operator", humanOnly: true, evidenceRequirement: HUMAN_ONLY },
  {
    key: "bureaucratic_procurement",
    name: "Bureaucratic procurement",
    humanOnly: false,
    evidenceRequirement: "May fire on a published tender or supply-chain portal for the organisation.",
  },
  { key: "no_decision_maker_access", name: "No decision-maker access", humanOnly: true, evidenceRequirement: HUMAN_ONLY },
  { key: "ethical_misalignment", name: "Ethical misalignment", humanOnly: true, evidenceRequirement: HUMAN_ONLY },
];

// Phase 0, "Score" table default weights.
export const defaultWeightSet = {
  name: "phase0_default",
  version: 1,
  notes: "Default weights from the Phase 0 scoring table",
  buyingSignal: "0.22",
  icpFit: "0.18",
  digitalOpportunity: "0.15",
  serviceFit: "0.15",
  commercialPotential: "0.12",
  contactability: "0.10",
  evidenceQuality: "0.08",
};

export const sources: { key: string; name: string; kind: "website_fetch" | "csv_import" | "manual_entry" | "human_operator" }[] = [
  { key: "website_fetch", name: "Company website (fetch layer)", kind: "website_fetch" },
  { key: "csv_import", name: "CSV import", kind: "csv_import" },
  { key: "manual_entry", name: "Manual entry", kind: "manual_entry" },
  { key: "human_operator", name: "Human operator statement", kind: "human_operator" },
];

export const settings: { key: SettingKey; value: unknown; origin: Origin; description: string }[] = [
  { key: "delivery_slots_total", value: null, origin: "documented", description: "New projects Covenant can start per cycle. NOT_CONFIGURED until supplied." },
  { key: "qualify_score_threshold", value: 55, origin: "default", description: "Minimum score for qualification." },
  { key: "qualify_confidence_threshold", value: 0.6, origin: "default", description: "Minimum confidence for qualification, set independently of score." },
  {
    key: "commercial_potential_floor_zar",
    value: 3500,
    origin: "default",
    description:
      "Floor on initial_value (the published entry price of the mapped service) that can pass the intent gate. " +
      "Set at the lowest published full-project entry price, R3,500 (Campaign Conversion Page, Full Brand Identity System). " +
      "Add-ons (from R250) and retainers (from R450/mo) are not entry points and are excluded; it is not the lowest price of anything.",
  },
  { key: "conversation_worthiness_bar", value: null, origin: "documented", description: "Deliberately unset: set after the first five audits are judged." },
  { key: "ai_monthly_cap_zar", value: 500, origin: "default", description: "Monthly AI spend cap in rand; hard stop when reached." },
  { key: "ai_per_lead_cap_usd", value: null, origin: "documented", description: "Per-lead AI cost ceiling. NOT_CONFIGURED." },
  { key: "usd_zar_planning_rate", value: 17, origin: "documented", description: "Conservative planning rate (Phase 0 'External services') for converting USD AI costs to rand." },
  { key: "dedupe_name_similarity_threshold", value: 0.6, origin: "default", description: "Name similarity at or above which import proposes a possible duplicate. Never merges." },
  {
    key: "freshness_refresh_days",
    value: { website_audit: 90, contact_channel: 180, company_profile: 180 },
    origin: "documented",
    description: "Refresh targets from Phase 0 'Freshness and decay'.",
  },
  {
    key: "confidence_verifiability",
    value: { VERIFIED: 1.0, INFERRED: 0.6, REPORTED: 0.8, UNKNOWN: 0 },
    origin: "documented",
    description: "Verifiability factor per claim type (Phase 0 'Confidence').",
  },
  { key: "delivery_cycle_weeks", value: { min: 2, max: 4 }, origin: "documented", description: "Delivery cycle length (Capabilities Guide delivery terms)." },
  { key: "quote_policy", value: "fixed_locked_at_signoff", origin: "documented", description: "Quotes are fixed and locked at sign-off (Capabilities Guide delivery terms)." },
  { key: "deposit_percent", value: 50, origin: "documented", description: "Deposit required before work starts (Capabilities Guide delivery terms)." },
  { key: "post_launch_warranty_days", value: 30, origin: "documented", description: "Post-launch warranty period (Capabilities Guide delivery terms)." },
  { key: "fetch_paused", value: false, origin: "default", description: "Global switch: true halts all outbound fetching before the next request." },
  { key: "fetch_min_delay_ms", value: 2000, origin: "documented", description: "Minimum delay between requests to one host (floor 2000; robots crawl-delay can only raise it)." },
  { key: "fetch_max_retries", value: 3, origin: "documented", description: "Retries for transient failures (timeouts, connection errors, 5xx), exponential backoff. Never for robots disallow, 403 or 429." },
  { key: "fetch_connect_timeout_ms", value: 10000, origin: "default", description: "TCP/TLS connect timeout." },
  { key: "fetch_read_timeout_ms", value: 20000, origin: "default", description: "Timeout waiting for response headers, and between body chunks." },
  { key: "fetch_max_body_bytes", value: 5000000, origin: "default", description: "Hard abort above this response size (pages). robots.txt is capped separately at 500 KiB." },
  { key: "fetch_max_redirects", value: 5, origin: "default", description: "Redirect hop cap; a repeated URL is a loop." },
  { key: "fetch_host_budget_per_run", value: 20, origin: "default", description: "Maximum requests to one host in one fetch run, robots.txt included." },
  { key: "fetch_cache_ttl_hours", value: 24, origin: "default", description: "A page fetched OK within this window is served from the stored record; after it, a conditional request is used." },
  { key: "robots_cache_ttl_hours", value: 24, origin: "default", description: "How long a fetched robots.txt is reused (RFC 9309 caps caching at 24 hours)." },
  { key: "confidence_recency_floor", value: 0.4, origin: "documented", description: "Recency factor at twice the refresh window (Phase 0 'Confidence')." },
];

// Phase 0, "Benchmark dataset v1". Evaluation labels only; never read by the pipeline.
export const benchmarkCategories: {
  number: number;
  name: string;
  verdict: "YES" | "MAYBE" | "NO";
  qualifier?: string;
  driver: string;
}[] = [
  { number: 1, name: "Provincial rugby unions and athletic federations", verdict: "YES", driver: "Sponsor exposure gap, matchday graphics chaos, accessible decision makers, platform build plus retainer" },
  { number: 2, name: "Specialised industrial equipment and PPE suppliers", verdict: "YES", driver: "High order values, heavy catalogues failing on mobile, RFQ friction, procurement alignment" },
  { number: 3, name: "High-volume school and sports photographers", verdict: "YES", driver: "Hours lost chasing orders and payment confirmations manually" },
  { number: 4, name: "Commercial field contractors and trade services", verdict: "YES", driver: "Urgent demand lost to slow pages and long forms instead of instant routing" },
  { number: 5, name: "Boutique sports management and talent representation", verdict: "YES", driver: "Visible credibility to sign athletes, private roster separate from public presence" },
  { number: 6, name: "Video production houses and cinematography studios", verdict: "YES", driver: "Enquiries stuck in DMs with no qualifying path or published rates" },
  { number: 7, name: "Collegiate sports clubs and semi-pro teams", verdict: "YES", driver: "Attendance and gate revenue respond to structured gameday content" },
  { number: 8, name: "Regional game lodges and safari reserves", verdict: "MAYBE", driver: "Budget and traffic strong, legacy booking systems hard to integrate" },
  { number: 9, name: "Premium regional D2C brands", verdict: "MAYBE", driver: "Visual fit strong, margins make founders hesitant above R10,000" },
  { number: 10, name: "Multi-location gyms and CrossFit boxes", verdict: "MAYBE", driver: "Needs largely met by third-party portals, limited retainer appetite" },
  { number: 11, name: "Mid-tier law and accounting firms", verdict: "MAYBE", driver: "Stable cash flow, slow committee decisions, conservative design expectations" },
  { number: 12, name: "Local restaurants, cafes, single-location eateries", verdict: "NO", driver: "Thin margins, needs met by social, maps and delivery platforms" },
  { number: 13, name: "Solo personal trainers and micro-influencers", verdict: "NO", driver: "Low willingness to pay" },
  { number: 14, name: "Dropshipping and quick-win e-commerce", verdict: "NO", driver: "Template swaps, no retention, payment disputes" },
  { number: 15, name: "JSE-listed conglomerates and state entities", verdict: "NO", qualifier: "for cold outreach", driver: "Long procurement cycles and tender compliance, not a fit for this channel" },
  { number: 16, name: "Informal micro-businesses", verdict: "NO", driver: "Budget mismatch" },
];
