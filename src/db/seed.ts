// Idempotent configuration seed: inserts missing rows, never overwrites operator edits.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import * as s from "./schema/index";
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
        })),
      )
      .onConflictDoNothing({ target: s.signalTypes.key });

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

    await tx.insert(s.disqualifiers).values(data.disqualifiers).onConflictDoNothing({ target: s.disqualifiers.key });

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
          updatedBy: "seed",
        })),
      )
      .onConflictDoNothing({ target: s.settings.key });

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
