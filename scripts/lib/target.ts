/**
 * Shared guard for the platform scripts: dry-run by default, writes only to a
 * development database named twice (environment plus an explicit flag), the
 * same rule the Morweb importer follows. The scripts never load .env files.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function connectTarget(flags: { apply?: boolean; "development-target"?: string }, env: NodeJS.ProcessEnv = process.env): SupabaseClient | null {
  if (!flags.apply) return null;
  const target = env.CMS_IMPORT_SUPABASE_URL;
  const serviceKey = env.CMS_IMPORT_SERVICE_ROLE_KEY;
  if (!target || !serviceKey) throw new Error("Apply requires dedicated CMS_IMPORT_SUPABASE_URL and CMS_IMPORT_SERVICE_ROLE_KEY environment variables.");
  let url: URL;
  try { url = new URL(target); } catch { throw new Error("CMS_IMPORT_SUPABASE_URL is not a valid URL."); }
  if (!flags["development-target"] || flags["development-target"] !== url.hostname) throw new Error("--development-target must explicitly match the dedicated development database hostname.");
  if (url.username || url.password || (url.protocol !== "https:" && !(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.protocol === "http:"))) throw new Error("Use HTTPS for a remote development database, or HTTP on loopback only.");
  return createClient(target, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Reading needs the same credentials but no --apply; the dry run still inspects real rows. */
export function connectReader(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  const target = env.CMS_IMPORT_SUPABASE_URL;
  const serviceKey = env.CMS_IMPORT_SERVICE_ROLE_KEY;
  if (!target || !serviceKey) throw new Error("Set CMS_IMPORT_SUPABASE_URL and CMS_IMPORT_SERVICE_ROLE_KEY to read the content database.");
  return createClient(target, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function brandFlag(value: string | undefined): "wa" | "ws" | "ca" | "mw" {
  if (!["wa", "ws", "ca", "mw"].includes(value ?? "")) throw new Error("--brand must be wa, ws, ca, or mw.");
  return value as "wa" | "ws" | "ca" | "mw";
}
