import { getAuthClient } from "@/lib/cms/auth-server";
import { assertSameOrigin, CmsError } from "@/lib/cms/access";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const client = await getAuthClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new CmsError(502, "Sign-out could not be completed. Please try again.", "sign_out_failed");
    return cmsJson({ success: true });
  } catch (error) { return cmsFailure(error); }
}
