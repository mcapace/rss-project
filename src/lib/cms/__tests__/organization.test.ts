import { describe, expect, it } from "vitest";
import { documentOrganization, placementIsActive, preserveReviewGate, validateOrganization, type CmsOrganization } from "../organization";

function sample(): CmsOrganization {
  return {
    primary_channel: "Whisky News", topics: ["Bourbon"], source_categories: ["News", "Homepage Slider"],
    placements: [{ slot: "homepage_slider", label: "Homepage Slider", status: "scheduled", starts_at: "2026-11-01T09:00:00Z", ends_at: "2026-11-03T09:00:00Z", source_category_id: "28" }],
  };
}

describe("content homes and promotion", () => {
  it("keeps the permanent home and original categories when a placement expires", () => {
    const organization = sample();
    const before = JSON.stringify(organization);
    validateOrganization(organization);
    expect(placementIsActive(organization.placements[0], new Date("2026-11-01T08:59:59Z"))).toBe(false);
    expect(placementIsActive(organization.placements[0], new Date("2026-11-01T09:00:00Z"))).toBe(true);
    expect(placementIsActive(organization.placements[0], new Date("2026-11-03T09:00:00Z"))).toBe(false);
    expect(JSON.stringify(organization)).toBe(before);
    expect(organization.primary_channel).toBe("Whisky News");
  });

  it("does not turn legacy slider membership into an active schedule or a permanent channel", () => {
    const metadata = { categories: ["Homepage Slider", "News"], tags: ["trending", "Bourbon"] };
    const organization = documentOrganization(metadata);
    expect(organization).toMatchObject({ primary_channel: null, topics: [], source_categories: metadata.categories });
    expect(organization.placements).toEqual([{ slot: "homepage_slider", label: "Homepage Slider", status: "needs_review", starts_at: null, ends_at: null }]);
    expect(placementIsActive(organization.placements[0], new Date("2026-11-02"))).toBe(false);
    expect(metadata).not.toHaveProperty("organization");
  });

  it("rejects missing ends, reversed windows, invalid calendar dates, duplicate assignments, and unknown slots", () => {
    for (const change of [
      { ends_at: null },
      { ends_at: "2026-11-01T08:00:00Z" },
      { starts_at: "2026-02-30T09:00:00Z" },
      { slot: "__proto__" },
    ]) {
      const organization = sample();
      expect(() => validateOrganization({ ...organization, placements: [{ ...organization.placements[0], ...change }] })).toThrow();
    }
    const organization = sample();
    expect(() => validateOrganization({ ...organization, placements: [...organization.placements, ...organization.placements] })).toThrow(/only one/);
    expect(() => validateOrganization({ ...organization, placements: [{ ...organization.placements[0], starts_at: "2026-11-01T09:00:00.1Z" }] })).not.toThrow();
  });

  it("keeps a stored review gate when restoring historical editorial metadata", () => {
    const gate = { required: true, reasons: ["duplicate_public_url"] };
    expect(preserveReviewGate({ review: gate }, { categories: ["News"] })).toEqual({ categories: ["News"], review: gate });
  });

  it("rejects array and object statuses instead of coercing them past schedule validation", () => {
    const organization = sample();
    for (const status of [["scheduled"], { value: "scheduled" }]) {
      const malformed = { ...organization, placements: [{ ...organization.placements[0], status, starts_at: null, ends_at: null }] };
      expect(() => validateOrganization(malformed)).toThrow("Unknown placement status.");
    }
  });
});
