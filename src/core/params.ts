// Numeric parameters for deterministic rules (audit check thresholds, detector strengths).
// The code declares each parameter with its default and the bounds an operator may set it
// within; the stored configuration row holds the value. Pure: no I/O.
import { z } from "zod";

export interface ParamSpec {
  default: number;
  /** Inclusive bounds. A stored value outside them is rejected, never clamped. */
  min: number;
  max: number;
  integer?: boolean;
  description: string;
}

export type ParamSpecs = Readonly<Record<string, ParamSpec>>;
export type Params = Readonly<Record<string, number>>;

export class ParamsError extends Error {}

export function defaultsOf(specs: ParamSpecs | undefined): Params {
  return Object.fromEntries(Object.entries(specs ?? {}).map(([k, s]) => [k, s.default]));
}

export function schemaOf(specs: ParamSpecs | undefined) {
  return z
    .object(
      Object.fromEntries(
        Object.entries(specs ?? {}).map(([k, s]) => {
          const n = s.integer ? z.number().int() : z.number();
          return [k, n.min(s.min).max(s.max).optional()];
        }),
      ),
    )
    .strict();
}

/**
 * Stored values over the code defaults. A missing row or key takes the default; an unknown
 * key or a value outside its bounds is an error, so a typo never silently does nothing.
 */
export function resolveParams(specs: ParamSpecs | undefined, stored: unknown, owner: string): Params {
  if (stored === null || stored === undefined) return defaultsOf(specs);
  const parsed = schemaOf(specs).safeParse(stored);
  if (!parsed.success) throw new ParamsError(`Invalid parameters for ${owner}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
  return { ...defaultsOf(specs), ...(parsed.data as Record<string, number>) };
}
