import { getAuthClient, requireCmsUser } from "@/lib/cms/auth-server";
import { CmsError } from "@/lib/cms/access";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import type { RealtimeGrant } from "@/lib/editorial/platform-types";

const COLORS = ["#0e7c6f", "#3b74c4", "#b23a52", "#c96a1e", "#6d4bc9", "#2f9a6b", "#b8860b", "#c2185b"];

/**
 * What the browser needs to join a document's Realtime channel: the project
 * URL, the publishable key and the signed-in user's own access token (the
 * session cookie is httpOnly, so the token is handed over here, scoped to the
 * same user). Presence carries a display name and a stable color.
 */
export async function GET() {
  try {
    const user = await requireCmsUser();
    const client = await getAuthClient();
    const { data } = await client.auth.getSession();
    const session = data.session;
    if (!session?.access_token) throw new CmsError(401, "Please sign in to the CMS.", "sign_in_required");
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new CmsError(503, "Realtime is not configured.", "setup_required");
    const name = user.email.includes("@") ? user.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()) : user.email;
    const color = COLORS[[...user.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLORS.length];
    const grant: RealtimeGrant = { url, key, token: session.access_token, expires_at: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000, user: { id: user.id, name, color } };
    return cmsJson(grant);
  } catch (error) { return cmsFailure(error); }
}
