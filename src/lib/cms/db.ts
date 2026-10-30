import "server-only";
import { createClient } from "@supabase/supabase-js";
import { CmsError } from "./access";

export function cmsDb() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new CmsError(503, "The CMS workspace has not been connected yet.", "setup_required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === "P0002") throw new CmsError(404, "The requested content could not be found.", "not_found");
  if (error.code === "23505") throw new CmsError(409, "That URL or source record already belongs to another document.", "duplicate_record");
  if (error.code === "40001" || error.message?.includes("revision_conflict")) {
    throw new CmsError(409, "Another editor saved a newer version. Reload before saving your changes.", "revision_conflict");
  }
  if (["42P01", "PGRST202", "PGRST205"].includes(error.code || "")) {
    throw new CmsError(503, "The CMS database upgrade has not been applied yet.", "setup_required");
  }
  if (error.code === "22023" || error.code === "23514") throw new CmsError(422, "The document did not pass content validation.", "validation_failed");
  throw new CmsError(500, "The CMS could not complete this request. Please try again.");
}
