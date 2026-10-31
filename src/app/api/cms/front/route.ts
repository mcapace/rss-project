import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { FRONT_LABELS, FRONT_POSITIONS, resolveFront, setFrontSlot, type FrontLabel } from "@/lib/cms/front-server";
import { brandValue, isUuid } from "@/lib/cms/validation";

/** The five front positions as the site will show them, pinned and expired pins included for the editor. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const brand = brandValue(new URL(request.url).searchParams.get("brand") || user.brands[0]);
    assertBrand(user, brand);
    const slots = await resolveFront(brand, { includeExpired: true });
    return cmsJson({ brand, positions: FRONT_POSITIONS, labels: FRONT_LABELS, slots });
  } catch (error) { return cmsFailure(error); }
}

/** Pin a story into a position, or clear it: { brand, position, document_id | null, label?, ends_at? }. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const body = await readJson(request, 10_000);
    const brand = brandValue(body.brand);
    assertBrand(user, brand);
    const position = Number(body.position);
    const documentId = body.document_id == null || body.document_id === "" ? null : String(body.document_id);
    if (documentId && !isUuid(documentId)) throw new CmsError(422, "Invalid document.", "validation_failed");
    const label = body.label == null ? "" : String(body.label);
    if (!(label in FRONT_LABELS)) throw new CmsError(422, "Unknown label.", "validation_failed");
    let endsAt: string | null = null;
    if (body.ends_at) {
      const at = new Date(String(body.ends_at));
      if (Number.isNaN(at.getTime())) throw new CmsError(422, "The end time is not a date.", "validation_failed");
      endsAt = at.toISOString();
    }
    await setFrontSlot(brand, position, { documentId, label: label as FrontLabel, endsAt, actor: user.email });
    const slots = await resolveFront(brand, { includeExpired: true });
    return cmsJson({ brand, positions: FRONT_POSITIONS, labels: FRONT_LABELS, slots });
  } catch (error) { return cmsFailure(error); }
}
