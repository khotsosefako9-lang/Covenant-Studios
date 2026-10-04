// Idempotent configuration seed. Inserts missing rows and fills values that are still
// null; never overwrites a value, and never touches a row an operator has edited
// (config_origin = 'operator').
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import * as s from "./schema/index";
import { ALL_CHECKS } from "../audit/registry";
import * as data from "./seed-data";
import { parseSetting } from "./validation";

type Db = NodePgDatabase<typeof s>;

export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(s.covenantServices)
      .values(
        data.services.map((svc) => ({
          key: svc.key,
          name: svc.name,
          unit: svc.unit,
          revenueModel: svc.unit === "retainer" ? ("recurring" as const) : ("one_off" as const),
          billingPeriod: svc.unit === "retainer" ? ("monthly" as const) : ("once" as const),
          priceLowZar: svc.low,
          priceHighZar: svc.high,
          published: svc.low !== null,
        })),
      )
      .onConflictDoNothing({ target: s.covenantServices.key });

    await tx
      .insert(s.serviceCategories)
      .values(data.serviceCategories.map((c, i) => ({ key: c.key, name: c.name, sortOrder: i + 1 })))
      .onConflictDoNothing({ target: s.serviceCategories.key });
    for (const cat of data.serviceCategories) {
      const [row] = await tx.select({ id: s.serviceCategories.id }).from(s.serviceCategories).where(eq(s.serviceCategories.key, cat.key));
      if (!row) throw new Error(`seed: missing service category ${cat.key}`);
      await tx
        .update(s.covenantServices)
        .set({ serviceCategoryId: row.id })
        .where(and(inArray(s.covenantServices.key, cat.services), isNull(s.covenantServices.serviceCategoryId)));
    }

    await tx
      .insert(s.judgementReasons)
      .values(data.judgementReasons)
      .onConflictDoNothing({ target: s.judgementReasons.key });
    // Retire codes that are no longer in the controlled list (kept for existing judgements).
    await tx
      .update(s.judgementReasons)
      .set({ active: false })
      .where(
        and(
          notInArray(s.judgementReasons.key, data.judgementReasons.map((r) => r.key)),
          ne(s.judgementReasons.configOrigin, "operator"),
        ),
      );
    for (const r of data.judgementReasons) {
      await tx
        .update(s.judgementReasons)
        .set({ label: r.label, sortOrder: r.sortOrder, active: true })
        .where(and(eq(s.judgementReasons.key, r.key), ne(s.judgementReasons.configOrigin, "operator")));
    }

    await tx
      .insert(s.opportunityTypes)
      .values(data.opportunityTypes)
      .onConflictDoNothing({ target: s.opportunityTypes.key });

    const svcIds = new Map(
      (await tx.select({ id: s.covenantServices.id, key: s.covenantServices.key }).from(s.covenantServices)).map((r) => [r.key, r.id]),
    );
    const typeIds = new Map(
      (await tx.select({ id: s.opportunityTypes.id, key: s.opportunityTypes.key }).from(s.opportunityTypes)).map((r) => [r.key, r.id]),
    );
    const need = (m: Map<string, string>, key: string) => {
      const v = m.get(key);
      if (!v) throw new Error(`seed: unknown key ${key}`);
      return v;
    };

    await tx
      .insert(s.opportunityTypeServices)
      .values(
        Object.entries(data.opportunityTypeServices).flatMap(([type, svcs]) =>
          svcs.map((svc, i) => ({
            opportunityTypeId: need(typeIds, type),
            covenantServiceId: need(svcIds, svc),
            preference: i + 1,
          })),
        ),
      )
      .onConflictDoNothing();

    await tx
      .insert(s.signalTypes)
      .values(
        data.signalTypes.map((st) => ({
          key: st.key,
          name: st.name,
          kind: st.kind,
          axis: st.axis,
          intentRequiresIndependentSignal: st.intentRequiresIndependentSignal ?? false,
          humanOnly: st.humanOnly ?? false,
          group: st.group,
          detectableFrom: st.detectableFrom,
          decayDays: st.decayDays,
          configOrigin: "default" as const,
        })),
      )
      .onConflictDoNothing({ target: s.signalTypes.key });
    for (const st of data.signalTypes) {
      await tx
        .update(s.signalTypes)
        .set({ decayDays: st.decayDays, axis: sql`coalesce(${s.signalTypes.axis}, ${st.axis}::score_axis)`, configOrigin: "default" })
        .where(and(eq(s.signalTypes.key, st.key), isNull(s.signalTypes.decayDays), ne(s.signalTypes.configOrigin, "operator")));
    }

    await tx
      .insert(s.icpSegments)
      .values(data.icpSegments.map(({ key, name, definition }) => ({ key, name, definition })))
      .onConflictDoNothing({ target: s.icpSegments.key });
    const segRows = await tx
      .select({ id: s.icpSegments.id, key: s.icpSegments.key })
      .from(s.icpSegments)
      .where(inArray(s.icpSegments.key, data.icpSegments.map((x) => x.key)));
    const segIds = new Map(segRows.map((r) => [r.key, r.id]));
    const segLinks = data.icpSegments.flatMap((seg) =>
      seg.services.map((svc) => ({ icpSegmentId: need(segIds, seg.key), covenantServiceId: need(svcIds, svc) })),
    );
    if (segLinks.length) await tx.insert(s.icpSegmentServices).values(segLinks).onConflictDoNothing();

    await tx
      .insert(s.disqualifiers)
      .values(data.disqualifiers.map((d) => ({ ...d, configOrigin: "default" as const })))
      .onConflictDoNothing({ target: s.disqualifiers.key });
    for (const d of data.disqualifiers) {
      await tx
        .update(s.disqualifiers)
        .set({ evidenceRequirement: d.evidenceRequirement, humanOnly: d.humanOnly, configOrigin: "default" })
        .where(
          and(eq(s.disqualifiers.key, d.key), isNull(s.disqualifiers.evidenceRequirement), ne(s.disqualifiers.configOrigin, "operator")),
        );
    }

    const ws = data.defaultWeightSet;
    const [existingActive] = await tx.select({ id: s.weightSets.id }).from(s.weightSets).limit(1);
    await tx
      .insert(s.weightSets)
      .values({ ...ws, isActive: existingActive === undefined, createdBy: "seed" })
      .onConflictDoNothing({ target: [s.weightSets.name, s.weightSets.version] });

    await tx.insert(s.sources).values(data.sources).onConflictDoNothing({ target: s.sources.key });

    await tx
      .insert(s.settings)
      .values(
        data.settings.map((st) => ({
          key: st.key,
          value: parseSetting(st.key, st.value),
          description: st.description,
          configOrigin: st.origin,
          updatedBy: "seed",
        })),
      )
      .onConflictDoNothing({ target: s.settings.key });
    for (const st of data.settings) {
      // Descriptions document what a value means; they follow the code unless an operator edited the row.
      await tx
        .update(s.settings)
        .set({ description: st.description })
        .where(and(eq(s.settings.key, st.key), ne(s.settings.configOrigin, "operator")));
      if (st.value === null) continue;
      await tx
        .update(s.settings)
        .set({ value: parseSetting(st.key, st.value), configOrigin: st.origin, updatedBy: "seed" })
        .where(
          and(
            eq(s.settings.key, st.key),
            or(isNull(s.settings.value), sql`${s.settings.value} = 'null'::jsonb`),
            ne(s.settings.configOrigin, "operator"),
          ),
        );
    }

    // Audit checks: documentation follows the code; the enabled switch is the operator's.
    for (const c of ALL_CHECKS) {
      const doc = { name: c.name, category: c.category, severity: c.severity, version: c.version, description: c.description, evidenceRecorded: c.evidenceRecorded };
      await tx
        .insert(s.auditChecks)
        .values({ key: c.key, ...doc })
        .onConflictDoUpdate({ target: s.auditChecks.key, set: { ...doc, updatedAt: sql`now()` } });
    }

    await tx
      .insert(s.benchmarkCategories)
      .values(
        data.benchmarkCategories.map((c) => ({
          datasetVersion: "v1",
          number: c.number,
          name: c.name,
          expectedVerdict: c.verdict,
          verdictQualifier: c.qualifier,
          commercialDriver: c.driver,
        })),
      )
      .onConflictDoNothing({ target: [s.benchmarkCategories.datasetVersion, s.benchmarkCategories.number] });
  });
}
