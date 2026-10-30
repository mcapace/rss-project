import { requireCmsUser } from "@/lib/cms/auth-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { getDocumentMigrationSources } from "@/lib/cms/migration-server";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireCmsUser();
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const result = await getDocumentMigrationSources(id, user, {
      page: Number(params.get("page") || 1), sourceId: params.get("source_id"),
    });
    const response = cmsJson(result);
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) { return cmsFailure(error); }
}
