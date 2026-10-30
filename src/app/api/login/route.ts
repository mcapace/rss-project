import { getAuthClient } from "@/lib/cms/auth-server";
import { assertSameOrigin, cmsPermissions, CmsError, readJson } from "@/lib/cms/access";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request, 16_000);
    if (typeof body.email !== "string" || typeof body.password !== "string" || body.email.length > 320 || body.password.length > 4096) throw new CmsError(400, "Enter your email and password.");
    const client = await getAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error || !data.user) throw new CmsError(401, "The email or password was not recognized.");
    try { cmsPermissions(data.user); }
    catch (accessError) { await client.auth.signOut(); throw accessError; }
    return cmsJson({ success: true });
  } catch (error) { return cmsFailure(error); }
}
