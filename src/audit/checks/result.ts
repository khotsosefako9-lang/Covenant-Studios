// Small constructors so every check states its result the same way.
import type { CheckResult, EvidenceItem, Severity } from "../types";

export const pass = (detail: string, confidence: number, evidence: EvidenceItem[] = []): CheckResult => ({
  status: "PASS",
  confidence,
  detail,
  evidence,
});

export const fail = (detail: string, confidence: number, evidence: EvidenceItem[], severity?: Severity): CheckResult => ({
  status: "FAIL",
  confidence,
  detail,
  evidence,
  ...(severity ? { severity } : {}),
});

/** Capacity checks: a marker of operating scale is on the page. */
export const present = (detail: string, confidence: number, evidence: EvidenceItem[]): CheckResult => ({
  status: "PRESENT",
  confidence,
  detail,
  evidence,
});

/** Capacity checks: the page was read and carries no such marker. */
export const absent = (detail: string, confidence: number, evidence: EvidenceItem[] = []): CheckResult => ({
  status: "ABSENT",
  confidence,
  detail,
  evidence,
});

export const notApplicable = (detail: string): CheckResult => ({ status: "NOT_APPLICABLE", confidence: 1, detail, evidence: [] });

export const indeterminate = (detail: string, evidence: EvidenceItem[] = []): CheckResult => ({
  status: "INDETERMINATE",
  confidence: 0,
  detail,
  evidence,
});

/** The English-vocabulary guard used by every wording-based check. */
export const notEnglish = (lang: string | null) =>
  indeterminate(
    `Page language ${lang ? `"${lang}"` : "(undeclared)"} is not one this check's vocabulary can read; no judgement made`,
  );
