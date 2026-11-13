// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cookie consent on the new Whisky Advocate site (public/wa/site.js WAConsent, GA4 and public/wa/ads.js):
 * nothing that sets advertising or analytics cookies runs until Cookiebot answers, GA4 needs statistics consent,
 * and only marketing consent without a Global Privacy Control signal gets personalized (standard GPT) ads.
 */
const read = (name: string) => readFileSync(path.join(__dirname, "../../../public/wa", name), "utf8");
const SITE = ["catalog-core.js", "site.js"].map(read).join("\n;\n");
const ADS = read("ads.js");
const STANDARD = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
const LIMITED = "https://pagead2.googlesyndication.com/tag/js/gpt.js";

type Consent = { ready: boolean; chosen: boolean; marketing: boolean; statistics: boolean; gpc: boolean };
type W = Window & {
  WAConsent?: { state: Consent; manage(): void };
  Cookiebot?: { hasResponse: boolean; consent: Record<string, boolean>; renew?: () => void };
  dataLayer?: IArguments[];
  googletag?: { cmd: Array<() => void> };
  gtag?: unknown;
};
const w = window as unknown as W;

const scripts = (needle: string) => Array.from(document.querySelectorAll("script")).filter(s => (s.getAttribute("src") || "").includes(needle));
function cookiebot(answer: { hasResponse: boolean; consent?: Record<string, boolean> }, event = "CookiebotOnConsentReady") {
  w.Cookiebot = { hasResponse: answer.hasResponse, consent: answer.consent || {} };
  window.dispatchEvent(new Event(event));
}
function setGpc(on: boolean) { Object.defineProperty(navigator, "globalPrivacyControl", { value: on, configurable: true }); }
function page(opts: { ga4?: string; ad?: boolean } = {}) {
  if (opts.ga4) document.head.innerHTML = `<meta name="ga4" content="${opts.ga4}">`;
  document.body.innerHTML =
    (opts.ad ? '<div class="ad ad-leader" data-slot="wa_test"><span>Advertisement</span><i>970 x 90</i></div>' : "") +
    '<footer class="site"><div><h4>Company</h4><a href="about.html">About</a><a href="privacy.html">Privacy policy</a></div></footer>';
}
const runSite = () => new Function(SITE)();
const runAds = () => new Function(ADS)();

// Every run of site.js adds window listeners; remove them after each test so an earlier run cannot react to a later event.
let added: Array<[string, EventListenerOrEventListenerObject]> = [];
beforeEach(() => {
  added = [];
  const original = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    added.push([type, fn]);
    original(type, fn, opts);
  });
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
  setGpc(false);
  for (const k of ["WAConsent", "Cookiebot", "dataLayer", "googletag", "gtag"] as const) delete (w as unknown as Record<string, unknown>)[k];
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [type, fn] of added) window.removeEventListener(type, fn);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WAConsent (site.js)", () => {
  it("loads Cookiebot with Whisky Advocate's ID and starts Google Consent Mode at denied", () => {
    page();
    runSite();
    const cb = document.getElementById("Cookiebot");
    expect(cb?.getAttribute("src")).toBe("https://consent.cookiebot.com/uc.js");
    expect(cb?.getAttribute("data-cbid")).toBe("46927422-5d96-4541-8331-7f8f535aafab");
    const first = Array.from(w.dataLayer![0]);
    expect(first[0]).toBe("consent");
    expect(first[1]).toBe("default");
    expect(first[2]).toMatchObject({ ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
    expect(w.WAConsent!.state.ready).toBe(false);
  });

  it("treats a first visit with the banner up as a decline", () => {
    page();
    runSite();
    cookiebot({ hasResponse: false }, "CookiebotOnLoad");
    expect(w.WAConsent!.state).toMatchObject({ ready: true, chosen: false, marketing: false, statistics: false });
  });

  it("treats a Cookiebot that never answers as a decline", () => {
    page();
    runSite();
    vi.advanceTimersByTime(3000);
    expect(w.WAConsent!.state).toMatchObject({ ready: true, marketing: false, statistics: false });
  });

  it("never grants marketing when the browser sends Global Privacy Control, and confirms it in the footer", () => {
    setGpc(true);
    page();
    runSite();
    cookiebot({ hasResponse: true, consent: { marketing: true, statistics: true } });
    expect(w.WAConsent!.state).toMatchObject({ marketing: false, statistics: true, gpc: true });
    expect(document.querySelector("footer.site .gpc-note")?.textContent).toMatch(/Global Privacy Control/);
  });

  it("adds a Cookie settings link beside the privacy policy that reopens the banner", () => {
    page();
    runSite();
    const renew = vi.fn();
    w.Cookiebot = { hasResponse: true, consent: {}, renew };
    const link = document.querySelector<HTMLAnchorElement>("[data-cookie-settings]");
    expect(link?.previousElementSibling?.getAttribute("href")).toBe("privacy.html");
    link!.click();
    expect(renew).toHaveBeenCalledOnce();
  });
});

describe("GA4 (site.js) waits for statistics consent", () => {
  it("does not load before Cookiebot answers or after a decline", () => {
    page({ ga4: "G-TEST123" });
    runSite();
    expect(scripts("googletagmanager.com/gtag")).toHaveLength(0);
    cookiebot({ hasResponse: true, consent: { statistics: false, marketing: false } });
    expect(scripts("googletagmanager.com/gtag")).toHaveLength(0);
    expect(w.gtag).toBeUndefined();
  });

  it("loads once statistics consent is given, including mid-visit", () => {
    page({ ga4: "G-TEST123" });
    runSite();
    cookiebot({ hasResponse: false }, "CookiebotOnLoad");
    expect(scripts("googletagmanager.com/gtag")).toHaveLength(0);
    cookiebot({ hasResponse: true, consent: { statistics: true } });
    expect(scripts("googletagmanager.com/gtag/js?id=G-TEST123")).toHaveLength(1);
  });
});

describe("ads.js loads GPT only after consent", () => {
  it("requests nothing until Cookiebot answers", () => {
    page({ ad: true });
    runSite();
    runAds();
    expect(scripts("gpt.js")).toHaveLength(0);
  });

  it("serves limited, restricted ads on a decline", () => {
    page({ ad: true });
    runSite();
    runAds();
    cookiebot({ hasResponse: true, consent: { marketing: false } });
    expect(scripts("gpt.js").map(s => s.getAttribute("src"))).toEqual([LIMITED]);
    const setPrivacySettings = vi.fn();
    (w.googletag as unknown as { pubads(): unknown }).pubads = () => ({ setPrivacySettings });
    w.googletag!.cmd[0]();
    expect(setPrivacySettings).toHaveBeenCalledWith({ limitedAds: true, restrictDataProcessing: true, nonPersonalizedAds: true });
  });

  it("serves standard ads only with marketing consent and no GPC", () => {
    page({ ad: true });
    runSite();
    runAds();
    cookiebot({ hasResponse: true, consent: { marketing: true } });
    expect(scripts("gpt.js").map(s => s.getAttribute("src"))).toEqual([STANDARD]);
  });

  it("serves limited ads to a GPC browser even with marketing consent", () => {
    setGpc(true);
    page({ ad: true });
    runSite();
    runAds();
    cookiebot({ hasResponse: true, consent: { marketing: true } });
    expect(scripts("gpt.js").map(s => s.getAttribute("src"))).toEqual([LIMITED]);
  });
});
