// @vitest-environment jsdom
import { act, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsBrand } from "@/lib/cms/types";
import { EditorialProvider } from "../EditorialProvider";
import { UploadIssue } from "../UploadIssue";
import { IssueStatus } from "../IssueStatus";
import { LegacyReader } from "../LegacyReader";
import AdminIssuesPage from "@/app/admin/page";

const mocks = vi.hoisted(() => ({ push: vi.fn(), redirect: vi.fn() }));

function navigate(url: string) {
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event("test:navigation"));
}
function useLocation() {
  return useSyncExternalStore(
    listener => { window.addEventListener("test:navigation", listener); return () => window.removeEventListener("test:navigation", listener); },
    () => `${window.location.pathname}${window.location.search}`,
  );
}
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: navigate, refresh: () => {} }),
  usePathname: () => useLocation().split("?")[0],
  useSearchParams: () => new URLSearchParams(useLocation().split("?")[1] ?? ""),
  redirect: (url: string) => { mocks.redirect(url); throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props} onClick={event => event.preventDefault()}>{children}</a> }));

const issueUuid = "10000000-0000-4000-8000-000000000001";
const wineIssue = { id: issueUuid, brand: "ws", issue_id: "synthetic-wine", issue_label: "Wine sample issue", pdf_key: "synthetic.pdf", toc_pages: [3, 4], status: "review", stats: null, error: null, articleCount: 3, created_at: "2026-10-30T12:00:00Z", feedUrl: null };
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function list(issues: unknown[]) { return response({ issues, total: issues.length, limit: 100 }); }

let host: HTMLDivElement;
let root: Root;
let allowedBrands: CmsBrand[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  allowedBrands = ["wa", "ws"];
  navigate("/cms/print?brand=ws");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async (url: string) => {
    if (url === `/api/issues/${issueUuid}`) return response({ issue: wineIssue, articleCount: 3, imageCount: 12, feedUrl: null });
    if (url === "/api/issues?brand=ws") return list([wineIssue]);
    if (url === "/api/issues?brand=wa") return list([]);
    throw new Error(`Unexpected offline request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mount(content: ReactNode) {
  const user = { id: "editor", email: "editor@example.com", role: "editor" as const, brands: allowedBrands };
  await act(async () => root.render(<EditorialProvider user={user} demo={false}><Suspense fallback={<p>Loading…</p>}>{content}</Suspense></EditorialProvider>));
  await act(async () => { await Promise.resolve(); });
}
function radio(name: string) { return [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(button => button.textContent?.endsWith(name)); }
function link(label: string) { return [...host.querySelectorAll<HTMLAnchorElement>("a")].find(anchor => anchor.textContent?.trim() === label); }
async function enter(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("issue inbox", () => {
  it("sends /admin to Print intake with its publication", async () => {
    await expect(AdminIssuesPage({ searchParams: Promise.resolve({ brand: "ws" }) })).rejects.toThrow("REDIRECT:/cms/print?brand=ws");
    await expect(AdminIssuesPage({ searchParams: Promise.resolve({ brand: "nope" }) })).rejects.toThrow("REDIRECT:/cms/print");
  });
});

describe("upload an issue", () => {
  it("offers only assigned publications, keeps typed details when switching, and links back in scope", async () => {
    navigate("/admin/new?brand=ws");
    await mount(<UploadIssue />);
    expect(radio("Wine Spectator")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("Cigar Aficionado")).toBeUndefined();
    expect(link("Print intake")?.getAttribute("href")).toBe("/cms/print?brand=ws");
    await enter("#issue-id", "synthetic-fall");
    await enter("#issue-name", "Synthetic fall issue");
    await act(async () => radio("Whisky Advocate")!.click());
    expect(window.location.search).toBe("?brand=wa");
    expect(radio("Whisky Advocate")?.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("#issue-id")!.value).toBe("synthetic-fall");
    expect(host.querySelector<HTMLInputElement>("#issue-name")!.value).toBe("Synthetic fall issue");
    expect(link("Print intake")?.getAttribute("href")).toBe("/cms/print?brand=wa");
    expect(link("Cancel")?.getAttribute("href")).toBe("/cms/print?brand=wa");
  });

  it("falls back to an assigned publication when the URL names another", async () => {
    allowedBrands = ["ws"];
    navigate("/admin/new?brand=ca");
    await mount(<UploadIssue />);
    expect(radio("Wine Spectator")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("Whisky Advocate")).toBeUndefined();
    expect(radio("Cigar Aficionado")).toBeUndefined();
    expect(link("Print intake")?.getAttribute("href")).toBe("/cms/print?brand=ws");
  });
});

describe("issue status", () => {
  it("adopts the issue's publication and links to its candidates", async () => {
    navigate(`/admin/${issueUuid}?brand=wa`);
    await mount(<IssueStatus issueId={issueUuid} />);
    expect(fetchMock).toHaveBeenCalledWith(`/api/issues/${issueUuid}`, expect.anything());
    expect(host.textContent).toContain("Wine sample issue");
    expect(window.location.search).toBe("?brand=ws");
    expect(link("Print intake")?.getAttribute("href")).toBe("/cms/print?brand=ws");
    const review = new URL(link("Review candidates")!.href);
    expect(review.pathname).toBe("/cms/library");
    expect(review.searchParams.get("brand")).toBe("ws");
    expect(review.searchParams.get("issue")).toBe(issueUuid);
  });

  it("shows a load failure with a retry instead of an empty issue", async () => {
    fetchMock.mockResolvedValue(response({ error: "Issue unavailable right now." }, 503));
    navigate(`/admin/${issueUuid}?brand=ws`);
    await mount(<IssueStatus issueId={issueUuid} />);
    expect(host.textContent).toContain("Issue unavailable right now.");
    expect(host.textContent).toContain("Try again");
  });
});

describe("legacy editions", () => {
  it("loads only the assigned publication's catalog and keeps links in scope", async () => {
    allowedBrands = ["ws"];
    navigate("/reader?brand=ca");
    await mount(<LegacyReader />);
    expect(fetchMock).toHaveBeenCalledWith("/api/issues?brand=ws", expect.anything());
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/issues" || url === "/api/issues?brand=ca")).toBe(false);
    expect(link("Upload an issue")?.getAttribute("href")).toBe("/admin/new?brand=ws");
  });

  it("clears a loaded edition when the publication changes", async () => {
    navigate("/reader?brand=ws");
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/issues?brand=ws") return list([{ ...wineIssue, status: "published", feedUrl: "/api/feeds/ws/synthetic/feed.xml" }]);
      if (url === "/api/issues?brand=wa") return list([]);
      if (url.startsWith("/api/feed?")) return response({ title: "Wine legacy edition", items: [{ title: "Wine legacy story" }] });
      throw new Error(`Unexpected offline request: ${url}`);
    });
    await mount(<LegacyReader />);
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("Wine legacy edition");
    expect(host.textContent).toContain("Wine legacy story");
    await act(async () => navigate("/reader?brand=wa"));
    expect(fetchMock).toHaveBeenCalledWith("/api/issues?brand=wa", expect.anything());
    expect(host.textContent).not.toContain("Wine legacy edition");
    expect(host.textContent).not.toContain("Wine legacy story");
    expect(link("Upload an issue")?.getAttribute("href")).toBe("/admin/new?brand=wa");
  });

  it("shows catalog failures instead of an empty publication", async () => {
    navigate("/reader?brand=ws");
    fetchMock.mockResolvedValue(response({ error: "Catalog unavailable." }, 503));
    await mount(<LegacyReader />);
    expect(host.textContent).toContain("Catalog unavailable.");
    expect(host.textContent).not.toContain("No published editions");
  });
});
