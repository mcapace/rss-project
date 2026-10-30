import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { getIssueFeedXml } from "@/lib/feed-builder";
import { legacyFeedTarget, parseLegacyRss, readExternalRss } from "@/lib/legacy-rss";

export const runtime = "nodejs";

/** Authenticated compatibility reader. New CMS ingestion does not use this route. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const requestUrl = new URL(request.url);
    const target = legacyFeedTarget(requestUrl.searchParams.get("url"), requestUrl.origin);
    let xml: string;
    if (target.kind === "internal") {
      assertBrand(user, target.brand);
      const feed = await getIssueFeedXml(target.brand, target.issueId, requestUrl.origin);
      if (!feed) throw new CmsError(404, "This issue feed was not found or has not been published.");
      xml = feed;
    } else {
      xml = await readExternalRss(target.url);
    }
    return cmsJson(await parseLegacyRss(xml, target.url));
  } catch (error) { return cmsFailure(error); }
}
