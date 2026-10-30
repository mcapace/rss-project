import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { CmsError, cmsPermissions } from "./access";
import { connectedCmsEnabled } from "./runtime-config";

export function authConfiguration() {
  if (!connectedCmsEnabled()) return null;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export async function getAuthClient() {
  if (!connectedCmsEnabled()) throw new CmsError(503, "Connected CMS access is disabled in this preview.", "preview_disabled");
  const configuration = authConfiguration();
  if (!configuration) throw new CmsError(503, "CMS sign-in has not been connected yet.", "setup_required");
  const cookieStore = await cookies();
  return createServerClient(configuration.url, configuration.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try { for (const { name, value, options } of values) cookieStore.set(name, value, options); }
        catch { /* Server components read only; proxy refreshes the session. */ }
      },
    },
  });
}

export async function requireCmsUser() {
  const auth = await getAuthClient();
  // Always obtain a verified, current user record; never authorize from a cookie payload.
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) throw new CmsError(401, "Please sign in to the CMS.", "sign_in_required");
  return cmsPermissions(data.user);
}
