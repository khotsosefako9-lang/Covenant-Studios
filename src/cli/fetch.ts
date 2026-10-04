// npm run fetch -- status
// npm run fetch -- pause  --by "<operator>"     halts all outbound fetching before the next request
// npm run fetch -- resume --by "<operator>"
// npm run fetch -- url <url> [--company <companyId>]
import "./stdout";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client";
import * as s from "../db/schema/index";
import { FetchRun, isFetchPaused, loadFetchConfig } from "../fetch/fetcher";
import { USER_AGENT } from "../fetch/identity";
import { HostLimiter, realClock } from "../fetch/limiter";

const { values, positionals } = parseArgs({
  options: { by: { type: "string" }, company: { type: "string" } },
  allowPositionals: true,
});
const [command, target] = positionals;

try {
  const db = getDb();
  switch (command) {
    case "status":
      console.log(`Fetching is ${(await isFetchPaused(db)) ? "PAUSED" : "enabled"}. User-Agent: ${USER_AGENT}`);
      break;
    case "pause":
    case "resume": {
      if (!values.by) throw new Error("--by <operator> is required");
      await db
        .update(s.settings)
        .set({ value: command === "pause", configOrigin: "operator", updatedBy: values.by })
        .where(eq(s.settings.key, "fetch_paused"));
      console.log(command === "pause" ? "Fetching paused." : "Fetching resumed.");
      break;
    }
    case "url": {
      if (!target) throw new Error("Usage: npm run fetch -- url <url> [--company <id>]");
      const run = new FetchRun(db, await loadFetchConfig(db), new HostLimiter(realClock), realClock);
      try {
        const r = await run.fetchPage(target, { companyId: values.company ?? null, traceId: randomUUID() });
        console.log(JSON.stringify(r, null, 2));
      } finally {
        await run.close();
      }
      break;
    }
    default:
      console.error("Usage: npm run fetch -- <status|pause|resume|url> ...");
      process.exitCode = 2;
  }
} finally {
  await getPool().end();
}
