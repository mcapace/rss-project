import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The app's 404 page per host: the site's own on a root host for a site path the proxy passed on, else the workspace's.
const sent = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => sent.headers }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/editorial/editorial.css", () => ({}));

const { default: NotFound, generateMetadata } = await import("@/app/not-found");
const page = async (headers: Record<string, string>) => { sent.headers = new Headers(headers); return renderToStaticMarkup(await NotFound()); };

afterEach(() => { vi.unstubAllEnvs(); });

describe("the not-found page", () => {
  it("is the Whisky Advocate 404 for a site path on a root host", async () => {
    const html = await page({ host: "whiskyadvocate.com", "x-wa-site-path": "/a/Jack-%26-b" });
    expect(html).toContain("We could not find “/a/Jack-&amp;-b”.");
    expect(html).toContain('href="/site.css"');
    expect(html).toContain('href="/stories.html"');
    expect(html).toContain('href="https://whiskyadvocate.com/"');
    expect(html).not.toContain("Editorial");
    expect((await generateMetadata()).title).toEqual({ absolute: "Page not found | Whisky Advocate" });
  });

  it("stays the workspace's 404 for the app's paths, and on every other host", async () => {
    for (const headers of [{ host: "whiskyadvocate.com" }, { host: "rss-project-ten.vercel.app", "x-wa-site-path": "/a/b" }] as Record<string, string>[]) {
      const html = await page(headers);
      expect(html).toContain("This page does not exist");
      expect(html).not.toContain("site.css");
      expect(await generateMetadata()).toEqual({});
    }
  });
});
