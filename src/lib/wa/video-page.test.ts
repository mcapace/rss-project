// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
function setUA(ua: string, vendor = "") {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  vi.spyOn(navigator, "vendor", "get").mockReturnValue(vendor);
}
afterEach(() => { vi.restoreAllMocks(); delete w.WA; delete w.YT; document.body.innerHTML = ""; });

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

  it("on a desktop browser the click loads the player inline with autoplay and playsinline, and counts the play", () => {
    setUA("Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36", "Google Inc.");
    const track = vi.fn();
    w.WA = { track, loadYT: vi.fn(() => Promise.resolve()) };
    run(`<div id="source"><h2 id="sourceTitle">T</h2><div class="prose">${FIG}</div></div>`);
    (document.querySelector(".wa-video-play") as HTMLButtonElement).click();
    const f = document.querySelector(".wa-video-frame iframe")!;
    expect(f.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/1kbPoNCMouE?autoplay=1&playsinline=1&rel=0");
    expect(track).toHaveBeenCalledWith("video_play", { src: "https://www.youtube-nocookie.com/embed/1kbPoNCMouE", provider: "youtube" });
    expect(w.WA.loadYT).not.toHaveBeenCalled();
  });

  it("on an iPhone a YouTube video starts through the player API once it is ready (the click does not survive an iframe load)", async () => {
    setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", "Apple Computer, Inc.");
    const playVideo = vi.fn();
    const Player = vi.fn(function (this: unknown, el: HTMLElement, opts: { events: { onReady(e: unknown): void } }) {
      const f = document.createElement("iframe"); el.replaceWith(f);
      opts.events.onReady({ target: { playVideo, getIframe: () => f } });
    });
    w.WA = { track: vi.fn(), loadYT: vi.fn(() => Promise.resolve()) };
    w.YT = { Player };
    run(`<div class="prose"><figure data-embed="video"><a href="https://www.youtube.com/watch?v=1kbPoNCMouE">Watch video</a><figcaption>The still house</figcaption></figure></div>`);
    (document.querySelector(".wa-video-play") as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(Player).toHaveBeenCalledTimes(1);
    const opts = Player.mock.calls[0][1] as unknown as { videoId: string; host: string; playerVars: Record<string, number> };
    expect(opts.videoId).toBe("1kbPoNCMouE");
    expect(opts.host).toBe("https://www.youtube-nocookie.com");
    expect(opts.playerVars).toEqual({ autoplay: 1, playsinline: 1, rel: 0 });
    expect(playVideo).toHaveBeenCalled();
    expect(document.querySelector(".wa-video-frame iframe")!.getAttribute("title")).toBe("Video: The still house");
  });

  it("falls back to the plain player when the API cannot load", async () => {
    setUA("Mozilla/5.0 (iPhone) Mobile Safari", "Apple Computer, Inc.");
    w.WA = { loadYT: vi.fn(() => Promise.reject(new Error("blocked"))) };
    run(`<div class="prose">${FIG}</div>`);
    (document.querySelector(".wa-video-play") as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector(".wa-video-frame iframe")!.getAttribute("src")).toContain("playsinline=1");
  });
});
