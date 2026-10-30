import type { CmsBrand } from "@/lib/cms/types";
import type { AudienceDay, AudienceReport, AudienceTotals, PagePerformance } from "./analytics-types";

/**
 * Deterministic sample audience data for the demo and for previews without a
 * GA4 connection. Clearly labelled as a sample wherever it renders.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE: Record<CmsBrand, number> = { ws: 48_000, ca: 31_000, wa: 17_500, mw: 6_200 };
const PAGES: Record<CmsBrand, string[]> = {
  ws: ["/ratings/top-100-wines-2026", "/articles/napa-new-guard-cabernet", "/dining/burgundy-lists", "/news/harvest-report-north-coast", "/articles/weekend-pairing-roast-chicken", "/ratings/sample-estate-cabernet-2023"],
  ca: ["/articles/inside-nicaraguan-rolling-room", "/ratings/sample-reserva-toro", "/lifestyle/lounge-guide", "/drinks/aged-rum-connecticut-pairing", "/news/top-25-cigars-preview", "/articles/humidor-care"],
  wa: ["/whisky-101/warehouse-maturation", "/ratings/highland-harvest-12", "/news/season-in-new-releases", "/whisky-life/comparative-tasting-at-home", "/glossary/angels-share", "/articles/art-of-the-blend"],
  mw: ["/spirits-report/retail-sales-steady", "/trends/ready-to-drink-shelf", "/leaders/2026-retailers-to-watch", "/news/distributor-consolidation", "/directory/sample-distributor", "/analysis/premiumization"],
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

function series(brand: CmsBrand, days: number, offsetDays: number, now: Date, seedShift: number): AudienceDay[] {
  const random = mulberry32(brand.charCodeAt(0) * 131 + brand.charCodeAt(1) * 17 + seedShift);
  const base = BASE[brand] / 30;
  const out: AudienceDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - (i + offsetDays) * 86_400_000);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.78 : 1;
    const trend = 1 + (days - i) / days * 0.08 - (offsetDays ? 0.05 : 0);
    const noise = 0.82 + random() * 0.36;
    const spike = random() > 0.93 ? 1.45 : 1;
    const sessions = Math.round(base * weekend * trend * noise * spike);
    out.push({ date: dateKey(date), sessions, users: Math.round(sessions * (0.74 + random() * 0.08)), pageViews: Math.round(sessions * (1.6 + random() * 0.5)) });
  }
  return out;
}

function totals(daily: AudienceDay[], random: () => number): AudienceTotals {
  const sessions = daily.reduce((sum, day) => sum + day.sessions, 0);
  const users = daily.reduce((sum, day) => sum + day.users, 0);
  const pageViews = daily.reduce((sum, day) => sum + day.pageViews, 0);
  return { sessions, users, newUsers: Math.round(users * (0.55 + random() * 0.1)), pageViews, engagementRate: 0.52 + random() * 0.14, avgEngagementSeconds: 48 + Math.round(random() * 40) };
}

export function sampleAudience(brand: CmsBrand, days: number, now: Date = new Date()): AudienceReport {
  const random = mulberry32(days * 7 + brand.length);
  const daily = series(brand, days, 0, now, 1);
  const previousDaily = series(brand, days, days, now, 2);
  const current = totals(daily, random);
  const previous = totals(previousDaily, random);
  const channelMix = [["Organic search", 0.46], ["Direct", 0.19], ["Social", 0.12], ["Email", 0.11], ["Referral", 0.08], ["Paid", 0.04]] as const;
  const deviceMix = [["Mobile", 0.58], ["Desktop", 0.37], ["Tablet", 0.05]] as const;
  const shares = (mix: readonly (readonly [string, number])[]) => mix.map(([name, share]) => ({ name, share, sessions: Math.round(current.sessions * share) }));
  const topPages = PAGES[brand].map((path, index) => {
    const pageViews = Math.round(current.pageViews * (0.11 - index * 0.013) * (0.9 + random() * 0.2));
    return { path, title: path.split("/").pop()!.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase()), pageViews, sessions: Math.round(pageViews * 0.72), engagementRate: 0.5 + random() * 0.3 };
  });
  return {
    brand, days, start: daily[0].date, end: daily[daily.length - 1].date, totals: current, previous, daily, previousDaily,
    topPages, channels: shares(channelMix), devices: shares(deviceMix), source: "sample", fetchedAt: now.toISOString(),
  };
}

export function samplePagePerformance(brand: CmsBrand, path: string, days: number, now: Date = new Date()): PagePerformance {
  const random = mulberry32(path.length * 31 + days);
  const daily = series(brand, days, 0, now, path.length).map(day => ({ date: day.date, pageViews: Math.round(day.pageViews * (0.02 + random() * 0.02)) }));
  const pageViews = daily.reduce((sum, day) => sum + day.pageViews, 0);
  return { path, days, pageViews, sessions: Math.round(pageViews * 0.72), engagementRate: 0.5 + random() * 0.3, avgEngagementSeconds: 60 + Math.round(random() * 90), daily, source: "sample" };
}
