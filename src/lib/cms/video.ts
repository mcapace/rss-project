/**
 * Video embeds as the CMS stores them: <figure data-embed="video"><a href="(YouTube or Vimeo URL)">…</a><figcaption>…</figcaption></figure>.
 * One parser for the editor (embedFor), the story JSON-LD and the newsletter. public/wa/video.js holds the same rules for
 * the reader's browser; src/lib/cms/__tests__/video.test.ts checks that both agree.
 */

export type VideoRef = {
  provider: "youtube" | "vimeo";
  id: string;
  /** A YouTube Short plays in a 9:16 frame. */
  short: boolean;
  /** The privacy-enhanced player address, without autoplay. */
  embed: string;
  /** The provider's own page for the video. */
  watch: string;
  /** YouTube's still for the video; Vimeo has none without an API call. */
  thumb: string | null;
};

const YOUTUBE_ID = /^[\w-]{6,}$/;

/** The video a YouTube or Vimeo link points at, or null for anything else. */
export function videoFor(url: string): VideoRef | null {
  let parsed: URL;
  try { parsed = new URL(String(url ?? "").trim()); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = host === "youtu.be"
      ? parsed.pathname.slice(1).split("/")[0]
      : parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1] || "";
    if (!YOUTUBE_ID.test(id)) return null;
    return { provider: "youtube", id, short: host !== "youtu.be" && /^\/shorts\//.test(parsed.pathname), embed: `https://www.youtube-nocookie.com/embed/${id}`, watch: `https://www.youtube.com/watch?v=${id}`, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parsed.pathname.match(/(\d{6,})/)?.[1];
    if (!id) return null;
    return { provider: "vimeo", id, short: false, embed: `https://player.vimeo.com/video/${id}`, watch: `https://vimeo.com/${id}`, thumb: null };
  }
  return null;
}

export type VideoEmbed = VideoRef & { href: string; caption: string; html: string };

const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const FIGURE = () => /<figure\b[^>]*\bdata-embed=(["'])video\1[^>]*>[\s\S]*?<\/figure>/gi;

/** Every recognised video figure in a body, in order, with its link, plain caption and the figure's markup. */
export function videoEmbeds(html: string): VideoEmbed[] {
  const out: VideoEmbed[] = [];
  for (const m of String(html ?? "").matchAll(FIGURE())) {
    const figure = m[0];
    const href = decode(figure.match(/<a\b[^>]*?\bhref=(["'])(.*?)\1/i)?.[2] ?? "").trim();
    const ref = videoFor(href);
    if (!ref) continue;
    const caption = decode((figure.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    out.push({ ...ref, href, caption, html: figure });
  }
  return out;
}

/** Replace each recognised video figure with what `render` returns for it; other figures stay as they are. */
export function replaceVideoEmbeds(html: string, render: (video: VideoEmbed) => string): string {
  return String(html ?? "").replace(FIGURE(), figure => {
    const [video] = videoEmbeds(figure);
    return video ? render(video) : figure;
  });
}
