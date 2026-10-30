import { CmsError } from "./access";
import { CMS_BRANDS, CMS_DOCUMENT_KINDS, CMS_PUBLICATION_STATES, type CmsBrand, type CmsDocument, type CmsDocumentPatch, type CmsJsonObject, type CmsReviewGate } from "./types";
import { sanitizeCmsHtml } from "./html";
import { validateOrganization } from "./organization";

export function textValue(value: unknown, name: string, max = 500, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new CmsError(422, `${name} must be ${required ? "nonempty " : ""}text of at most ${max.toLocaleString()} characters.`);
  }
  return value;
}

export function brandValue(value: unknown): CmsBrand {
  if (!CMS_BRANDS.includes(value as CmsBrand)) throw new CmsError(422, "Choose a supported publication.");
  return value as CmsBrand;
}

export function kindValue(value: unknown) {
  if (!CMS_DOCUMENT_KINDS.includes(value as typeof CMS_DOCUMENT_KINDS[number])) throw new CmsError(422, "Choose a supported content type.");
  return value as typeof CMS_DOCUMENT_KINDS[number];
}

export function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export function reviewGateValue(value: unknown): CmsReviewGate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CmsError(422, "Review details must be an object.");
  const gate = value as Record<string, unknown>;
  if (Object.keys(gate).some(key => key !== "required" && key !== "reasons") ||
    typeof gate.required !== "boolean" || !Array.isArray(gate.reasons) || gate.reasons.length > 100 ||
    gate.reasons.some(reason => typeof reason !== "string" || !/^[a-z][a-z0-9_]{0,119}$/.test(reason)) ||
    (gate.required && gate.reasons.length === 0)) {
    throw new CmsError(422, "Review details require a boolean flag and valid reason codes.");
  }
  return { required: gate.required, reasons: gate.reasons as string[] };
}

export function documentPatch(input: Record<string, unknown>, current?: Pick<CmsDocument, "metadata" | "publication_state">): CmsDocumentPatch {
  const result: CmsDocumentPatch = {};
  const allowed = ["title", "byline", "body_html", "excerpt", "slug", "public_url", "metadata", "publication_state"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new CmsError(422, "The update includes unsupported fields.");
  for (const [key, value] of Object.entries(input)) {
    if (key === "metadata") {
      if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 250_000) throw new CmsError(422, "Invalid document metadata.");
      const metadata = value as CmsJsonObject;
      if (metadata.review !== undefined) {
        const review = reviewGateValue(metadata.review);
        if (current?.metadata.review === undefined ||
          JSON.stringify(review) !== JSON.stringify(reviewGateValue(current.metadata.review))) {
          throw new CmsError(422, "Review requirements cannot be changed by an ordinary save.");
        }
      }
      if (metadata.organization !== undefined) {
        try { validateOrganization(metadata.organization); }
        catch (error) { throw new CmsError(422, error instanceof Error ? error.message : "Invalid content organization."); }
      }
      const rating = metadata.rating;
      if (rating !== null && rating !== undefined && (typeof rating !== "object" || Array.isArray(rating))) {
        throw new CmsError(422, "Rating details must be an object.");
      }
      if (rating && typeof rating === "object" && !Array.isArray(rating)) {
        if (rating.score !== null && rating.score !== undefined && (typeof rating.score !== "number" || !Number.isFinite(rating.score) || rating.score < 0 || rating.score > 100)) throw new CmsError(422, "A rating score must be between 0 and 100.");
        if (rating.price !== null && rating.price !== undefined && (typeof rating.price !== "number" || !Number.isFinite(rating.price) || rating.price < 0)) throw new CmsError(422, "A price must be a nonnegative number.");
      }
      result.metadata = metadata;
    } else if (key === "publication_state") {
      if (!CMS_PUBLICATION_STATES.includes(value as typeof CMS_PUBLICATION_STATES[number])) throw new CmsError(422, "Invalid publication state.");
      result.publication_state = value as typeof CMS_PUBLICATION_STATES[number];
    } else if (key === "slug" || key === "public_url") {
      const val = value === null || value === "" ? null : textValue(value, key, 2048);
      if (key === "slug" && val && (val.includes("?") || val.includes("#") || val.startsWith("/"))) throw new CmsError(422, "Use a slug without a leading slash, query, or fragment.");
      if (key === "public_url" && val && !/^https?:\/\//i.test(val)) throw new CmsError(422, "Use a full http or https public URL.");
      result[key] = val;
    } else if (key === "body_html") {
      result.body_html = sanitizeCmsHtml(textValue(value, "Article body", 1_500_000));
    } else if (key === "title") result.title = textValue(value, "Title", 500).trim();
    else if (key === "byline") result.byline = textValue(value, "Byline", 1000);
    else if (key === "excerpt") result.excerpt = textValue(value, "Summary", 5000);
  }
  const review = result.metadata?.review ?? current?.metadata.review;
  const requiresReview = review === undefined ? false : reviewGateValue(review).required;
  if (requiresReview && (result.publication_state ?? current?.publication_state) === "published") {
    throw new CmsError(422, "This content requires review before it can be published.");
  }
  if (result.title === "" && !requiresReview) throw new CmsError(422, "A title is required unless the record is retained for review.");
  return result;
}

export function printInput(input: Record<string, unknown>) {
  const brand = brandValue(input.brand);
  const issueId = textValue(input.issueId, "Issue ID", 80, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(issueId)) throw new CmsError(422, "Use letters, numbers, dashes, or underscores for the issue ID.");
  const issueLabel = textValue(input.issueLabel, "Issue label", 200, true).trim();
  const pdfKey = textValue(input.pdfKey, "PDF key", 300, true);
  const prefix = `pdfs/inbox/${brand}/${issueId}/`;
  const newKey = pdfKey.startsWith(prefix) && isUuid(pdfKey.slice(prefix.length, -4)) && pdfKey.endsWith(".pdf");
  if (!newKey && pdfKey !== `pdfs/inbox/${brand}-${issueId}.pdf`) throw new CmsError(422, "The PDF does not belong to this publication and issue.");
  const rawPages = Array.isArray(input.tocPages) ? input.tocPages : typeof input.tocPages === "string" ? input.tocPages.split(",").map(Number) : [3, 4];
  if (!rawPages.length || rawPages.length > 20 || rawPages.some(p => !Number.isInteger(p) || Number(p) < 1 || Number(p) > 2000)) throw new CmsError(422, "Choose between 1 and 20 valid table-of-contents page numbers.");
  return { brand, issueId, issueLabel, pdfKey, tocPages: [...new Set(rawPages as number[])] };
}
