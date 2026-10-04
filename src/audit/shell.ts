// Whole-page triage before any check runs. A client-rendered shell looks empty to a
// static parser, and every content and conversion check would fire on it. A page judged a
// shell (or empty) gets zero findings. Doubt resolves toward silence: a wrongly detected
// shell costs one missed audit; a missed shell produces a page of false findings.
import type { Element } from "domhandler";
import type { PageDoc } from "./document";

export type Triage =
  | { kind: "auditable"; metrics: ShellMetrics }
  | { kind: "render_required" | "no_content"; reasons: string[]; metrics: ShellMetrics };

export interface ShellMetrics {
  visibleTextChars: number;
  htmlBytes: number;
  textToMarkupRatio: number;
  scriptTags: number;
  inlineScriptBytes: number;
  frameworkRoot: string | null;
  frameworkRootEmpty: boolean;
  noscriptAsksForJs: boolean;
  metaRefresh: boolean;
}

// Mount points of client-side frameworks. Server-rendered apps use them too, which is why
// an element only counts as a shell signal when it is (nearly) empty.
const ROOT_SELECTORS = [
  "#root",
  "#app",
  "#__next",
  "#__nuxt",
  "#___gatsby",
  "#svelte",
  "#q-app",
  "app-root",
  "[ng-app]",
  "[ng-version]",
  "[data-reactroot]",
  "[data-v-app]",
  "#ember-application",
  "[id^='ember']",
];

const NEEDS_JS = /(enable|turn on|requires?|need|activate)\s+javascript|javascript\s+(is\s+)?(required|disabled|must be enabled)/i;

export function triage(doc: PageDoc): Triage {
  const { $ } = doc;
  const scripts = $("script").toArray();
  const inlineScriptBytes = scripts.reduce((n, el) => n + $(el).text().length, 0);
  let frameworkRoot: string | null = null;
  let frameworkRootEmpty = false;
  for (const sel of ROOT_SELECTORS) {
    const el = $(sel).get(0) as Element | undefined;
    if (!el) continue;
    frameworkRoot = sel;
    const rootText = $(el).text().replace(/\s+/g, " ").trim();
    const childTags = $(el).children().toArray().length;
    frameworkRootEmpty = rootText.length < 40 && childTags <= 2;
    break;
  }
  const noscriptAsksForJs = $("noscript")
    .toArray()
    .some((el) => NEEDS_JS.test($(el).text()));
  const metaRefresh = $("meta[http-equiv]")
    .toArray()
    .some((el) => ($(el).attr("http-equiv") ?? "").toLowerCase() === "refresh");
  const visibleTextChars = doc.text.length;
  const htmlBytes = Buffer.byteLength(doc.html, "utf8");
  const metrics: ShellMetrics = {
    visibleTextChars,
    htmlBytes,
    textToMarkupRatio: htmlBytes ? Math.round((visibleTextChars / htmlBytes) * 1000) / 1000 : 0,
    scriptTags: scripts.length,
    inlineScriptBytes,
    frameworkRoot,
    frameworkRootEmpty,
    noscriptAsksForJs,
    metaRefresh,
  };

  const reasons: string[] = [];
  if (frameworkRoot && frameworkRootEmpty && visibleTextChars < 600) {
    reasons.push(`framework mount point ${frameworkRoot} is empty and the page has ${visibleTextChars} characters of text`);
  }
  if (noscriptAsksForJs && visibleTextChars < 600) reasons.push("a <noscript> fallback asks for JavaScript and the page has little text");
  if (scripts.length > 0 && visibleTextChars < 120) {
    reasons.push(`only ${visibleTextChars} characters of visible text alongside ${scripts.length} script tag(s)`);
  }
  if (
    metrics.textToMarkupRatio < 0.01 &&
    htmlBytes > 0 &&
    inlineScriptBytes / htmlBytes > 0.5 &&
    visibleTextChars < 400
  ) {
    reasons.push(`text is ${(metrics.textToMarkupRatio * 100).toFixed(1)}% of the markup and inline script is most of it`);
  }
  if (reasons.length) return { kind: "render_required", reasons, metrics };

  if (visibleTextChars < 120) {
    const why = metaRefresh
      ? "the page only redirects with <meta http-equiv=refresh>"
      : `the page has ${visibleTextChars} characters of visible text`;
    return { kind: "no_content", reasons: [why], metrics };
  }
  return { kind: "auditable", metrics };
}
