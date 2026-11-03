import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { cleanBody, renderStory, sitePage, storyJsonLd, storyView, template, type WaDoc } from "./seo";
import type { WaSite } from "./site-host";

const ROOT: WaSite = { root: true, origin: "https://whiskyadvocate.com", base: "" };
const YT = '<figure data-embed="video"><a href="https://youtu.be/dQw4w9WgXcQ" rel="noopener noreferrer" target="_blank">Watch on YouTube</a><figcaption>Inside the still house</figcaption></figure>';
const VIMEO = '<figure data-embed="video" data-premium="true"><a href="https://vimeo.com/123456789" rel="noopener noreferrer" target="_blank">Watch video</a></figure>';
const doc = (body: string, published: string | null = "2026-11-01T12:00:00Z"): WaDoc => ({
  id: "00000000-0000-0000-0000-000000000009", kind: "article", slug: "Video-Story", title: "A Story With a Video", byline: "Jane Writer", excerpt: "The summary.",
  body_html: `<p>Lede.</p>${body}`, metadata: { categories: ["Features"] }, published_at: published, updated_at: null,
});

describe("story videos on the server", () => {
  it("cleanBody keeps the video figure and its link", () => {
    expect(cleanBody(YT + VIMEO, "")).toBe(YT + VIMEO);
  });

  it("adds a VideoObject for each YouTube video, dated with the story", () => {
    const [article] = storyJsonLd(storyView(doc(YT + VIMEO), ROOT), ROOT) as Record<string, unknown>[];
    expect(article.video).toEqual([{ "@type": "VideoObject", name: "Inside the still house", description: "Inside the still house", thumbnailUrl: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"], embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", uploadDate: "2026-11-01T12:00:00Z" }]);
  });

  it("names an uncaptioned video after the story, and adds none without a YouTube video or a date", () => {
    const bare = YT.replace(/<figcaption>.*<\/figcaption>/, "");
    const [named] = storyJsonLd(storyView(doc(bare), ROOT), ROOT) as Record<string, unknown>[];
    expect((named.video as { name: string }[])[0].name).toBe("A Story With a Video");
    expect((storyJsonLd(storyView(doc(VIMEO), ROOT), ROOT)[0] as Record<string, unknown>).video).toBeUndefined();
    expect((storyJsonLd(storyView(doc(YT, null), ROOT), ROOT)[0] as Record<string, unknown>).video).toBeUndefined();
  });

  it("story.html loads video.js and the server-rendered prose keeps the figure", async () => {
    const html = renderStory(await template("story.html"), storyView(doc(YT), ROOT), ROOT);
    expect(html).toContain('<script src="video.js"></script>');
    expect(html).toContain(YT);
    expect(html).not.toContain("<iframe");
  });

  it("a site page loads video.js only when its story has a video", async () => {
    const withVideo = (await sitePage("water.html", storyView(doc(YT), ROOT), ROOT))!;
    expect(withVideo).toContain('<script src="video.js" defer></script>');
    const without = (await sitePage("water.html", storyView(doc("<p>No video.</p>"), ROOT), ROOT))!;
    expect(without).not.toContain("video.js");
  });
});
