import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { printInput } from "@/lib/cms/validation";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
import { verifyPdfUpload } from "@/lib/s3";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const input = printInput(await readJson(request, 16_000));
    assertBrand(user, input.brand);
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;
    const workflowRef = process.env.GITHUB_WORKFLOW_REF;
    if (!githubToken || !githubRepo || !workflowRef) throw new CmsError(503, "Print processing has not been connected yet.", "setup_required");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) throw new CmsError(503, "The print worker repository needs configuration.", "setup_required");
    await verifyPdfUpload(input.pdfKey);
    const db = cmsDb();
    const { data: issue, error } = await db.rpc("cms_queue_issue", {
      p_brand: input.brand, p_issue_id: input.issueId, p_issue_label: input.issueLabel,
      p_pdf_key: input.pdfKey, p_toc_pages: input.tocPages,
    });
    if (error) {
      if (error.message?.includes("already active or published")) throw new CmsError(409, "This issue is already processing or was published through the previous workflow.");
      databaseError(error);
    }
    try {
      const dispatched = await fetch(`https://api.github.com/repos/${githubRepo}/actions/workflows/process-issue.yml/dispatches`, {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mshanken-cms" },
        body: JSON.stringify({ ref: workflowRef, inputs: { issue_uuid: issue.id, intake_token: issue.cms_intake_token, brand: input.brand, issue_id: input.issueId, pdf_key: input.pdfKey, toc_pages: input.tocPages.join(",") } }),
      });
      if (!dispatched.ok) throw new Error(`Worker dispatch failed (${dispatched.status}).`);
    } catch {
      // Revoke this attempt's lease. A delayed worker cannot commit after a failed dispatch.
      const { data: revoked, error: revokeError } = await db.from("issues")
        .update({ status: "failed", error: "The processing request could not be confirmed. Retry to start a new attempt.", cms_intake_token: crypto.randomUUID() })
        .eq("id", issue.id).eq("cms_intake_token", issue.cms_intake_token)
        .in("status", ["queued", "processing"]).select("id").maybeSingle();
      if (revokeError) {
        throw new CmsError(503, "The worker request could not be confirmed and its issue status could not be updated. Check the issue before retrying.", "dispatch_state_unknown");
      }
      if (!revoked) {
        throw new CmsError(502, "The worker request could not be confirmed, and the issue has already changed. Reload the issue before retrying.", "dispatch_state_changed");
      }
      throw new CmsError(502, "The worker request could not be confirmed. This attempt is marked failed and is ready to retry.", "dispatch_failed");
    }
    return cmsJson({ issueUuid: issue.id, status: "queued" }, 202);
  } catch (error) { return cmsFailure(error); }
}
