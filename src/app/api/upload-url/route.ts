import { randomUUID } from "node:crypto";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { brandValue, textValue } from "@/lib/cms/validation";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
import { createPresignedUploadUrl } from "@/lib/s3";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const input = await readJson(request, 16_000);
    const brand = brandValue(input.brand);
    assertBrand(user, brand);
    const issueId = textValue(input.issueId, "Issue ID", 80, true);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(issueId)) throw new CmsError(422, "Use letters, numbers, dashes, or underscores for the issue ID.");
    const pdfKey = `pdfs/inbox/${brand}/${issueId}/${randomUUID()}.pdf`;
    const uploadUrl = await createPresignedUploadUrl({ key: pdfKey, contentType: "application/pdf", expiresInSeconds: 900 });
    return cmsJson({ uploadUrl, pdfKey, uploadHeaders: { "Content-Type": "application/pdf", "If-None-Match": "*" } });
  } catch (error) { return cmsFailure(error); }
}
