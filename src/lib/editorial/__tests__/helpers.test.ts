import { describe, expect, it } from "vitest";
import {
  addSavedView, dayKey, diffSummary, documentTone, matchScore, monthGrid, parseSavedViews, readingMinutes,
  relativeTime, scheduleOf, slugify, sortBy, stripHtml, textDiff, withSchedule, wordCount, workspaceHref,
} from "../helpers";

describe("workspace links", () => {
  it("carries the publication and demo flag while keeping other parameters", () => {
    expect(workspaceHref("/cms/library?state=review", { brand: "ws", demo: true })).toBe("/cms/library?state=review&brand=ws&demo=1");
    expect(workspaceHref("/cms/library?brand=wa", { brand: null })).toBe("/cms/library");
    expect(workspaceHref("/cms/library", { brand: "mw" }, { kind: "rating", issue: null })).toBe("/cms/library?brand=mw&kind=rating");
  });
});

describe("dates", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  it("describes relative time in both directions", () => {
    expect(relativeTime("2026-10-30T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-30T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-28T12:00:00Z", now)).toBe("2 days ago");
    expect(relativeTime("2026-11-02T12:00:00Z", now)).toBe("in 3 days");
    expect(relativeTime(null, now)).toBe("");
  });
  it("builds a six-week month grid starting on Sunday", () => {
    const cells = monthGrid(2026, 9, now);
    expect(cells).toHaveLength(42);
    expect(cells[0].date.getDay()).toBe(0);
    expect(cells.filter(cell => !cell.outside)).toHaveLength(31);
    expect(cells.filter(cell => cell.today)).toHaveLength(1);
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("text", () => {
  it("strips markup and counts words", () => {
    const html = "<h2>Heading &amp; more</h2><p>One two <strong>three</strong>.</p><p>Four.</p>";
    expect(stripHtml(html)).toBe("Heading & more\nOne two three .\nFour.");
    expect(wordCount(html)).toBe(8);
    expect(wordCount("")).toBe(0);
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(2300)).toBe(10);
  });
  it("slugifies titles", () => {
    expect(slugify("Napa's New Guard & Cabernet — 2026!")).toBe("napa-s-new-guard-and-cabernet-2026");
    expect(slugify("Crème brûlée")).toBe("creme-brulee");
  });
  it("diffs words and summarizes the change", () => {
    const segments = textDiff("The quick brown fox", "The slow brown fox jumps");
    expect(segments.map(segment => segment.type)).toEqual(["equal", "delete", "insert", "equal", "insert"]);
    expect(segments.find(segment => segment.type === "delete")?.text).toBe("quick");
    expect(diffSummary(segments)).toEqual({ added: 2, removed: 1 });
    expect(textDiff("same", "same")).toEqual([{ type: "equal", text: "same" }]);
  });
});

describe("schedules", () => {
  it("reads and writes a planned publish time in metadata", () => {
    expect(scheduleOf({})).toBeNull();
    expect(scheduleOf({ schedule: { publish_at: "not a date" } })).toBeNull();
    const metadata = withSchedule({ section: "News" }, { publish_at: "2026-11-02T14:00:00.000Z", note: "After the embargo" });
    expect(scheduleOf(metadata)).toEqual({ publish_at: "2026-11-02T14:00:00.000Z", note: "After the embargo" });
    expect(withSchedule(metadata, null)).toEqual({ section: "News" });
  });
  it("treats a draft with a planned time as scheduled, never a published item", () => {
    expect(documentTone({ publication_state: "draft", metadata: { schedule: { publish_at: "2026-11-02T14:00:00Z" } } })).toBe("scheduled");
    expect(documentTone({ publication_state: "published", metadata: { schedule: { publish_at: "2026-11-02T14:00:00Z" } } })).toBe("published");
    expect(documentTone({ publication_state: "review", metadata: {} })).toBe("review");
  });
});

describe("saved views", () => {
  const filters = { kind: "rating", state: "review", q: "", sort: "updated_at", dir: "desc" as const };
  it("parses only well-formed views", () => {
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews("not json")).toEqual([]);
    expect(parseSavedViews(JSON.stringify([{ id: "a", name: "Ratings", filters, createdAt: "x" }, { bogus: true }]))).toHaveLength(1);
  });
  it("replaces a view with the same name and ignores empty names", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const first = addSavedView([], "Ratings to review", filters, now);
    expect(first).toHaveLength(1);
    const second = addSavedView(first, "ratings to review", { ...filters, state: "draft" }, now);
    expect(second).toHaveLength(1);
    expect(second[0].filters.state).toBe("draft");
    expect(addSavedView(first, "   ", filters, now)).toBe(first);
  });
});

describe("ranking and sorting", () => {
  it("prefers prefix and word-start matches", () => {
    expect(matchScore("", "anything")).toBe(1);
    expect(matchScore("rev", "Review queue")).toBe(80);
    expect(matchScore("queue", "Review queue")).toBe(60);
    expect(matchScore("view que", "Review queue")).toBe(40);
    expect(matchScore("print issue", "Upload an issue print")).toBe(25);
    expect(matchScore("zzz", "Review queue")).toBe(0);
  });
  it("sorts nulls last and respects direction", () => {
    const rows = [{ at: "2026-01-02" }, { at: null }, { at: "2026-01-01" }];
    expect(sortBy(rows, "at", "asc").map(row => row.at)).toEqual(["2026-01-01", "2026-01-02", null]);
    expect(sortBy(rows, "at", "desc").map(row => row.at)).toEqual([null, "2026-01-02", "2026-01-01"]);
  });
});
