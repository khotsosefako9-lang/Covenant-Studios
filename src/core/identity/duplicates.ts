// Duplicate-candidate detection. Pure: proposes pairs, never merges.
import { isSubdomainRelated } from "./domain";
import { nameSimilarity } from "./name";

export interface IdentityProfile {
  id: string;
  domain: string | null;
  normalisedName: string;
  phones: string[];
  emails: string[];
}

export type MatchBasis = "domain" | "normalised_name" | "phone" | "email";

export interface DuplicateCandidate {
  /** Lower id first, matching the table's ordering constraint. */
  companyAId: string;
  companyBId: string;
  matchBasis: MatchBasis;
  matchedValue: string;
  similarity: number | null;
}

const ordered = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

/**
 * Candidates between one new company and the companies it could duplicate.
 * Exact domain equality is not a candidate: it is the same identity and is handled
 * before a company is created.
 */
export function findDuplicateCandidates(
  subject: IdentityProfile,
  others: readonly IdentityProfile[],
  nameThreshold: number,
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  for (const other of others) {
    if (other.id === subject.id) continue;
    const [a, b] = ordered(subject.id, other.id);
    const add = (matchBasis: MatchBasis, matchedValue: string, similarity: number | null) =>
      out.push({ companyAId: a, companyBId: b, matchBasis, matchedValue, similarity });

    if (subject.domain && other.domain && isSubdomainRelated(subject.domain, other.domain)) {
      add("domain", `${subject.domain} ~ ${other.domain}`, null);
    }
    const sim = nameSimilarity(subject.normalisedName, other.normalisedName);
    if (sim >= nameThreshold) {
      const value = sim === 1 ? subject.normalisedName : `${subject.normalisedName} ~ ${other.normalisedName}`;
      add("normalised_name", value, Math.round(sim * 1000) / 1000);
    }
    const phone = subject.phones.find((p) => other.phones.includes(p));
    if (phone) add("phone", phone, null);
    const email = subject.emails.find((e) => other.emails.includes(e));
    if (email) add("email", email, null);
  }
  return out;
}
