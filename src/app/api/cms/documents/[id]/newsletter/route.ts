import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { sanitizeCmsHtml } from "@/lib/cms/html";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { canonicalPath } from "@/lib/cms/redirects";
import { brazeConfigured, dispatchNewsletter } from "@/lib/newsletter/braze-server";
import { NEWSLETTER_KINDS, renderNewsletterHtml, renderNewsletterText, type NewsletterKind } from "@/lib/newsletter/render";
import type { NewsletterSend } from "@/lib/editorial/platform-types";

type Context = { params: Promise<{ id: string }> };
const COLUMNS = "id,document_id,brand,kind,esp,status,subject,preheader,send_at,campaign_id,dispatch_id,error,requested_by,created_at,updated_at";

function setupGuard(error: { code?: string }) {
  if (error.code === "PGRST202" || error.code === "42P01") throw new CmsError(503, "The newsletter log is not set up yet: apply the cms_blocks_redirects_delivery migration.", "setup_required");
  databaseError(error);
}

/** Dispatch history for this story. */
export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireCmsUser();
    const { id } = await context.params;
    await getCmsDocument(id, user);
    const { data, error } = await cmsDb().from("cms_newsletter_sends").select(COLUMNS).eq("document_id", id).order("created_at", { ascending: false }).limit(50);
    if (error) setupGuard(error);
    return cmsJson({ sends: (data ?? []) as NewsletterSend[], configured: brazeConfigured() });
  } catch (error) { return cmsFailure(error); }
}

/**
 * Mark a story as a Daily Alert (or another kind): render the email from the
 * saved story and push it to the ESP. Every attempt is logged; when the ESP is
 * not configured the send is recorded as simulated so the flow can be tested.
 */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const { id } = await context.params;
    const document = await getCmsDocument(id, user);
    const body = await readJson(request, 20_000);
    const kind = body.kind;
    if (!(NEWSLETTER_KINDS as readonly string[]).includes(String(kind))) throw new CmsError(422, "Choose a newsletter kind.", "validation_failed");
    const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 300) : "";
    if (!subject) throw new CmsError(422, "A subject line is required.", "validation_failed");
    const preheader = typeof body.preheader === "string" ? body.preheader.trim().slice(0, 300) || null : null;
    const sendAt = typeof body.send_at === "string" && body.send_at ? new Date(body.send_at) : null;
    if (sendAt && (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() - 60_000)) throw new CmsError(422, "The send time must be in the future.", "validation_failed");
    if (document.publication_state !== "published" && !sendAt && document.metadata.review && typeof document.metadata.review === "object" && (document.metadata.review as { required?: boolean }).required) {
      throw new CmsError(422, "This story still needs review before it can go out.", "validation_failed");
    }

    const site = (process.env.PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    const path = canonicalPath(document);
    const url = document.public_url ?? (site && path ? `${site}${path}` : null);
    const section = typeof document.metadata.section === "string" ? document.metadata.section : "";
    const input = { brand: document.brand, kind: kind as NewsletterKind, subject, preheader, title: document.title, byline: document.byline, excerpt: document.excerpt, section, html: sanitizeCmsHtml(document.body_html), url };
    const html = renderNewsletterHtml(input);
    const text = renderNewsletterText(input);

    const db = cmsDb();
    const { data: queued, error: insertError } = await db.from("cms_newsletter_sends").insert({ document_id: id, brand: document.brand, kind, subject, preheader, send_at: sendAt?.toISOString() ?? null, requested_by: user.id, status: "queued" }).select(COLUMNS).single();
    if (insertError) setupGuard(insertError);
    const row = queued as NewsletterSend;

    let update: Partial<NewsletterSend>;
    if (!brazeConfigured()) {
      update = { status: "simulated", error: "ESP not configured: the email was rendered and logged but not sent." };
    } else {
      try {
        const result = await dispatchNewsletter({ brand: document.brand, kind: kind as NewsletterKind, subject, preheader, html, text, url, title: document.title, sendAt: sendAt?.toISOString() ?? null, documentId: id }, request.signal);
        update = { status: result.status, campaign_id: result.campaign_id, dispatch_id: result.dispatch_id ?? result.schedule_id, error: null };
      } catch (failure) {
        update = { status: "failed", error: failure instanceof Error ? failure.message : "The ESP rejected the send." };
      }
    }
    const { data: saved, error: updateError } = await db.from("cms_newsletter_sends").update({ ...update, updated_at: new Date().toISOString() }).eq("id", row.id).select(COLUMNS).single();
    if (updateError) databaseError(updateError);
    const send = saved as NewsletterSend;
    return cmsJson({ send, preview_html: html }, send.status === "failed" ? 502 : 201);
  } catch (error) { return cmsFailure(error); }
}
