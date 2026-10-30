// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDocuments, demoRevision } from "@/lib/cms/demo";
import type { CmsDocument, CmsDocumentPatch } from "@/lib/cms/types";
import { DocumentEditor, type HistoryData } from "../DocumentEditor";

vi.mock("../RichEditor", () => ({ RichEditor: ({ html, onChange }: { html: string; onChange: (html: string) => void }) => <textarea aria-label="Test story body" value={html} onChange={event => onChange(event.target.value)} /> }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

async function enter(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === text)!;
  expect(button, `Missing button ${text}`).toBeTruthy();
  await act(async () => button.click());
}

describe("document editing preserves unsaved work", () => {
  it("keeps changes made while a save response is pending and saves them against the new revision", async () => {
    const initial = demoDocuments()[0];
    let finish!: (document: CmsDocument) => void;
    const pending = new Promise<CmsDocument>(resolve => { finish = resolve; });
    const save = vi.fn(async (patch: CmsDocumentPatch) => { void patch; return pending; });
    function Harness() {
      const [document, setDocument] = useState(initial);
      return <DocumentEditor document={document} demo onClose={() => {}} onDirtyChange={() => {}} loadHistory={async () => ({ revisions: [], sources: [] })} onSave={async patch => { const next = await save(patch); setDocument(next); return next; }} />;
    }
    await act(async () => root.render(<Harness />));
    await enter("#document-title", "First edit sent to server");
    await click("Save changes");
    await enter("#document-title", "Newer edit typed during save");
    await enter('[aria-label="Test story body"]', "<p>Newer body typed during save.</p>");
    await act(async () => finish({ ...initial, title: "First edit sent to server", revision: 2 }));
    expect(host.querySelector<HTMLTextAreaElement>("#document-title")!.value).toBe("Newer edit typed during save");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Test story body"]')!.value).toBe("<p>Newer body typed during save.</p>");
    expect(host.textContent).toContain("Unsaved changes");
    await click("Save changes");
    expect(save.mock.calls[1][0]).toMatchObject({ title: "Newer edit typed during save", body_html: "<p>Newer body typed during save.</p>" });
  });

  it("accepts topic edits while retaining original source categories and tags", async () => {
    const initial = demoDocuments()[0];
    const save = vi.fn(async (patch: CmsDocumentPatch) => ({ ...initial, ...patch, revision: 2 }));
    await act(async () => root.render(<DocumentEditor document={initial} demo onClose={() => {}} onDirtyChange={() => {}} loadHistory={async () => ({ revisions: [], sources: [] })} onSave={save} />));
    const categories = [...host.querySelectorAll("label")].find(item => item.textContent === "Topics")!.querySelector("input")!;
    categories.id = "test-categories";
    await enter("#test-categories", "News, Whisky ");
    expect(categories.value).toBe("News, Whisky ");
    await enter("#test-categories", "News, Whisky Life, ");
    expect(categories.value).toBe("News, Whisky Life, ");
    await click("Save changes");
    expect(save.mock.calls[0][0].metadata?.organization).toMatchObject({ topics: ["News", "Whisky Life"], primary_channel: null });
    expect(save.mock.calls[0][0].metadata?.categories).toEqual(initial.metadata.categories);
    expect(save.mock.calls[0][0].metadata?.tags).toEqual(initial.metadata.tags);
  });

  it("requires confirmation before source text replaces an unsaved draft", async () => {
    const initial = demoDocuments()[0];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const history: HistoryData = { revisions: [], sources: [{ id: "synthetic-update", source_hash: "a".repeat(64), created_at: initial.created_at, is_candidate: true, title: "Incoming source title", byline: "Source byline", body_html: "<p>Incoming source body.</p>", metadata: {} }] };
    await act(async () => root.render(<DocumentEditor document={initial} demo onClose={() => {}} onDirtyChange={() => {}} loadHistory={async () => history} onSave={async () => initial} />));
    await enter("#document-title", "Unsaved reporting");
    await click("Source updates");
    await click("Use this text");
    expect(confirm).toHaveBeenCalledOnce();
    expect(host.querySelector<HTMLTextAreaElement>("#document-title")!.value).toBe("Unsaved reporting");
    confirm.mockReturnValue(true);
    await click("Use this text");
    expect(host.querySelector<HTMLTextAreaElement>("#document-title")!.value).toBe("Incoming source title");
    expect(host.textContent).toContain("Unsaved changes");
  });

  it("keeps a placement visible while its schedule is incomplete and validates only on save", async () => {
    const initial = demoDocuments()[3];
    const save = vi.fn(async (patch: CmsDocumentPatch) => ({ ...initial, ...patch, revision: 2 }));
    await act(async () => root.render(<DocumentEditor document={initial} demo onClose={() => {}} onDirtyChange={() => {}} loadHistory={async () => ({ revisions: [], sources: [] })} onSave={save} />));
    await click("Add homepage placement");
    await act(async () => {
      const status = host.querySelector<HTMLSelectElement>('[aria-label="Homepage slider status"]')!;
      status.value = "scheduled";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector('[aria-label="Homepage slider start UTC"]')).not.toBeNull();
    await click("Save changes");
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("both a start and an end");
    await enter('[aria-label="Homepage slider start UTC"]', "2026-10-30T18:00");
    await enter('[aria-label="Homepage slider end UTC"]', "2026-10-29T18:00");
    await click("Save changes");
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('[aria-label="Homepage slider end UTC"]')!.value).toBe("2026-10-29T18:00");
    await enter('[aria-label="Homepage slider end UTC"]', "2026-11-02T18:00");
    await click("Save changes");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].metadata?.organization).toMatchObject({ primary_channel: null, placements: [{ status: "scheduled", starts_at: "2026-10-30T18:00:00Z", ends_at: "2026-11-02T18:00:00Z" }] });
    expect(save.mock.calls[0][0].metadata?.categories).toEqual(initial.metadata.categories);
    expect(save.mock.calls[0][0]).not.toHaveProperty("public_url");
    expect(save.mock.calls[0][0]).not.toHaveProperty("publication_state");
  });

  it("requires confirmation before a saved revision replaces unsaved metadata and text", async () => {
    const initial = { ...demoDocuments()[0], revision: 2 };
    const historical = { ...initial, revision: 1, title: "Earlier headline", metadata: { tags: ["Archive"] } };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const history: HistoryData = { revisions: [demoRevision(historical)], sources: [] };
    await act(async () => root.render(<DocumentEditor document={initial} demo onClose={() => {}} onDirtyChange={() => {}} loadHistory={async () => history} onSave={async () => initial} />));
    await enter("#document-title", "Unsaved reporting");
    await click("History");
    await act(async () => host.querySelector<HTMLButtonElement>(".cms-history-list button")!.click());
    await click("Restore this version as an edit");
    expect(host.querySelector<HTMLTextAreaElement>("#document-title")!.value).toBe("Unsaved reporting");
    confirm.mockReturnValue(true);
    await click("Restore this version as an edit");
    expect(host.querySelector<HTMLTextAreaElement>("#document-title")!.value).toBe("Earlier headline");
    expect(host.textContent).toContain("Unsaved changes");
  });
});
