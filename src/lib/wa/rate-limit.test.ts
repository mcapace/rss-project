import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { visitorKey } from "./rate-limit";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261103120000_wa_rate_limits.sql"), "utf8"));
});
afterAll(async () => { await db.close(); });

const hit = async (bucket: string, limit: number, seconds = 3600) => (await db.query<{ ok: boolean }>("select public.wa_rate_hit($1, $2, $3) as ok", [bucket, limit, seconds])).rows[0].ok;

describe("wa_rate_hit", () => {
  it("allows up to the limit in a window, then refuses", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit("test:a", 3));
    expect(results).toEqual([true, true, true, false]);
  });
  it("counts buckets separately", async () => {
    expect(await hit("test:b", 1)).toBe(true);
    expect(await hit("test:b", 1)).toBe(false);
    expect(await hit("test:c", 1)).toBe(true);
  });
  it("lets bad arguments through rather than blocking", async () => {
    expect(await hit("test:d", 0)).toBe(true);
    expect(await hit("x".repeat(300), 1)).toBe(true);
  });
});

describe("visitorKey", () => {
  it("hashes the first forwarded address and never returns it", () => {
    const key = visitorKey(new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }));
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(key).not.toContain("203");
    expect(visitorKey(new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.9" } }))).toBe(key);
  });
});
