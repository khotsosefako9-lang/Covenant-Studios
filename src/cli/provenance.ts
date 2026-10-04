// npm run provenance -- evidence <evidenceId>
// npm run provenance -- finding  <findingId>
// npm run provenance -- company  <companyId> [--claim <claim-key prefix, e.g. company.phone or audit.conv>]
// Prints the full chain behind a claim: claim, evidence, source record, URL or file,
// retrieval time, claim type, confidence and freshness against its refresh window.
import "./stdout";
import { parseArgs } from "node:util";
import { getDb, getPool } from "../db/client";
import { type Chain, chainForEvidence, chainsForCompany, chainsForFinding, loadFreshnessConfig } from "../provenance/chain";

const { values, positionals } = parseArgs({ options: { claim: { type: "string" } }, allowPositionals: true });
const [kind, id] = positionals;

function print(c: Chain) {
  const f = c.freshness;
  const lines = [
    `CLAIM     ${c.claim.claim}${c.claim.value !== null ? ` = ${JSON.stringify(c.claim.value)}` : ""}`,
    `          ${c.claim.claimType} · key ${c.claim.claimKey} · by ${c.claim.producer}${c.claim.confidence ? ` · confidence ${c.claim.confidence}` : ""}`,
    c.claim.inferenceRule ? `          rule: ${c.claim.inferenceRule}` : null,
    c.claim.excerpt ? `          excerpt: ${c.claim.excerpt}` : null,
    c.claim.locator ? `          at: ${c.claim.locator}` : null,
    `EVIDENCE  ${c.claim.evidenceId} observed ${c.claim.observedAt.toISOString()}${c.claim.supersededById ? ` (superseded by ${c.claim.supersededById})` : ""}`,
    `SOURCE    ${c.source.location}`,
    `          ${c.source.method} · retrieved ${c.source.retrievedAt.toISOString()} · ${c.source.outcome}${c.source.httpStatus ? ` ${c.source.httpStatus}` : ""}${c.source.attributedTo ? ` · attributed to ${c.source.attributedTo}` : ""}`,
    c.source.userAgent ? `          as ${c.source.userAgent}${c.source.robotsRecordId ? ` · robots record ${c.source.robotsRecordId}` : ""}` : null,
    `          record ${c.source.id}${c.source.contentHash ? ` · sha256 ${c.source.contentHash.slice(0, 16)}…` : ""}`,
    `FRESHNESS ${f.state.toUpperCase()} · ${f.ageDays} days old · ${f.dataClass} window ${f.windowDays} days · fresh until ${f.freshUntil.toISOString().slice(0, 10)} · recency ${f.recency}`,
    ...c.findings.map((x) => `SUPPORTS  finding ${x.findingId} (${x.checkKey}: ${x.status}${x.severity ? `/${x.severity}` : ""}) in audit ${x.auditId}`),
  ];
  console.log(`${lines.filter(Boolean).join("\n")}\n`);
}

try {
  const db = getDb();
  const cfg = await loadFreshnessConfig(db);
  if (kind === "evidence" && id) print(await chainForEvidence(db, id, cfg));
  else if (kind === "finding" && id) {
    const { finding, chains } = await chainsForFinding(db, id, cfg);
    console.log(`FINDING   ${finding.checkKey}: ${finding.status}${finding.severity ? `/${finding.severity}` : ""} (confidence ${finding.confidence})\n          ${finding.detail}\n`);
    if (!chains.length) console.log("          (no evidence rows: the result rests on the absence of a request or a pass with nothing to cite)\n");
    chains.forEach(print);
  } else if (kind === "company" && id) {
    const chains = await chainsForCompany(db, id, cfg, values.claim);
    if (!chains.length) console.log("No claims found.");
    chains.forEach(print);
  } else {
    console.error("Usage: npm run provenance -- <evidence|finding|company> <id> [--claim <prefix>]");
    process.exitCode = 2;
  }
} finally {
  await getPool().end();
}
