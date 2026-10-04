import { describe, expect, it } from "vitest";
import { dataClassOf, decayedStrength, freshness } from "@/core/freshness";

const WINDOWS = { website_audit: 90, contact_channel: 180, company_profile: 180 };
const NOW = new Date("2026-10-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);
const f = (dataClass: Parameters<typeof freshness>[0]["dataClass"], age: number, lastVerifiedAge?: number) =>
  freshness({ dataClass, observedAt: daysAgo(age), lastVerifiedAt: lastVerifiedAge === undefined ? null : daysAgo(lastVerifiedAge), now: NOW, windows: WINDOWS, recencyFloor: 0.4 });

describe("dataClassOf", () => {
  it.each([
    ["audit.tech.title", "website_audit"],
    ["audit.conv.contact_path", "website_audit"],
    ["company.phone", "contact_channel"],
    ["company.email", "contact_channel"],
    ["company.name", "company_profile"],
    ["company.industry", "company_profile"],
    ["company.domain", "company_profile"],
  ])("%s → %s", (key, cls) => expect(dataClassOf(key)).toBe(cls));
});

describe("freshness (Phase 0 windows: audit 90 days, contact channel 180, company profile 180)", () => {
  it.each([
    ["website_audit", 0, "fresh"],
    ["website_audit", 90, "fresh"],
    ["website_audit", 91, "stale"],
    ["contact_channel", 180, "fresh"],
    ["contact_channel", 181, "stale"],
    ["company_profile", 179, "fresh"],
    ["company_profile", 400, "stale"],
  ] as const)("%s observed %i days ago is %s", (cls, age, state) => {
    expect(f(cls, age).state).toBe(state);
  });

  it("computes recency: 1 inside the window, linear to the floor at twice the window, then flat", () => {
    expect(f("website_audit", 45).recency).toBe(1);
    expect(f("website_audit", 90).recency).toBe(1);
    expect(f("website_audit", 135).recency).toBe(0.7);
    expect(f("website_audit", 180).recency).toBe(0.4);
    expect(f("website_audit", 900).recency).toBe(0.4);
  });

  it("restarts the clock from a later re-verification, never from an earlier one", () => {
    expect(f("website_audit", 200, 10).state).toBe("fresh");
    expect(f("website_audit", 10, 200).ageDays).toBe(10);
  });

  it("reports when freshness ends", () => {
    expect(f("website_audit", 30).freshUntil.toISOString()).toBe(daysAgo(30 - 90).toISOString());
  });

  it("never reports negative age for clock skew", () => {
    expect(f("website_audit", -1).ageDays).toBe(0);
  });
});

describe("decayedStrength (linear to zero over the decay window)", () => {
  it.each([
    [0.8, 0, 90, 0.8],
    [0.8, 45, 90, 0.4],
    [0.8, 90, 90, 0],
    [0.8, 365, 90, 0],
    [0.6, 30, 60, 0.3],
    [0.5, 1000, null, 0.5],
  ])("strength %d observed %i days ago, decay %s days → %d", (strength, age, decayDays, expected) => {
    expect(decayedStrength({ strength, observedAt: daysAgo(age), decayDays, now: NOW })).toBe(expected);
  });
});
