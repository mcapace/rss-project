import { timingSafeEqual } from "node:crypto";
import { cmsDb } from "@/lib/cms/db";
import { CMS_BRANDS } from "@/lib/cms/types";
import { embedBacklog, embeddingsConfigured } from "@/lib/editorial/server/embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily catch-up for the semantic index (vercel.json). Saves refresh their own
 * embeddings; this picks up anything a save could not (a provider error, an
 * import, a script that wrote documents directly). Vercel sends CRON_SECRET as
 * a bearer token; without the secret set, the route refuses every call.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Not authorized." }, { status: 401 });
  if (!embeddingsConfigured()) return Response.json({ skipped: "VOYAGE_API_KEY is not set." });
  try {
    const summary = await embedBacklog(cmsDb(), [...CMS_BRANDS], { limit: 500, budgetMs: 240_000 });
    if (summary.failures.length) console.error("Embedding catch-up failures:", summary.failures.slice(0, 20));
    return Response.json(summary);
  } catch (error) {
    console.error("Embedding catch-up failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Embedding catch-up failed." }, { status: 500 });
  }
}
