import { describe, expect, it } from "vitest";
import { searchIntent } from "../Assistant";
import { embedFor } from "../BodyEditor";

describe("assistant search intent", () => {
  it("recognizes image and content searches", () => {
    expect(searchIntent("find images of barrels")).toEqual({ query: "barrels", scope: "media" });
    expect(searchIntent("Show me stories about harvest.")).toEqual({ query: "harvest", scope: "documents" });
    expect(searchIntent("search for sky blue vineyard")).toEqual({ query: "sky blue vineyard", scope: "all" });
    expect(searchIntent("Give me three headlines")).toBeNull();
    expect(searchIntent("find x")).toBeNull();
  });
});

describe("video embeds", () => {
  it("accepts YouTube and Vimeo links only", () => {
    expect(embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedFor("https://youtu.be/dQw4w9WgXcQ")?.provider).toBe("youtube");
    expect(embedFor("https://vimeo.com/123456789")?.src).toBe("https://player.vimeo.com/video/123456789");
    expect(embedFor("https://example.com/video.mp4")).toBeNull();
    expect(embedFor("not a url")).toBeNull();
  });
});
