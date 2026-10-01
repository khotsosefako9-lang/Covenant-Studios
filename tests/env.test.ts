import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/env";

describe("loadEnv", () => {
  it("accepts a valid DATABASE_URL", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" }).DATABASE_URL).toContain("localhost");
  });

  it("names the missing variable without echoing values", () => {
    expect(() => loadEnv({})).toThrow("Invalid environment: DATABASE_URL");
  });
});
