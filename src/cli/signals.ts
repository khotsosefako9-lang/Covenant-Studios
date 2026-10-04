// npm run signals -- detect <auditId>
// npm run signals -- list   <companyId>
// npm run signals -- add    <companyId> --type <signal type> --strength <0-1> --basis "<what you know and how>" --by "<operator>"
import "./stdout";
import { parseArgs } from "node:util";
import { getDb, getPool } from "../db/client";
import { companySignalView, detectSignalsForAudit, recordOperatorSignal } from "../signals/detect";

const { values, positionals } = parseArgs({
  options: { type: { type: "string" }, strength: { type: "string" }, basis: { type: "string" }, by: { type: "string" } },
  allowPositionals: true,
});
const [command, id] = positionals;

try {
  const db = getDb();
  if (command === "detect" && id) {
    const r = await detectSignalsForAudit(db, id);
    if (r.status === "abstained") console.log(`No signals: ${r.reason}`);
    else {
      console.log(`${r.created.length} signal(s) created, ${r.existing} already present, ${r.retracted} older signal(s) retracted`);
      for (const c of r.created) console.log(`  ${c.typeKey} strength ${c.strength}`);
    }
  } else if (command === "list" && id) {
    const v = await companySignalView(db, id);
    if (!v.signals.length) console.log("No active signals.");
    for (const x of v.signals) console.log(`  ${x.typeKey} (${x.detectedBy}) strength ${x.strength} → ${x.strengthNow} now, observed ${x.observedAt.toISOString().slice(0, 10)}`);
    for (const axis of ["intent", "opportunity"] as const) {
      console.log(`${axis.toUpperCase()}: ${v.axes[axis].map((c) => `${c.typeKey} ${c.strength.toFixed(2)} (${c.basis})`).join("; ") || "none"}`);
    }
  } else if (command === "add" && id && values.type && values.strength && values.basis && values.by) {
    const r = await recordOperatorSignal(db, { companyId: id, typeKey: values.type, strength: Number(values.strength), basis: values.basis, actor: values.by });
    console.log(`Recorded ${values.type} as signal ${r.signalId}, resting on evidence ${r.evidenceId}`);
  } else {
    console.error("Usage: npm run signals -- <detect <auditId> | list <companyId> | add <companyId> --type --strength --basis --by>");
    process.exitCode = 2;
  }
} finally {
  await getPool().end();
}
