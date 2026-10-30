// @vitest-environment jsdom
import { act, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsBrand } from "@/lib/cms/types";
import AdminIssuesPage from "../page";
import NewIssuePage from "../new/page";
import IssueStatusPage from "../[issueUuid]/page";
import FeedReaderPage from "../../reader/page";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (listener) => { window.addEventListener("test:navigation", listener); return () => window.removeEventListener("test:navigation", listener); },
      () => window.location.search,
    );
    return new URLSearchParams(search);
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props} onClick={(event) => event.preventDefault()}>{children}</a> }));

const issueUuid = "10000000-0000-4000-8000-000000000001";
const wineIssue = { id: issueUuid, brand: "ws", issue_id: "synthetic-wine", issue_label: "Wine sample issue", status: "review", articleCount: 3, created_at: "2026-10-30T12:00:00Z" };
const whiskyIssue = { ...wineIssue, id: "10000000-0000-4000-8000-000000000002", brand: "wa", issue_id: "synthetic-whisky", issue_label: "Whisky sample issue" };
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function list(issues: unknown[]) { return response({ issues, total: issues.length, limit: 100 }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }

let host: HTMLDivElement;
let root: Root;
let allowedBrands: CmsBrand[];
let fetchMock: ReturnType<typeof vi.fn>;
let cache: Cache;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  allowedBrands = ["wa", "ws"];
  cache = new Map();
  const replaceState = window.history.replaceState.bind(window.history);
  replaceState(null, "", "/admin?brand=ws");
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
    replaceState(data, unused, url);
    window.dispatchEvent(new Event("test:navigation"));
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/cms/session") return response({ user: { brands: allowedBrands } });
    if (url === `/api/issues/${issueUuid}`) return response({ issue: { ...wineIssue, pdf_key: "synthetic.pdf" }, articleCount: 3 });
    if (url === "/api/issues?brand=ws") return list([wineIssue]);
    if (url === "/api/issues?brand=wa") return list([whiskyIssue]);
    if (url === "/api/issues") return list([whiskyIssue, wineIssue]);
    throw new Error(`Unexpected offline request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mount(content: ReactNode) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => cache, shouldRetryOnError: false, revalidateOnFocus: false }}><Suspense fallback={<p>Loading…</p>}>{content}</Suspense></SWRConfig>));
}
function publicationButton(name: string) { return [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((button) => button.textContent?.endsWith(name)); }
async function clickPublication(name: string) {
  const button = publicationButton(name);
  expect(button, `Missing publication ${name}`).toBeTruthy();
  await act(async () => button!.click());
}
function link(label: string) { return [...host.querySelectorAll<HTMLAnchorElement>("a")].find((anchor) => anchor.textContent?.trim() === label); }
async function enter(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("print workflow publication switching", () => {
  it("opens the requested authorized inbox and carries its publication to intake and issue links", async () => {
    await mount(<AdminIssuesPage />);
    expect(publicationButton("Wine Spectator")?.getAttribute("aria-pressed")).toBe("true");
    expect(publicationButton("Cigar Aficionado")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/issues?brand=ws");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/issues?brand=wa");
    expect(host.textContent).toContain("Wine sample issue");
    expect(link("New issue")?.getAttribute("href")).toBe("/admin/new?brand=ws");
    expect(link("Wine sample issue")?.getAttribute("href")).toBe(`/admin/${issueUuid}?brand=ws`);
  });

  it("falls back to an authorized publication when a WS-only editor arrives on a WA URL", async () => {
    allowedBrands = ["ws"];
    window.history.replaceState(null, "", "/admin?brand=wa");
    await mount(<AdminIssuesPage />);
    expect(publicationButton("Whisky Advocate")).toBeUndefined();
    expect(publicationButton("Wine Spectator")?.getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?brand=ws");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/issues?brand=wa");
    expect(link("New issue")?.getAttribute("href")).toBe("/admin/new?brand=ws");
  });

  it("removes the previous publication's rows while the next scoped list is loading", async () => {
    window.history.replaceState(null, "", "/admin?brand=wa");
    const wine = deferred<Response>();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/cms/session") return response({ user: { brands: allowedBrands } });
      return url === "/api/issues?brand=ws" ? wine.promise : list([whiskyIssue]);
    });
    await mount(<AdminIssuesPage />);
    expect(host.textContent).toContain("Whisky sample issue");
    await clickPublication("Wine Spectator");
    expect(window.location.search).toBe("?brand=ws");
    expect(host.textContent).not.toContain("Whisky sample issue");
    await act(async () => wine.resolve(list([wineIssue])));
    expect(host.textContent).toContain("Wine sample issue");
  });

  it("does not request issue data when publication access cannot be loaded", async () => {
    fetchMock.mockResolvedValue(response({ error: "Please sign in again." }, 401));
    await mount(<AdminIssuesPage />);
    expect(host.textContent).toContain("Please sign in again.");
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/cms/session")).toBe(true);
    expect(host.textContent).not.toContain("No issues in this view");
  });

  it("uses the intake URL and keeps entered issue details when changing publications", async () => {
    window.history.replaceState(null, "", "/admin/new?brand=ws");
    await mount(<NewIssuePage />);
    expect(publicationButton("Wine Spectator")?.getAttribute("aria-pressed")).toBe("true");
    expect(publicationButton("Cigar Aficionado")).toBeUndefined();
    expect(link("Back to issues")?.getAttribute("href")).toBe("/admin?brand=ws");
    await enter("#issue-id", "synthetic-fall");
    await enter("#issue-name", "Synthetic fall issue");
    await clickPublication("Whisky Advocate");
    expect(window.location.search).toBe("?brand=wa");
    expect(host.querySelector<HTMLInputElement>("#issue-id")!.value).toBe("synthetic-fall");
    expect(host.querySelector<HTMLInputElement>("#issue-name")!.value).toBe("Synthetic fall issue");
    expect(link("Back to issues")?.getAttribute("href")).toBe("/admin?brand=wa");
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
    expect(mocks.push).toHaveBeenCalledWith("/admin?brand=wa");
  });

  it("cannot select an unassigned publication from the intake URL", async () => {
    allowedBrands = ["ws"];
    window.history.replaceState(null, "", "/admin/new?brand=ca");
    await mount(<NewIssuePage />);
    expect(window.location.search).toBe("?brand=ws");
    expect(publicationButton("Wine Spectator")?.getAttribute("aria-pressed")).toBe("true");
    expect(publicationButton("Cigar Aficionado")).toBeUndefined();
    expect(publicationButton("Whisky Advocate")).toBeUndefined();
  });

  it("uses the actual issue publication for status-page navigation even if its incoming query is wrong", async () => {
    window.history.replaceState(null, "", `/admin/${issueUuid}?brand=wa`);
    await mount(<IssueStatusPage params={Promise.resolve({ issueUuid })} />);
    expect(window.location.search).toBe("?brand=ws");
    expect(link("Back to issues")?.getAttribute("href")).toBe("/admin?brand=ws");
    expect(link("Go to CMS")?.getAttribute("href")).toBe("/cms?brand=ws");
    const reviewLink = new URL(link("Review articles in CMS")!.href);
    expect(reviewLink.searchParams.get("brand")).toBe("ws");
    expect(reviewLink.searchParams.get("issue")).toBe(issueUuid);
  });
});

describe("legacy reader publication scope", () => {
  it("resolves an unassigned URL before fetching the catalog and preserves the authorized publication in links", async () => {
    allowedBrands = ["ws"];
    window.history.replaceState(null, "", "/reader?brand=ca");
    fetchMock.mockImplementation(async (url: string) => url === "/api/cms/session" ? response({ user: { brands: allowedBrands } }) : list([]));
    await mount(<FeedReaderPage />);
    expect(window.location.search).toBe("?brand=ws");
    expect(fetchMock).toHaveBeenCalledWith("/api/issues?brand=ws");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/issues");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/issues?brand=ca");
    expect(link("Upload New Issue")?.getAttribute("href")).toBe("/admin/new?brand=ws");
  });

  it("clears a loaded edition when the selected publication changes", async () => {
    window.history.replaceState(null, "", "/reader?brand=ws");
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/cms/session") return response({ user: { brands: allowedBrands } });
      if (url === "/api/issues?brand=ws") return list([{ ...wineIssue, status: "published", feedUrl: "/api/feeds/ws/synthetic/feed.xml" }]);
      if (url === "/api/issues?brand=wa") return list([]);
      if (url.startsWith("/api/feed?")) return response({ title: "Wine legacy edition", items: [{ title: "Wine legacy story" }] });
      throw new Error(`Unexpected offline request: ${url}`);
    });
    await mount(<FeedReaderPage />);
    expect(host.textContent).toContain("Wine legacy edition");
    await act(async () => window.history.replaceState(null, "", "/reader?brand=wa"));
    expect(fetchMock).toHaveBeenCalledWith("/api/issues?brand=wa");
    expect(host.textContent).not.toContain("Wine legacy edition");
    expect(host.textContent).not.toContain("Wine legacy story");
    expect(link("Upload New Issue")?.getAttribute("href")).toBe("/admin/new?brand=wa");
  });

  it("shows catalog failures without treating them as an empty publication", async () => {
    window.history.replaceState(null, "", "/reader?brand=ws");
    fetchMock.mockImplementation(async (url: string) => url === "/api/cms/session" ? response({ user: { brands: allowedBrands } }) : response({ error: "Catalog unavailable." }, 503));
    await mount(<FeedReaderPage />);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Catalog unavailable.");
    expect(host.textContent).not.toContain("No legacy editions in this publication");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/issues");
  });
});
