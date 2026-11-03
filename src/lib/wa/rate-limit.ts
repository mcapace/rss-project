import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The visitor, as a short hash of their IP: enough to count requests, never stored as the address itself. */
export function visitorKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`wa-rate:${ip}`).digest("hex").slice(0, 24);
}

/**
 * One hit in a shared counter (wa_rate_hit): true while the bucket is within `limit` hits per `windowSeconds`.
 * Fails open: if the database cannot answer, the request goes through rather than breaking search.
 */
export async function withinLimit(db: SupabaseClient, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("wa_rate_hit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
    if (error) { console.warn("[wa/rate-limit]", error.message); return true; }
    return data !== false;
  } catch (error) {
    console.warn("[wa/rate-limit]", error instanceof Error ? error.message : error);
    return true;
  }
}
