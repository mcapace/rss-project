import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { replaceVideoEmbeds, videoEmbeds, videoFor } from "../video";
import { embedFor } from "@/components/editorial/BodyEditor";

const require = createRequire(import.meta.url);
const page = require("../../../../public/wa/video.js") as { videoFor: typeof videoFor; playerSrc: (v: NonNullable<ReturnType<typeof videoFor>>) => string };

const CASES: [string, { provider: "youtube" | "vimeo"; id: string; short?: boolean } | null][] = [
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", { provider: "youtube", id: "dQw4w9WgXcQ" }],
  ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s", { provider: "youtube", id: "dQw4w9WgXcQ" }],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", { provider: "youtube", id: "dQw4w9WgXcQ" }],
  ["  https://youtu.be/dQw4w9WgXcQ?si=abc  ", { provider: "youtube", id: "dQw4w9WgXcQ" }],
  ["https://www.youtube.com/shorts/LM43f5LrLhA?si=jdsZwcqyC9zCdrh1", { provider: "youtube", id: "LM43f5LrLhA", short: true }],
  ["https://www.youtube.com/live/abcDEF_123-", { provider: "youtube", id: "abcDEF_123-" }],
  ["https://www.youtube.com/embed/1kbPoNCMouE", { provider: "youtube", id: "1kbPoNCMouE" }],
  ["https://www.youtube-nocookie.com/embed/1kbPoNCMouE?rel=0", { provider: "youtube", id: "1kbPoNCMouE" }],
  ["https://vimeo.com/123456789", { provider: "vimeo", id: "123456789" }],
  ["https://vimeo.com/channels/staffpicks/123456789", { provider: "vimeo", id: "123456789" }],
  ["https://player.vimeo.com/video/123456789?h=abc", { provider: "vimeo", id: "123456789" }],
  // Not a video this site can play: stays a plain link.
  ["https://www.youtube.com/channel/UCFU0H8ZHCXPMAMQGOkjbxFg", null],
  ["https://www.youtube.com/watch?v=bad", null],
  ["https://www.youtube.com/watch?v=has%20space1", null],
  ["https://youtu.be/", null],
  ["https://youtu.be/<script>", null],
  ["https://vimeo.com/about", null],
  ["https://vimeo.com/12345", null],
  ["https://example.com/watch?v=dQw4w9WgXcQ", null],
  ["https://notyoutube.com/watch?v=dQw4w9WgXcQ", null],
  ["https://cdn.jwplayer.com/players/d2zhbdzQ-JtEAjoII.html", null],
  ["javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ", null],
  ["not a url", null],
  ["", null],
];

describe("video links", () => {
  it("recognises the YouTube and Vimeo shapes the editor accepts, and nothing else", () => {
    for (const [url, want] of CASES) {
      const got = videoFor(url);
      if (!want) { expect(got, url).toBeNull(); continue; }
      expect(got, url).toMatchObject({ provider: want.provider, id: want.id, short: !!want.short });
    }
  });

  it("builds the privacy-enhanced player, the watch page and the still", () => {
    expect(videoFor("https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ", short: false, embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", watch: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", thumb: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    expect(videoFor("https://vimeo.com/123456789")).toEqual({ provider: "vimeo", id: "123456789", short: false, embed: "https://player.vimeo.com/video/123456789", watch: "https://vimeo.com/123456789", thumb: null });
  });

  it("the story page's copy (public/wa/video.js) agrees with the server's on every case", () => {
    for (const [url] of CASES) expect(page.videoFor(url), url).toEqual(videoFor(url));
    expect(page.playerSrc(videoFor("https://youtu.be/dQw4w9WgXcQ")!)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
    expect(page.playerSrc(videoFor("https://vimeo.com/123456789")!)).toBe("https://player.vimeo.com/video/123456789?autoplay=1&dnt=1");
  });

  it("the editor's embedFor reads the same rules", () => {
    expect(embedFor("https://www.youtube.com/shorts/LM43f5LrLhA")).toEqual({ provider: "youtube", id: "LM43f5LrLhA", src: "https://www.youtube-nocookie.com/embed/LM43f5LrLhA" });
    expect(embedFor("https://player.vimeo.com/video/123456789")).toEqual({ provider: "vimeo", id: "123456789", src: "https://player.vimeo.com/video/123456789" });
    expect(embedFor("https://example.com/video.mp4")).toBeNull();
  });
});

describe("video figures in a body", () => {
  const body = [
    "<p>Intro.</p>",
    '<figure data-embed="video"><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=4s" rel="noopener noreferrer" target="_blank">Watch on YouTube</a><figcaption>The <em>still</em> house &amp; its stills</figcaption></figure>',
    '<figure data-embed="video" data-premium="true"><a href="https://vimeo.com/123456789">Watch video</a></figure>',
    '<figure data-embed="video"><a href="https://example.com/clip">Watch video</a><figcaption>Elsewhere</figcaption></figure>',
    '<figure><img src="a.jpg"><figcaption>A picture</figcaption></figure>',
  ].join("");

  it("finds the recognised ones with their link and plain caption", () => {
    const found = videoEmbeds(body);
    expect(found.map(v => [v.provider, v.id, v.href, v.caption])).toEqual([
      ["youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=4s", "The still house & its stills"],
      ["vimeo", "123456789", "https://vimeo.com/123456789", ""],
    ]);
  });

  it("replaces only those figures", () => {
    const out = replaceVideoEmbeds(body, v => `[${v.provider}:${v.id}]`);
    expect(out).toBe('<p>Intro.</p>[youtube:dQw4w9WgXcQ][vimeo:123456789]<figure data-embed="video"><a href="https://example.com/clip">Watch video</a><figcaption>Elsewhere</figcaption></figure><figure><img src="a.jpg"><figcaption>A picture</figcaption></figure>');
  });
});
