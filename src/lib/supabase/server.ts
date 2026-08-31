import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database } from "./types";

/**
 * Server-only Supabase client initialized with the SERVICE ROLE key.
 * This client bypasses Row Level Security (RLS) and must NEVER be imported
 * into client components or exposed in public bundles.
 */
let serviceClientInstance: SupabaseClient<Database> | null = null;

export function getServiceSupabase(): SupabaseClient<Database> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL environment variable."
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY environment variable on server."
    );
  }

  if (!serviceClientInstance) {
    serviceClientInstance = createClient<Database>(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
  }

  return serviceClientInstance;
}

/**
 * Public/Anon client helper for read-only public routes (e.g. public feed endpoints).
 * Respects Row Level Security (RLS).
 */
export function getAnonSupabase(): SupabaseClient<Database> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Missing Supabase URL or Anon key environment variables."
    );
  }

  return createClient<Database>(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
    },
  });
}
