import "server-only";
import { CmsError } from "@/lib/cms/access";
import type { CmsBrand } from "@/lib/cms/types";
import type { NewsletterKind } from "./render";

/**
 * The bridge from the CMS to Braze. Each publication has an API-triggered
 * campaign per newsletter kind whose message uses Liquid variables
 * ({{trigger_properties.${subject}}} and so on); the CMS fills them per send.
 * Environment: BRAZE_REST_ENDPOINT (for example https://rest.iad-01.braze.com),
 * BRAZE_API_KEY, and BRAZE_CAMPAIGN_<BRAND>_<KIND> or BRAZE_CAMPAIGN_<BRAND>
 * or BRAZE_CAMPAIGN_ID as the campaign id fallback chain.
 */
export function brazeConfigured(): boolean {
  return Boolean(process.env.BRAZE_REST_ENDPOINT && process.env.BRAZE_API_KEY);
}

export function campaignIdFor(brand: CmsBrand, kind: NewsletterKind): string | null {
  const upperBrand = brand.toUpperCase(), upperKind = kind.toUpperCase();
  return process.env[`BRAZE_CAMPAIGN_${upperBrand}_${upperKind}`] || process.env[`BRAZE_CAMPAIGN_${upperBrand}`] || process.env.BRAZE_CAMPAIGN_ID || null;
}

export type DispatchInput = {
  brand: CmsBrand; kind: NewsletterKind; subject: string; preheader: string | null; html: string; text: string; url: string | null; title: string;
  sendAt: string | null; documentId: string;
};
export type DispatchResult = { campaign_id: string; dispatch_id: string | null; schedule_id: string | null; status: "sent" | "scheduled" };

export async function dispatchNewsletter(input: DispatchInput, signal?: AbortSignal): Promise<DispatchResult> {
  if (!brazeConfigured()) throw new CmsError(503, "The newsletter bridge needs BRAZE_REST_ENDPOINT and BRAZE_API_KEY on the server.", "setup_required");
  const campaignId = campaignIdFor(input.brand, input.kind);
  if (!campaignId) throw new CmsError(503, `No Braze campaign is configured for ${input.brand} ${input.kind}. Set BRAZE_CAMPAIGN_${input.brand.toUpperCase()}_${input.kind.toUpperCase()}.`, "setup_required");
  const endpoint = (process.env.BRAZE_REST_ENDPOINT as string).replace(/\/+$/, "");
  const triggerProperties = { subject: input.subject, preheader: input.preheader ?? "", title: input.title, html_body: input.html, text_body: input.text, url: input.url ?? "", document_id: input.documentId, kind: input.kind };
  const scheduled = Boolean(input.sendAt);
  const path = scheduled ? "/campaigns/trigger/schedule/create" : "/campaigns/trigger/send";
  const body = scheduled
    ? { campaign_id: campaignId, broadcast: true, trigger_properties: triggerProperties, schedule: { time: input.sendAt, in_local_time: false } }
    : { campaign_id: campaignId, broadcast: true, trigger_properties: triggerProperties };
  const response = await fetch(`${endpoint}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BRAZE_API_KEY}` }, body: JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({})) as { message?: string; dispatch_id?: string; schedule_id?: string; errors?: unknown };
  if (!response.ok || (data.message && data.message !== "success" && data.message !== "queued")) {
    throw new CmsError(502, `Braze did not accept the send: ${data.message || response.status}${data.errors ? ` ${JSON.stringify(data.errors).slice(0, 300)}` : ""}`, "esp_rejected");
  }
  return { campaign_id: campaignId, dispatch_id: data.dispatch_id ?? null, schedule_id: data.schedule_id ?? null, status: scheduled ? "scheduled" : "sent" };
}
