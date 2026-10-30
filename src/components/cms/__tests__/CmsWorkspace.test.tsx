// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDocuments } from "@/lib/cms/demo";
import type { CmsDocument, CmsDocumentPatch } from "@/lib/cms/types";
import { CmsWorkspace } from "../CmsWorkspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, onNavigate, ...props }: { href: string; children: ReactNode; onNavigate?: (event: { preventDefault: () => void }) => void }) => <a href={href} {...props} onClick={event => { onNavigate?.(event); event.preventDefault(); }}>{children}</a> }));
vi.mock("../DocumentEditor", () => ({ DocumentEditor: ({ document, onSave, onClose, onDirtyChange }: { document: CmsDocument; onSave: (patch: CmsDocumentPatch) => Promise<CmsDocument>; onClose: () => void; onDirtyChange: (value: boolean) => void }) => <div data-testid="editor"><h1>{document.title}</h1><button onClick={() => { onDirtyChange(true); void onSave({ title: "Saved synthetic headline" }); }}>Test save</button><button onClick={onClose}>Test close</button></div> }));

let host: HTMLDivElement;
let root: Root;
const sample = demoDocuments()[0];
const user = { id: "synthetic-user", email: "editor@example.test", role: "editor" as const, brands: ["wa", "ws"] as const };
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(finish => { resolve = finish; }); return { promise, resolve }; }
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/cms");
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<CmsWorkspace user={{ ...user, brands: [...user.brands] }} />)); }
async function open() { await act(async () => host.querySelector<HTMLButtonElement>(".cms-story-link")!.click()); }
async function navigation(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>(".cms-navigation button")].find(item => item.textContent?.startsWith(text))!;
  await act(async () => button.click());
}

describe("workspace asynchronous selection", () => {
  it("does not reopen an editor after its save finishes in the background", async () => {
    const save = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("/overview?")) return response({ total: 1, review: 1, drafts: 0, ratings: 0 });
      if (options?.method === "PATCH") return save.promise;
      if (url.includes("/documents?")) return response({ documents: [sample], total: 1 });
      return response({ document: sample });
    }));
    await mount(); await open();
    await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "Test save")!.click());
    await navigation("Content library");
    expect(host.querySelector('[data-testid="editor"]')).toBeNull();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("save is still in progress"));
    await act(async () => save.resolve(response({ document: { ...sample, title: "Saved synthetic headline", revision: 2 } })));
    expect(host.querySelector('[data-testid="editor"]')).toBeNull();
  });

  it("ignores a document response when navigation canceled the open request", async () => {
    const detail = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/overview?")) return response({ total: 1, review: 1, drafts: 0, ratings: 0 });
      if (url.includes("/documents?")) return response({ documents: [sample], total: 1 });
      return detail.promise;
    }));
    await mount(); await open();
    await navigation("Ratings");
    await act(async () => detail.resolve(response({ document: sample })));
    expect(host.querySelector('[data-testid="editor"]')).toBeNull();
    expect(host.querySelector("h1")!.textContent).toBe("Ratings");
  });

  it("does not replace a new publication's results with an older request", async () => {
    const whiskyList = deferred<Response>();
    const wineList = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/overview?")) return response({ total: 1, review: 1, drafts: 0, ratings: 0 });
      return url.includes("brand=ws") ? wineList.promise : whiskyList.promise;
    }));
    await mount();
    await act(async () => { const select = host.querySelector<HTMLSelectElement>("#cms-brand")!; select.value = "ws"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => wineList.resolve(response({ documents: [{ ...sample, brand: "ws", title: "Wine sample result" }], total: 1 })));
    expect(host.textContent).toContain("Wine sample result");
    await act(async () => whiskyList.resolve(response({ documents: [{ ...sample, title: "Stale whisky result" }], total: 1 })));
    expect(host.textContent).toContain("Wine sample result");
    expect(host.textContent).not.toContain("Stale whisky result");
    expect(new URLSearchParams(window.location.search).get("brand")).toBe("ws");
    expect(host.querySelector<HTMLAnchorElement>('.cms-navigation a[href^="/admin?"]')?.getAttribute("href")).toBe("/admin?brand=ws");
    expect(host.querySelector<HTMLAnchorElement>('.cms-navigation a[href^="/admin/new?"]')?.getAttribute("href")).toBe("/admin/new?brand=ws");
  });

  it("restores an authorized publication from a direct URL and limits the selector to that user's access", async () => {
    const fetchMock = vi.fn(async (_url: string) => response({ documents: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CmsWorkspace user={{ ...user, brands: ["ws"] }} initialBrand="ca" />));
    const selector = host.querySelector<HTMLSelectElement>("#cms-brand")!;
    expect(selector.value).toBe("ws");
    expect([...selector.options].map(option => option.value)).toEqual(["ws"]);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("brand=ws"))).toBe(true);
    expect(window.location.search).toBe("?brand=ws");
  });

  it("shows a separate empty demo library for a new publication and restores the Whisky Advocate examples on return", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await act(async () => root.render(<CmsWorkspace demo />));
    const selector = host.querySelector<HTMLSelectElement>("#cms-brand")!;
    expect([...selector.options].map(option => option.value)).toEqual(["wa", "ws", "ca", "mw"]);
    expect(host.querySelectorAll(".cms-story-link").length).toBeGreaterThan(0);
    expect(host.querySelector<HTMLAnchorElement>(".cms-demo-banner a")?.getAttribute("href")).toBe("/cms?brand=wa");
    await act(async () => { selector.value = "ws"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll(".cms-story-link")).toHaveLength(0);
    expect(host.querySelector(".cms-metric strong")?.textContent).toBe("0");
    expect(host.querySelector(".cms-breadcrumb")?.textContent).toContain("Wine Spectator");
    expect(host.querySelector<HTMLAnchorElement>(".cms-demo-banner a")?.getAttribute("href")).toBe("/cms?brand=ws");
    await act(async () => { selector.value = "wa"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll(".cms-story-link").length).toBeGreaterThan(0);
    expect(host.querySelector<HTMLAnchorElement>(".cms-demo-banner a")?.getAttribute("href")).toBe("/cms?brand=wa");
    expect(fetch).not.toHaveBeenCalled();
  });
});
