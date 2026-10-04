// npm run thresholds -- list
// npm run thresholds -- set check    <checkKey>   <param> <value>
// npm run thresholds -- set detector <signalType> <param> <value>
// Setting a value marks the row as the operator's (config_origin = operator): the seed never
// touches it again. Values are validated against the bounds the code declares.
import "./stdout";
import { eq } from "drizzle-orm";
import { ALL_CHECKS, resolveCheckParams } from "../audit/registry";
import { resolveParams } from "../core/params";
import { getDb, getPool } from "../db/client";
import * as s from "../db/schema/index";
import { DETECTORS, resolveDetectorParams } from "../signals/detectors";

const [command, kind, key, param, raw] = process.argv.slice(2);

try {
  const db = getDb();
  if (command === "list") {
    const checks = await db.select({ key: s.auditChecks.key, params: s.auditChecks.params, origin: s.auditChecks.configOrigin }).from(s.auditChecks);
    const resolvedChecks = resolveCheckParams(Object.fromEntries(checks.map((c) => [c.key, c.params])));
    console.log("Audit check thresholds (audit_checks.params):");
    for (const c of ALL_CHECKS.filter((x) => x.params)) {
      const origin = checks.find((r) => r.key === c.key)?.origin;
      for (const [k, spec] of Object.entries(c.params ?? {})) console.log(`  ${c.key}.${k} = ${resolvedChecks[c.key]?.[k]} [${origin}] (default ${spec.default}, ${spec.min}–${spec.max}): ${spec.description}`);
    }
    const types = await db.select({ key: s.signalTypes.key, params: s.signalTypes.detectorParams, origin: s.signalTypes.configOrigin }).from(s.signalTypes);
    const resolvedDetectors = resolveDetectorParams(Object.fromEntries(types.map((t) => [t.key, t.params])));
    console.log("Detector parameters (signal_types.detector_params):");
    for (const d of DETECTORS) {
      const origin = types.find((r) => r.key === d.typeKey)?.origin;
      for (const [k, spec] of Object.entries(d.params)) console.log(`  ${d.typeKey}.${k} = ${resolvedDetectors[d.typeKey]?.[k]} [${origin}] (default ${spec.default}, ${spec.min}–${spec.max}): ${spec.description}`);
    }
  } else if (command === "set" && (kind === "check" || kind === "detector") && key && param && raw !== undefined) {
    const value = Number(raw);
    if (kind === "check") {
      const def = ALL_CHECKS.find((c) => c.key === key);
      if (!def?.params) throw new Error(`Check ${key} has no configurable parameters`);
      const [row] = await db.select({ params: s.auditChecks.params }).from(s.auditChecks).where(eq(s.auditChecks.key, key));
      const next = { ...((row?.params ?? {}) as Record<string, unknown>), [param]: value };
      resolveParams(def.params, next, `audit check ${key}`); // throws on an unknown key or an out-of-bounds value
      await db.update(s.auditChecks).set({ params: next, configOrigin: "operator" }).where(eq(s.auditChecks.key, key));
    } else {
      const def = DETECTORS.find((d) => d.typeKey === key);
      if (!def) throw new Error(`No detector produces ${key}`);
      const [row] = await db.select({ params: s.signalTypes.detectorParams }).from(s.signalTypes).where(eq(s.signalTypes.key, key));
      const next = { ...((row?.params ?? {}) as Record<string, unknown>), [param]: value };
      resolveParams(def.params, next, `detector ${key}`);
      await db.update(s.signalTypes).set({ detectorParams: next, configOrigin: "operator" }).where(eq(s.signalTypes.key, key));
    }
    console.log(`${key}.${param} = ${value} (operator). Audits and detections from now on use it; past findings keep the values recorded with them.`);
  } else {
    console.error("Usage: npm run thresholds -- <list | set <check|detector> <key> <param> <value>>");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await getPool().end();
}
