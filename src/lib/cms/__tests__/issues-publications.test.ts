import { beforeEach, describe, expect, it, vi } from "vitest";
import { CmsError } from "../access";

const mocks = vi.hoisted(() => ({ requireCmsUser: vi.fn(), cmsDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth-server", () => ({ requireCmsUser: mocks.requireCmsUser }));
vi.mock("../db", async (original) => ({ ...(await original<typeof import("../db")>()), cmsDb: mocks.cmsDb }));

import { GET as listIssues } from "@/app/api/issues/route";

const editor = { id: "synthetic-editor", email: "editor@example.test", role: "editor", brands: ["wa", "ws"] };
const request = (query = "") => new Request(`https://cms.example/api/issues${query}`);
const issue = (brand: string, id: string) => ({ id, brand, issue_id: id, status: "review", stats: { cms_document_count: 2 }, cms_intake_token: "private-worker-token" });
let scopes: string[][];
let query: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.resetAllMocks();
  scopes = [];
  const rows = [issue("ca", "unassigned-issue"), ...Array.from({ length: 105 }, (_, index) => issue("wa", `wa-${index}`)), issue("ws", "older-wine-issue")];
  let matching = rows;
  query = {
    select: vi.fn(() => query),
    in: vi.fn((_field: string, brands: string[]) => { scopes.push(brands); matching = rows.filter(row => brands.includes(row.brand)); return query; }),
    order: vi.fn(() => query),
    limit: vi.fn(async (count: number) => ({ data: matching.slice(0, count), error: null, count: matching.length })),
  };
  mocks.requireCmsUser.mockResolvedValue(editor);
  mocks.cmsDb.mockReturnValue({ from: vi.fn(() => query) });
});

describe("print issue publication scope", () => {
  it("rejects unsigned and unassigned requests before database access", async () => {
    mocks.requireCmsUser.mockRejectedValueOnce(new CmsError(401, "Sign in"));
    expect((await listIssues(request("?brand=wa"))).status).toBe(401);
    expect((await listIssues(request("?brand=ca"))).status).toBe(403);
    expect(mocks.cmsDb).not.toHaveBeenCalled();
  });

  it("finds a selected publication even when newer issues in another publication exceed the limit", async () => {
    const response = await listIssues(request("?brand=ws"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.total).toBe(1);
    expect(data.issues).toEqual([expect.objectContaining({ id: "older-wine-issue", brand: "ws", articleCount: 2 })]);
    expect(scopes).toEqual([["ws"]]);
    expect(query.in.mock.invocationCallOrder[0]).toBeLessThan(query.limit.mock.invocationCallOrder[0]);
    expect(data.issues[0]).not.toHaveProperty("cms_intake_token");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each(["", "?brand=all"])("limits the all-publications view to authorized publications (%s)", async (queryString) => {
    const response = await listIssues(request(queryString));
    const data = await response.json();
    expect(data.total).toBe(106);
    expect(data.limit).toBe(100);
    expect(data.issues).toHaveLength(100);
    expect(data.issues.some((row: { brand: string }) => row.brand === "ca")).toBe(false);
    expect(scopes).toEqual([["wa", "ws"]]);
  });
});
