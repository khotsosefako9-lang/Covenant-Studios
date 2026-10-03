// npm run duplicates -- list [--status proposed|deferred|confirmed_duplicate|rejected]
// npm run duplicates -- confirm <candidateId> --keep <companyId> --by "<operator>" --reason "<why>"
// npm run duplicates -- reject  <candidateId> --by "<operator>" --reason "<why>"
// npm run duplicates -- defer   <candidateId> --by "<operator>" --reason "<why>"
// npm run duplicates -- unmerge <mergeId>     --by "<operator>" --reason "<why>"
// npm run duplicates -- show    <companyId>
import { parseArgs } from "node:util";
import { getDb, getPool } from "../db/client";
import { confirmDuplicate, deferDuplicate, getIdentityCluster, listCandidates, rejectDuplicate, unmerge } from "../identity/resolution";

const { values, positionals } = parseArgs({
  options: { by: { type: "string" }, reason: { type: "string" }, keep: { type: "string" }, status: { type: "string" } },
  allowPositionals: true,
});
const [command, target] = positionals;
const by = values.by ?? "";
const reason = values.reason ?? "";
const usage = () => {
  console.error("Usage: npm run duplicates -- <list|confirm|reject|defer|unmerge|show> [id] --by <operator> --reason <why> [--keep <companyId>]");
  process.exit(2);
};

const report = (r: { ok: boolean; message?: string }, success: string) => {
  if (r.ok) console.log(success);
  else {
    console.error(`Not done: ${r.message}`);
    process.exitCode = 1;
  }
};

try {
  const db = getDb();
  switch (command) {
    case "list": {
      const status = values.status as Parameters<typeof listCandidates>[1];
      const rows = await listCandidates(db, status);
      if (rows.length === 0) console.log("No candidates.");
      for (const r of rows) {
        console.log(
          `${r.id}  [${r.status}] ${r.match_basis}: ${r.matched_value}${r.similarity ? ` (${r.similarity})` : ""}\n` +
            `    A ${r.company_a_id}  ${r.a_name} ${r.a_domain ?? "(no domain)"}${r.a_status === "merged" ? " [merged]" : ""}\n` +
            `    B ${r.company_b_id}  ${r.b_name} ${r.b_domain ?? "(no domain)"}${r.b_status === "merged" ? " [merged]" : ""}`,
        );
      }
      break;
    }
    case "confirm": {
      if (!target || !values.keep) usage();
      const r = await confirmDuplicate(db, { candidateId: String(target), keepCompanyId: String(values.keep), actor: by, reason });
      report(r, r.ok ? `Merged ${r.loserId} into ${r.winnerId} (merge ${r.mergeId}, ${r.aliasesAdded} aliases added). Nothing was moved or deleted.` : "");
      break;
    }
    case "reject": {
      if (!target) usage();
      const r = await rejectDuplicate(db, { candidateId: String(target), actor: by, reason });
      report(r, "Recorded as a permanent non-match. This pair will not be proposed again.");
      break;
    }
    case "defer": {
      if (!target) usage();
      report(await deferDuplicate(db, { candidateId: String(target), actor: by, reason }), "Deferred.");
      break;
    }
    case "unmerge": {
      if (!target) usage();
      const r = await unmerge(db, { mergeId: String(target), actor: by, reason });
      report(r, r.ok ? `Restored ${r.restoredCompanyId} as an active company (${r.aliasesRemoved} merge aliases removed).` : "");
      break;
    }
    case "show": {
      if (!target) usage();
      const c = await getIdentityCluster(db, String(target));
      if (!c) console.log("No such company.");
      else console.log(`Root ${c.rootId}\nMembers: ${c.memberIds.join(", ")}`);
      break;
    }
    default:
      usage();
  }
} finally {
  await getPool().end();
}
