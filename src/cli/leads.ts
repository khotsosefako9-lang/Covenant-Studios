// npm run leads -- show      <companyId>
// npm run leads -- override  <companyId> --state <STATE> --reason "..." --by "<operator>"
// npm run leads -- clear     <companyId> --reason "..." --by "<operator>"
// npm run leads -- channel   <companyId> --value <cold_outreach_allowed|cold_outreach_disallowed|unknown> --reason "..." --by "<operator>"
// npm run leads -- disqualify <companyId> --disqualifier <key> --reason "<basis>" --by "<operator>"
// npm run leads -- lift      <disqualificationId> --reason "..." --by "<operator>"
// npm run leads -- segment   <companyId> --fit <fit|potentially_valid|not_fit> [--segment <icp segment key>] --reason "..." --by "<operator>"
import "./stdout";
import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client";
import * as s from "../db/schema/index";
import { clearLeadOverride, liftDisqualification, overrideLeadState, recordOperatorDisqualification, setChannelSuitability, setSegmentFit } from "../leads/actions";
import { findClusterLead } from "../leads/evaluate";

const { values, positionals } = parseArgs({
  options: { state: { type: "string" }, reason: { type: "string" }, by: { type: "string" }, value: { type: "string" }, disqualifier: { type: "string" }, fit: { type: "string" }, segment: { type: "string" } },
  allowPositionals: true,
});
const [command, id] = positionals;
const reason = values.reason ?? "";
const actor = values.by ?? "";

try {
  const db = getDb();
  if (command === "show" && id) {
    const lead = await findClusterLead(db, id);
    if (!lead) console.log("No open lead. Run: npm run pipeline -- <companyId>");
    else {
      console.log(`Lead ${lead.id}: ${lead.leadState} (system ${lead.systemLeadState}${lead.stateOverride ? `; overridden by ${lead.stateOverrideBy}: ${lead.stateOverrideReason}` : ""})`);
      console.log(`  gate ${lead.intentGateStatus}${lead.intentGateBasis ? ` (${lead.intentGateBasis})` : ""}; system gate ${lead.systemGateStatus}; channel ${lead.outreachChannelSuitability}; segment fit ${lead.segmentFit}; treatment ${lead.scoreTreatment ?? "none"}`);
      console.log(`  score: npm run score -- explain ${lead.id}`);
      const [ev] = lead.lastEvaluationId ? await db.select().from(s.leadEvaluations).where(eq(s.leadEvaluations.id, lead.lastEvaluationId)) : [];
      if (ev) for (const r of ev.reasons as string[]) console.log(`    - ${r}`);
      console.log("  transitions:");
      const ts = await db.select().from(s.leadStateTransitions).where(eq(s.leadStateTransitions.leadId, lead.id)).orderBy(desc(s.leadStateTransitions.occurredAt));
      for (const t of ts) console.log(`    ${t.occurredAt.toISOString()} ${t.cause} ${t.fromState ?? "∅"} → ${t.toState} by ${t.actor}: ${t.detail}`);
    }
  } else if (command === "override" && id && values.state) {
    const r = await overrideLeadState(db, { companyId: id, state: values.state as (typeof s.leadState.enumValues)[number], actor, reason });
    console.log(`${r.from} → ${r.to} (system state stays ${r.systemState})`);
  } else if (command === "clear" && id) {
    const r = await clearLeadOverride(db, { companyId: id, actor, reason });
    console.log(`${r.from} → ${r.to} (system state)`);
  } else if (command === "channel" && id && values.value) {
    await setChannelSuitability(db, { companyId: id, value: values.value as (typeof s.channelSuitability.enumValues)[number], actor, reason });
    console.log(`Channel suitability: ${values.value}`);
  } else if (command === "disqualify" && id && values.disqualifier) {
    const r = await recordOperatorDisqualification(db, { companyId: id, disqualifierKey: values.disqualifier, basis: reason, actor });
    console.log(`Recorded ${values.disqualifier}; lead is now ${r.evaluation.state}`);
  } else if (command === "segment" && id && values.fit) {
    const r = await setSegmentFit(db, { companyId: id, fit: values.fit as "fit" | "potentially_valid" | "not_fit", segmentKey: values.segment, actor, reason });
    console.log(`Segment fit ${values.fit}; lead is now ${r.state}${r.score ? ` (score ${r.score.result.total}, confidence ${r.score.result.confidence})` : ""}`);
  } else if (command === "lift" && id) {
    const r = await liftDisqualification(db, { disqualificationId: id, actor, reason });
    console.log(`Lifted; lead is now ${r.state}`);
  } else {
    console.error("Usage: npm run leads -- <show|override|clear|channel|disqualify|lift> … (see src/cli/leads.ts)");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await getPool().end();
}
