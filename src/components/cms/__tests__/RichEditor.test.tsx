// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichEditor } from "../RichEditor";
import { ArticlePreview } from "../ArticlePreview";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("rich editor source preservation", () => {
  it("keeps unsupported figure and caption HTML intact until conversion is explicitly accepted", async () => {
    const original = '<figure><img src="https://example.test/image.jpg" alt="Synthetic image"><figcaption>Caption that must survive.</figcaption></figure><p>Story text.</p>';
    const onChange = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    function Harness() { const [html, setHtml] = useState(original); return <RichEditor html={html} onChange={value => { setHtml(value); onChange(value); }} />; }
    await act(async () => root.render(<Harness />));
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Article HTML"]')!.value).toBe(original);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>(".cms-source-switch")!.click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Article HTML"]')!.value).toBe(original);
    expect(onChange).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => host.querySelector<HTMLButtonElement>(".cms-source-switch")!.click());
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toContain("Caption that must survive.");
    expect(host.querySelector('[aria-label="Article HTML"]')).toBeNull();
  });

  it("closes rich-text link controls when switching to raw HTML editing", async () => {
    await act(async () => root.render(<RichEditor html="<p>Simple story.</p>" onChange={() => {}} />));
    expect(host.querySelector('[aria-label="Article HTML"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Add link"]')!.click());
    expect(host.querySelector('[aria-label="Link URL"]')).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>(".cms-source-switch")!.click());
    expect(host.querySelector('[aria-label="Link URL"]')).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Article HTML"]')!.value).toBe("<p>Simple story.</p>");
  });

  it("isolates raw source previews in a sandbox with no script or origin permissions", async () => {
    await act(async () => root.render(<ArticlePreview title='<img src=x onerror="alert(1)">' byline="<script>bad()</script>" html='<p>Content</p><script>parent.document.body.remove()</script>' />));
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(frame.srcdoc).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(host.querySelector("script")).toBeNull();
  });
});
