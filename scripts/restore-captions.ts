#!/usr/bin/env node
/**
 * Bring legacy captions and photo credits into the CMS. The lead caption comes
 * from the preserved Morweb custom field (custom_thumb_text); body captions
 * come from WordPress attachment wrappers and Morweb alt text. Bodies gain
 * <figure>/<figcaption> blocks, matching media records gain caption and
 * credit, and the lead is kept in metadata.lead_image. Dry-run by default.
 *
 *   node --import tsx scripts/restore-captions.ts --brand wa [--limit 20000]
 *   node --import tsx scripts/restore-captions.ts --brand wa --apply --development-target <host>
 */
import { parseArgs } from "node:util";
import { htmlToDocument } from "../src/lib/cms/blocks";
import { figureCaptions, restoreBodyCaptions, splitCredit, type Caption } from "../src/lib/cms/captions";
import { sanitizeCmsHtml } from "../src/lib/cms/html";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

type Row = { id: string; title: string; body_html: string; has_json: string | null; metadata: CmsJsonObject; revision: number };
const object = (value: unknown): CmsJsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as CmsJsonObject : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

export async function runRestoreCaptions(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "20000" }, after: { type: "string", default: "" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: restore-captions --brand wa [--limit N] [--after <document id>] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.max(1, Number(values.limit) || 20000);
  const reader = connectReader();
  const writer = connectTarget(values);
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, scanned: 0, documents_changed: 0, body_figures: 0, credits: 0, lead_captions: 0, media_captioned: 0, saved: 0, last_id: "", failures: [] as string[] };
  let after = values.after || "00000000-0000-0000-0000-000000000000";

  while (summary.scanned < limit) {
    let page: Row[] | null = null;
    for (let attempt = 0; attempt < 4 && !page; attempt++) {
      const { data, error } = await reader.from("cms_documents").select("id,title,body_html,has_json:body_json->>type,metadata,revision")
        .eq("brand", brand).gt("id", after).order("id").limit(100);
      if (!error) page = data as Row[]; else if (attempt === 3) throw new Error(`Could not read documents: ${error.message}`);
    }
    if (!page?.length) break;
    after = page[page.length - 1].id;
    const { data: snaps } = await reader.from("cms_source_snapshots")
      .select("document_id,cf:payload->source_payload->record->custom_fields->>custom_thumb_text,top:payload->source_payload->record->>custom_thumb_text")
      .in("document_id", page.map(row => row.id));
    const leadText = new Map<string, string>();
    for (const snap of (snaps ?? []) as { document_id: string; cf: string | null; top: string | null }[]) {
      const value = (snap.cf || snap.top || "").trim();
      if (value) leadText.set(snap.document_id, value);
    }

    const work = page.map(row => async () => {
      summary.scanned += 1;
      const metadata = row.metadata ?? {};
      const existingLead = object(metadata.lead_image);
      const source = leadText.get(row.id);
      const lead: Caption = source ? splitCredit(source) : { caption: text(existingLead.caption), credit: text(existingLead.credit) };
      const body = restoreBodyCaptions(row.body_html ?? "");
      const media = Array.isArray(metadata.media) ? (metadata.media as CmsJsonObject[]).map(item => ({ ...item })) : [];
      const captioned = [...body.images, ...figureCaptions(body.html)];
      let mediaChanged = false;
      media.forEach((item, index) => {
        const hit = captioned.find(image => image.src.includes(`/api/media/${row.id}/${index}`) || (item.source_url && image.src === item.source_url));
        const want = item.is_lead === true && (lead.caption || lead.credit) ? lead : hit;
        if (!want) return;
        if (!text(item.caption) && want.caption) { item.caption = want.caption; mediaChanged = true; summary.media_captioned += 1; }
        if (!text(item.credit) && want.credit) { item.credit = want.credit; mediaChanged = true; }
      });
      const legacyMedia = object(metadata.legacy_media);
      const leadImage = (lead.caption || lead.credit) ? { ...existingLead, source_url: text(existingLead.source_url) || text(legacyMedia.thumb_file) || text(legacyMedia.thumb), caption: lead.caption, credit: lead.credit } : null;
      const leadChanged = leadImage !== null && (leadImage.caption !== text(existingLead.caption) || leadImage.credit !== text(existingLead.credit) || leadImage.source_url !== text(existingLead.source_url));
      const bodyChanged = body.html !== row.body_html;
      if (!bodyChanged && !mediaChanged && !leadChanged) return;
      summary.documents_changed += 1;
      summary.body_figures += body.images.length;
      summary.credits += body.images.filter(image => image.credit).length + (leadChanged && lead.credit ? 1 : 0);
      if (leadChanged) summary.lead_captions += 1;
      if (!writer) return;
      const patch: CmsJsonObject = {};
      if (bodyChanged) {
        patch.body_html = body.html;
        if (row.has_json) patch.body_json = htmlToDocument(sanitizeCmsHtml(body.html)) as unknown as CmsJsonObject;
      }
      const meta: CmsJsonObject = {};
      if (mediaChanged) meta.media = media;
      if (leadChanged && leadImage) meta.lead_image = leadImage;
      if (Object.keys(meta).length) patch.metadata = meta;
      const { error } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: patch, p_actor: "caption-restore" });
      if (error) summary.failures.push(`${row.id}: ${error.message}`); else summary.saved += 1;
    });
    for (let i = 0; i < work.length; i += 6) await Promise.all(work.slice(i, i + 6).map(run => run()));
    summary.last_id = after;
    if (summary.scanned % 2000 < 100) console.error(`scanned ${summary.scanned}, changed ${summary.documents_changed}`);
  }
  log(JSON.stringify({ ...summary, failures: summary.failures.slice(0, 50), failure_count: summary.failures.length }, null, 2));
}

if (/(?:^|[/\\])restore-captions\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runRestoreCaptions(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Caption restore failed."); process.exitCode = 1; });
}
