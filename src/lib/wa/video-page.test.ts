// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** public/wa/video.js run against a page, as the browser would: it upgrades the prose it finds once the page is parsed. */
const SRC = readFileSync(path.join(__dirname, "../../../public/wa/video.js"), "utf8");
type Win = Window & { WA?: Record<string, unknown>; YT?: unknown; WAVideo?: { upgrade(scope?: Element): number } };
const w = window as Win;
const FIG = '<figure data-embed="video"><a href="https://youtu.be/1kbPoNCMouE" rel="noopener noreferrer" target="_blank">Watch video</a></figure>';

function run(body: string) {
  document.body.innerHTML = body;
  new Function("module", SRC)(undefined);
  return w.WAVideo!;
}
afterEach(() => { delete w.WA; delete w.YT; document.body.innerHTML = ""; });

describe("video.js on the page", () => {
  it("leaves story.html's #prose to story.html (it refills it and upgrades after), and upgrades a site page's story prose", () => {
    const api = run(`<h1 id="title">Story</h1><div class="prose" id="prose">${FIG}</div><section id="source"><h2 id="sourceTitle">How to Water Your Whisky</h2><div class="prose">${FIG}</div></section>`);
    expect(document.querySelectorAll("#prose .wa-video-play")).toHaveLength(0);
    expect(document.querySelectorAll("#source .wa-video-play")).toHaveLength(1);
    // A site page's video with no caption is named after the story in its section, not the provider.
    expect(document.querySelector("#source .wa-video-play")!.getAttribute("aria-label")).toBe("Play video: How to Water Your Whisky");
    // story.html's own call after its refill upgrades #prose, named after #title.
    expect(api.upgrade(document.getElementById("prose")!)).toBe(1);
    expect(document.querySelector("#prose .wa-video-play")!.getAttribute("aria-label")).toBe("Play video: Story");
  });
});
