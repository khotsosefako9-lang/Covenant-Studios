// Commercial configuration seed. Every value is transcribed from the Phase 0 document,
// which itself takes them from the Capabilities & Strategic Growth Guide. Anything the
// documents do not state is null (NOT_CONFIGURED / UNKNOWN), never a guess.
import type { SettingKey } from "./validation";

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
  group?: string;
  detectableFrom?: string;
}

// Phase 0, "Commercial triggers as signal types" and "Signals extracted from the reasoning".
// Friction signals have no documented axis or decay yet: left null for Phase 8.
const friction = (group: string, keys: [string, string][]): SignalTypeSeed[] =>
  keys.map(([key, name]) => ({ key, name, kind: "friction", axis: null, group }));

export const signalTypes: SignalTypeSeed[] = [
  {
    key: "matchday_scramble",
    name: "Matchday scramble",
    kind: "documented_trigger",
    axis: "intent",
    detectableFrom: "Fixture cadence against posting cadence, inconsistent graphic treatment, late or missing matchday posts",
  },
  {
    key: "web_underperformance",
    name: "Outdated or underperforming web assets",
    kind: "documented_trigger",
    axis: "opportunity",
    intentRequiresIndependentSignal: true,
    detectableFrom: "Audit findings; counts as intent only with independent evidence of an operating, growing business",
  },
  {
    key: "procurement_scorecard",
    name: "Preferential procurement allocation",
    kind: "documented_trigger",
    axis: "intent",
    humanOnly: true,
    detectableFrom: "Human operator only. Automated detection may raise a verification prompt, never a signal",
  },
  {
    key: "brand_upgrade_need",
    name: "Upgrading brand presence",
    kind: "documented_trigger",
    axis: "intent",
    detectableFrom: "Inconsistent marks across channels, low-fidelity logo assets, presentation mismatched to company scale",
  },
  {
    key: "agency_fatigue",
    name: "Agency fatigue / budget creep",
    kind: "documented_trigger",
    axis: "intent",
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

// Phase 0, "Disqualifiers". Evidence requirements per rule are not documented: null.
export const disqualifiers: { key: string; name: string; detectableFromWebsite: boolean }[] = [
  { key: "zero_revenue_speculative", name: "Zero-revenue / speculative", detectableFromWebsite: true },
  { key: "uncapitalised_micro_operator", name: "Uncapitalised micro-operator", detectableFromWebsite: false },
  { key: "bureaucratic_procurement", name: "Bureaucratic procurement", detectableFromWebsite: true },
  { key: "no_decision_maker_access", name: "No decision-maker access", detectableFromWebsite: true },
  { key: "ethical_misalignment", name: "Ethical misalignment", detectableFromWebsite: false },
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

export const settings: { key: SettingKey; value: unknown; description: string }[] = [
  { key: "delivery_slots_total", value: null, description: "New projects Covenant can start per cycle. NOT_CONFIGURED until supplied." },
  { key: "qualify_score_threshold", value: null, description: "Minimum score for qualification. Set from real output." },
  { key: "qualify_confidence_threshold", value: null, description: "Minimum confidence for qualification. Set independently of score." },
  { key: "commercial_potential_floor_zar", value: null, description: "Commercial-potential floor that can pass the intent gate." },
  { key: "conversation_worthiness_bar", value: null, description: "Deliberately unset: set after the first five audits are judged." },
  { key: "ai_monthly_cap_usd", value: null, description: "Monthly AI spend cap; hard stop when reached." },
  { key: "ai_per_lead_cap_usd", value: null, description: "Per-lead AI cost ceiling." },
  {
    key: "freshness_refresh_days",
    value: { website_audit: 90, contact_channel: 180, company_profile: 180 },
    description: "Refresh targets from Phase 0 'Freshness and decay'.",
  },
  {
    key: "confidence_verifiability",
    value: { VERIFIED: 1.0, INFERRED: 0.6, REPORTED: 0.8, UNKNOWN: 0 },
    description: "Verifiability factor per claim type (Phase 0 'Confidence').",
  },
  { key: "confidence_recency_floor", value: 0.4, description: "Recency factor at twice the refresh window (Phase 0 'Confidence')." },
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
