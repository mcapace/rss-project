import { describe, expect, it } from "vitest";
import { createDemoData, DEMO_STORAGE_KEY } from "../data";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

describe("demo data store", () => {
  const now = () => new Date("2026-10-30T15:00:00Z");

  it("lists, filters and pages synthetic documents per publication", async () => {
    const data = createDemoData(new MemoryStorage(), now);
    const all = await data.listDocuments({ brand: "wa" });
    expect(all.total).toBeGreaterThan(5);
    expect(all.documents.every(row => row.brand === "wa")).toBe(true);
    const review = await data.listDocuments({ brand: "ws", state: "review" });
    expect(review.documents.every(row => row.publication_state === "review")).toBe(true);
    const search = await data.listDocuments({ brand: "wa", q: "warehouse" });
    expect(search.documents.map(row => row.title)).toEqual(["A guide to warehouse maturation"]);
    const overview = await data.overview("wa");
    expect(overview.total).toBe(all.total);
    expect(overview.review).toBe((await data.listDocuments({ brand: "wa", state: "review" })).total);
  });

  it("saves with optimistic revisions, records history, and persists to storage", async () => {
    const storage = new MemoryStorage();
    const data = createDemoData(storage, now);
    const [row] = (await data.listDocuments({ brand: "wa", state: "draft" })).documents;
    const saved = await data.saveDocument(row.id, row.revision, { title: "Renamed draft" });
    expect(saved.revision).toBe(row.revision + 1);
    expect(saved.title).toBe("Renamed draft");
    await expect(data.saveDocument(row.id, row.revision, { title: "Stale" })).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(data.saveDocument(row.id, saved.revision, { publication_state: "published" })).rejects.toMatchObject({ status: 422 });
    const history = await data.history(row.id);
    expect(history.revisions[0].revision).toBe(saved.revision);
    expect(history.revisions[0].reason).toBe("edit");
    expect(storage.getItem(DEMO_STORAGE_KEY)).toContain("Renamed draft");
    const reloaded = createDemoData(storage, now);
    expect((await reloaded.getDocument(row.id)).document.title).toBe("Renamed draft");
  });

  it("creates drafts and exposes print issues and an inventory", async () => {
    const data = createDemoData(new MemoryStorage(), now);
    const created = await data.createDocument({ brand: "ca", kind: "article", title: "  A new lounge story " });
    expect(created.title).toBe("A new lounge story");
    expect(created.publication_state).toBe("draft");
    expect((await data.listDocuments({ brand: "ca" })).documents[0].id).toBe(created.id);
    const issues = await data.listIssues("ws");
    expect(issues.every(issue => issue.brand === "ws")).toBe(true);
    expect(issues.some(issue => issue.status === "failed")).toBe(true);
    const inventory = await data.inventory("wa");
    expect(inventory.brand).toBe("wa");
    expect(inventory.documents.total).toBe((await data.overview("wa")).total);
  });
});
