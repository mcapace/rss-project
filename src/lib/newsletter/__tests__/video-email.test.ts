import { describe, expect, it } from "vitest";
import { emailVideos, renderNewsletterHtml, renderNewsletterText } from "../render";

const input = {
  brand: "wa" as const, kind: "weekly" as const, subject: "This week", preheader: null, title: "Inside the still house", byline: "Sample Editor", excerpt: "", section: "Features", url: "https://whiskyadvocate.com/inside",
  html: '<p>Lede.</p><figure data-embed="video"><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" rel="noopener noreferrer" target="_blank">Watch on YouTube</a><figcaption>The still house &amp; its stills</figcaption></figure><figure data-embed="video"><a href="https://vimeo.com/123456789">Watch video</a></figure><figure data-embed="video"><a href="https://example.com/clip">Watch video</a></figure>',
};

describe("videos in the newsletter", () => {
  it("never puts a player in an email: a YouTube video is its still linked to the video, then a link", () => {
    const html = renderNewsletterHtml(input);
    expect(html).not.toMatch(/<iframe|youtube-nocookie|player\.vimeo/i);
    expect(html).toContain('<a class="video-still" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('<img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" alt="Play video: The still house &amp; its stills" width="552"');
    expect(html).toContain(">Watch on YouTube</a><figcaption>The still house &amp; its stills</figcaption>");
  });

  it("keeps a Vimeo video as a plain link (no still without an API call) and leaves an unknown link alone", () => {
    const html = emailVideos(input.html, "#3d5a80", input.title);
    expect(html).toContain('<a href="https://vimeo.com/123456789" style="display:block;padding:36px 16px;');
    expect(html).toContain(">Watch on Vimeo</a></figure>");
    expect(html).not.toContain("i.ytimg.com/vi/123456789");
    expect(html).toContain('<figure data-embed="video"><a href="https://example.com/clip">Watch video</a></figure>');
    expect(emailVideos('<figure data-embed="video"><a href="https://youtu.be/dQw4w9WgXcQ">x</a></figure>', "#000", "Inside")).toContain('alt="Play video: Inside"');
  });

  it("gives the plain-text email the caption and the address", () => {
    const text = renderNewsletterText(input);
    expect(text).toContain("The still house & its stills: Watch the video at https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(text).toContain("Watch the video at https://vimeo.com/123456789");
  });
});
