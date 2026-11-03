import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cms/db", () => ({ cmsDb: () => { throw new Error("not used"); } }));
import { dayOf, entryOf, sectionOf } from "./live-stories";

describe("live story entries", () => {
  it("maps a CMS-published story into the site's index shape", () => {
    const entry = entryOf({
      id: "11111111-1111-1111-1111-111111111111", slug: "new-rye", title: "A New Rye Arrives", byline: "Jane Doe", excerpt: "The short version.",
      body_html: `<p>${"word ".repeat(460)}</p>`, published_at: "2026-11-04T03:30:00Z",
      metadata: { section: "News", tags: ["Rye", "New Releases"], media: [{ s3_key: "x.jpg", is_lead: true, caption: "The bottle", credit: "WA" }], sponsored: { on: true, by: "Acme Spirits" } },
    });
    expect(entry).toMatchObject({ slug: "new-rye", by: "Jane Doe", d: "2026-11-03", sec: "news", dek: "The short version.", min: "2", cap: "The bottle", credit: "WA", sp: 1, spBy: "Acme Spirits" });
    expect(entry.hero).toBe("/api/media/11111111-1111-1111-1111-111111111111/0?w=1600");
  });

  it("files a story by the editor's section first, then by the export's rules", () => {
    expect(sectionOf([], [], "Anything", 100, "Cocktails")).toBe("cocktails");
    expect(sectionOf([], [], "The Best Paper Plane Recipe", 100, "")).toBe("cocktails");
    expect(sectionOf(["Bars"], [], "Where we drank", 100, "")).toBe("travel");
    expect(sectionOf([], [], "Plain news", 100, "")).toBe("news");
  });

  it("dates a story by its day in New York", () => {
    expect(dayOf("2026-11-04T03:30:00Z")).toBe("2026-11-03");
    expect(dayOf("2026-11-04T15:00:00Z")).toBe("2026-11-04");
  });
});
