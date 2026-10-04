// Runs one audit: fetch through the fetch layer, triage, probe, evaluate, persist.
// This file does no network I/O of its own; every request goes through FetchRun.
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { SHARED_PLATFORM_HOSTS } from "@/core/identity/domain";
import { inCompanyCluster } from "@/db/company-scope";
import * as s from "@/db/schema/index";
import type { FetchResult, FetchRun } from "@/fetch/fetcher";
import { parseDocument } from "./document";
import { CHECK_SET_VERSION, evaluate, planProbes, sitemapsFromRobots } from "./registry";
import { triage } from "./shell";
import type { AuditContext, Probe } from "./types";

type Db = NodePgDatabase<typeof s>;
type SourceRecord = typeof s.sourceRecords.$inferSelect;

export interface AuditOutcome {
  auditId: string;
  status: (typeof s.auditStatus.enumValues)[number];
  findings: number;
}

const isSharedPlatform = (host: string) => SHARED_PLATFORM_HOSTS.includes(host.replace(/^www\./, "").toLowerCase());

async function recordFor(db: Db, r: FetchResult): Promise<SourceRecord | null> {
  if (!("sourceRecordId" in r)) return null;
  const [row] = await db.select().from(s.sourceRecords).where(eq(s.sourceRecords.id, r.sourceRecordId));
  return row ?? null;
}

async function probeOf(db: Db, url: string, r: FetchResult): Promise<Probe> {
  const rec = await recordFor(db, r);
  if (!rec) return { url, outcome: "NOT_FETCHED", httpStatus: null, finalUrl: null, contentType: null, declaredLength: null, sourceRecordId: null, detail: "detail" in r ? r.detail : null };
  return {
    url,
    outcome: rec.fetchOutcome,
    httpStatus: rec.httpStatus,
    finalUrl: rec.finalUrl,
    contentType: rec.contentType,
    declaredLength: rec.declaredLength,
    sourceRecordId: rec.id,
    detail: rec.errorDetail,
  };
}

/**
 * Audits a company's homepage. `targetUrl` overrides https://<domain>/ (used for a
 * company whose only web presence is a shared platform, and by tests).
 */
export async function runAudit(
  db: Db,
  fetchRun: FetchRun,
  opts: { companyId: string; traceId?: string; targetUrl?: string },
): Promise<AuditOutcome> {
  const traceId = opts.traceId ?? crypto.randomUUID();
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, opts.companyId));
  if (!company) throw new Error(`No company ${opts.companyId}`);

  let target = opts.targetUrl ?? (company.domain ? `https://${company.domain}/` : null);
  if (!target) {
    // No own domain: is the only reported presence a shared platform page?
    const [presence] = await db
      .select({ value: s.evidence.value })
      .from(s.evidence)
      .where(and(inCompanyCluster(s.evidence.companyId, company.id), eq(s.evidence.claimKey, "company.web_presence_url")));
    target = presence?.value ?? null;
  }

  const insertAudit = async (values: Partial<typeof s.audits.$inferInsert>) => {
    const [row] = await db
      .insert(s.audits)
      .values({ companyId: company.id, targetUrl: target ?? "(none)", checkSetVersion: CHECK_SET_VERSION, traceId, startedAt: new Date(), ...values })
      .returning({ id: s.audits.id, status: s.audits.status });
    if (!row) throw new Error("audit insert returned no row");
    return row;
  };
  const finishAudit = async (auditId: string, values: Partial<typeof s.audits.$inferInsert>) => {
    await db.update(s.audits).set({ completedAt: new Date(), ...values }).where(eq(s.audits.id, auditId));
  };

  if (!target) {
    const a = await insertAudit({ status: "FAILED", errorCode: "no_website", errorDetail: "The company has no domain and no reported web presence", completedAt: new Date() });
    return { auditId: a.id, status: "FAILED", findings: 0 };
  }
  const targetUrl = new URL(target);
  if (isSharedPlatform(targetUrl.hostname)) {
    const a = await insertAudit({
      status: "SHARED_PLATFORM",
      statusDetail: `The web presence is a page on ${targetUrl.hostname}, not the company's own website; site checks do not apply and nothing was requested`,
      completedAt: new Date(),
    });
    return { auditId: a.id, status: "SHARED_PLATFORM", findings: 0 };
  }

  const audit = await insertAudit({ status: "RUNNING" });
  try {
    const fetchOpts = { companyId: company.id, traceId };
    const first = await fetchRun.fetchPage(targetUrl.toString(), fetchOpts);
    if (!first.recorded && first.reason !== "cached") {
      await finishAudit(audit.id, { status: "FAILED", errorCode: first.reason, errorDetail: first.detail });
      return { auditId: audit.id, status: "FAILED", findings: 0 };
    }
    const firstRec = await recordFor(db, first);
    if (!firstRec) throw new Error("fetch result has no source record");

    const viaHttps = targetUrl.protocol === "https:";
    const https = viaHttps ? { outcome: firstRec.fetchOutcome, detail: firstRec.errorDetail, sourceRecordId: firstRec.id } : null;
    let page: SourceRecord | null = firstRec.fetchOutcome === "OK" ? firstRec : null;
    let httpVariant: Probe | null = null;
    const httpUrl = new URL(targetUrl);
    httpUrl.protocol = "http:";
    if (!page && viaHttps && ["UNREACHABLE", "TIMEOUT", "TLS_ERROR"].includes(firstRec.fetchOutcome)) {
      // HTTPS failed at the transport: the site may still be served over plain HTTP.
      const r = await fetchRun.fetchPage(httpUrl.toString(), fetchOpts);
      httpVariant = await probeOf(db, httpUrl.toString(), r);
      const rec = await recordFor(db, r);
      if (rec?.fetchOutcome === "OK") page = rec;
    }

    if (!page) {
      if (firstRec.fetchOutcome === "SOURCE_BLOCKED" || firstRec.fetchOutcome === "BLOCKED_BY_SERVER") {
        const robots = firstRec.fetchOutcome === "SOURCE_BLOCKED";
        await finishAudit(audit.id, {
          status: "SOURCE_BLOCKED",
          blockReason: robots ? "robots_disallow" : "http_forbidden",
          blockSourceRecordId: robots ? (firstRec.robotsSourceRecordId ?? firstRec.id) : firstRec.id,
          statusDetail: firstRec.errorDetail,
        });
        return { auditId: audit.id, status: "SOURCE_BLOCKED", findings: 0 };
      }
      await finishAudit(audit.id, { status: "FAILED", errorCode: firstRec.fetchOutcome, errorDetail: firstRec.errorDetail });
      return { auditId: audit.id, status: "FAILED", findings: 0 };
    }

    // A 304 points at the record that holds the body.
    const bodyRec = page.revalidatedFromId
      ? ((await db.select().from(s.sourceRecords).where(eq(s.sourceRecords.id, page.revalidatedFromId)))[0] ?? page)
      : page;
    const doc = parseDocument(bodyRec.rawContent ?? "", page.finalUrl ?? page.url ?? targetUrl.toString());
    const t = triage(doc);
    if (t.kind !== "auditable") {
      await finishAudit(audit.id, {
        status: t.kind === "render_required" ? "RENDER_REQUIRED" : "NO_CONTENT",
        pageSourceRecordId: page.id,
        statusDetail: `${t.reasons.join("; ")}. Metrics: ${JSON.stringify(t.metrics)}`,
      });
      return { auditId: audit.id, status: t.kind === "render_required" ? "RENDER_REQUIRED" : "NO_CONTENT", findings: 0 };
    }

    // Probes: every extra request goes through the same fetch run (robots, limits, budget).
    if (viaHttps && !httpVariant) httpVariant = await probeOf(db, httpUrl.toString(), await fetchRun.fetchPage(httpUrl.toString(), fetchOpts));
    const robotsRec = page.robotsSourceRecordId
      ? (await db.select().from(s.sourceRecords).where(eq(s.sourceRecords.id, page.robotsSourceRecordId)))[0]
      : undefined;
    const sitemapUrl = sitemapsFromRobots(robotsRec?.rawContent ?? null)[0] ?? new URL("/sitemap.xml", doc.url).toString();
    const sitemap = await probeOf(db, sitemapUrl, await fetchRun.fetchPage(sitemapUrl, fetchOpts));
    const plan = planProbes(doc);
    const probeAll = async (urls: string[]) => {
      const out: Probe[] = [];
      for (const u of urls) out.push(await probeOf(db, u, await fetchRun.fetchPage(u, fetchOpts)));
      return out;
    };
    const ctx: AuditContext = {
      doc,
      fetchedAt: page.fetchedAt,
      pageSourceRecordId: page.id,
      responseMs: page.responseMs,
      headers: (page.responseHeaders as Record<string, string> | null) ?? {},
      companyName: company.displayName,
      https,
      httpVariant: viaHttps ? httpVariant : null,
      sitemap,
      links: await probeAll(plan.links),
      pdfs: await probeAll(plan.pdfs),
      social: await probeAll(plan.social),
    };

    const enabled = new Set(
      (await db.select({ key: s.auditChecks.key }).from(s.auditChecks).where(eq(s.auditChecks.enabled, true))).map((r) => r.key),
    );
    const results = evaluate(ctx, enabled);

    await db.transaction(async (tx) => {
      for (const { check, result, severity } of results) {
        const [finding] = await tx
          .insert(s.auditFindings)
          .values({
            auditId: audit.id,
            checkKey: check.key,
            checkVersion: check.version,
            status: result.status,
            severity,
            confidence: String(result.confidence),
            detail: result.detail,
            observedAt: page.fetchedAt,
          })
          .returning({ id: s.auditFindings.id });
        if (!finding) throw new Error("finding insert returned no row");
        for (const item of result.evidence) {
          // null = observed in a request that was never made: there is nothing to cite.
          if (item.sourceRecordId === null) continue;
          const [ev] = await tx
            .insert(s.evidence)
            .values({
              companyId: company.id,
              sourceRecordId: item.sourceRecordId ?? page.id,
              producer: "audit",
              claimKey: `audit.${check.key}`,
              claim: item.claim,
              claimType: "VERIFIED",
              value: item.value,
              excerpt: item.excerpt ?? null,
              locator: item.locator,
              confidence: String(result.confidence),
              observedAt: page.fetchedAt,
            })
            .returning({ id: s.evidence.id });
          if (ev) await tx.insert(s.auditFindingEvidence).values({ auditFindingId: finding.id, evidenceId: ev.id }).onConflictDoNothing();
        }
      }
      await tx.update(s.audits).set({ status: "COMPLETED", pageSourceRecordId: page.id, completedAt: new Date() }).where(eq(s.audits.id, audit.id));
    });
    return { auditId: audit.id, status: "COMPLETED", findings: results.length };
  } catch (e) {
    await finishAudit(audit.id, { status: "FAILED", errorCode: "exception", errorDetail: e instanceof Error ? e.message : String(e) });
    return { auditId: audit.id, status: "FAILED", findings: 0 };
  }
}
