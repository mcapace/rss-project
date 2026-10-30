import "server-only";
import { createSign } from "node:crypto";
import type { CmsBrand } from "@/lib/cms/types";
import { CmsError } from "@/lib/cms/access";
import type { AudienceDay, AudiencePage, AudienceReport, AudienceShare, AudienceTotals, PagePerformance } from "../analytics-types";
import { loadCredentials, validAccessToken } from "./google-oauth";

/**
 * GA4 Data API. Two ways to connect, checked in order:
 *   1. A Google account connected from the Audience page (OAuth, like the
 *      audience dashboard), stored per publication in cms_google_credentials
 *      together with the chosen property.
 *   2. A service account: GA4_SERVICE_ACCOUNT_JSON plus GA4_PROPERTY_ID_WA /
 *      _WS / _CA / _MW, with Viewer access on each property.
 */

type ServiceAccount = { client_email: string; private_key: string };

export function ga4Configuration(): { account: ServiceAccount; properties: Partial<Record<CmsBrand, string>> } | null {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  let account: ServiceAccount;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    account = { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch { return null; }
  const properties: Partial<Record<CmsBrand, string>> = {};
  for (const brand of ["wa", "ws", "ca", "mw"] as const) {
    const id = process.env[`GA4_PROPERTY_ID_${brand.toUpperCase()}`];
    if (id && /^\d+$/.test(id)) properties[brand] = id;
  }
  return Object.keys(properties).length ? { account, properties } : null;
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(account.private_key));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  if (!response.ok) throw new CmsError(502, "Google did not accept the analytics service account.", "analytics_auth_failed");
  const body = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

type Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };
type ReportResponse = { rows?: Row[] };

async function runReport(token: string, property: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Row[]> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CmsError(502, `Google Analytics returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}.`, "analytics_failed");
  }
  return ((await response.json()) as ReportResponse).rows ?? [];
}

const num = (value: string | undefined) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const gaDate = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

function window(days: number, offset = 0): { start: string; end: string } {
  const end = new Date(Date.now() - (1 + offset) * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { start: isoDate(start), end: isoDate(end) };
}

const TOTAL_METRICS = ["sessions", "totalUsers", "newUsers", "screenPageViews", "engagementRate", "averageSessionDuration"];

function totalsFrom(row: Row | undefined): AudienceTotals {
  const values = row?.metricValues ?? [];
  return { sessions: num(values[0]?.value), users: num(values[1]?.value), newUsers: num(values[2]?.value), pageViews: num(values[3]?.value), engagementRate: num(values[4]?.value), avgEngagementSeconds: num(values[5]?.value) };
}

function dailyFrom(rows: Row[]): AudienceDay[] {
  return rows.map(row => ({ date: gaDate(row.dimensionValues?.[0]?.value ?? ""), sessions: num(row.metricValues?.[0]?.value), users: num(row.metricValues?.[1]?.value), pageViews: num(row.metricValues?.[2]?.value) })).sort((a, b) => a.date.localeCompare(b.date));
}

function sharesFrom(rows: Row[]): AudienceShare[] {
  const items = rows.map(row => ({ name: row.dimensionValues?.[0]?.value || "Other", sessions: num(row.metricValues?.[0]?.value) }));
  const total = items.reduce((sum, item) => sum + item.sessions, 0) || 1;
  return items.map(item => ({ ...item, share: item.sessions / total })).sort((a, b) => b.sessions - a.sessions);
}

/** Resolve a bearer token and property for a publication from whichever connection exists. */
async function connection(brand: CmsBrand): Promise<{ token: string; property: string }> {
  const credentials = await loadCredentials(brand);
  if (credentials?.property_id && (credentials.refresh_token || credentials.access_token)) {
    return { token: await validAccessToken(credentials), property: credentials.property_id };
  }
  const config = ga4Configuration();
  const property = config?.properties[brand];
  if (!config || !property) {
    throw new CmsError(503, credentials && !credentials.property_id ? "Google is connected; choose the GA4 property for this publication on the Audience page." : "Google Analytics has not been connected for this publication.", "setup_required");
  }
  return { token: await accessToken(config.account), property };
}

export async function loadGa4Audience(brand: CmsBrand, days: number, signal?: AbortSignal): Promise<AudienceReport> {
  const { token, property } = await connection(brand);
  const current = window(days), previous = window(days, days);
  const dateRanges = [{ startDate: current.start, endDate: current.end }];
  const [totalRows, dailyRows, pageRows, channelRows, deviceRows] = await Promise.all([
    runReport(token, property, { dateRanges: [{ ...dateRanges[0], name: "current" }, { startDate: previous.start, endDate: previous.end, name: "previous" }], metrics: TOTAL_METRICS.map(name => ({ name })) }, signal),
    runReport(token, property, { dateRanges: [{ ...dateRanges[0], name: "current" }, { startDate: previous.start, endDate: previous.end, name: "previous" }], dimensions: [{ name: "date" }, { name: "dateRange" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }], limit: 400 }, signal),
    runReport(token, property, { dateRanges, dimensions: [{ name: "pagePath" }, { name: "pageTitle" }], metrics: [{ name: "screenPageViews" }, { name: "sessions" }, { name: "engagementRate" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 12 }, signal),
    runReport(token, property, { dateRanges, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], limit: 8 }, signal),
    runReport(token, property, { dateRanges, dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "sessions" }], limit: 4 }, signal),
  ]);
  const totalFor = (range: string) => totalRows.find(row => (row.dimensionValues?.[0]?.value ?? "current") === range) ?? (range === "current" ? totalRows[0] : totalRows[1]);
  const topPages: AudiencePage[] = pageRows.map(row => ({ path: row.dimensionValues?.[0]?.value ?? "/", title: row.dimensionValues?.[1]?.value ?? "", pageViews: num(row.metricValues?.[0]?.value), sessions: num(row.metricValues?.[1]?.value), engagementRate: num(row.metricValues?.[2]?.value) }));
  return {
    brand, days, start: current.start, end: current.end,
    totals: totalsFrom(totalFor("current")), previous: totalsFrom(totalFor("previous")),
    daily: dailyFrom(dailyRows.filter(row => (row.dimensionValues?.[1]?.value ?? "current") === "current")),
    previousDaily: dailyFrom(dailyRows.filter(row => row.dimensionValues?.[1]?.value === "previous")),
    topPages, channels: sharesFrom(channelRows), devices: sharesFrom(deviceRows), source: "ga4", fetchedAt: new Date().toISOString(),
  };
}

export async function loadGa4Page(brand: CmsBrand, path: string, days: number, signal?: AbortSignal): Promise<PagePerformance> {
  const { token, property } = await connection(brand);
  const current = window(days);
  const filter = { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: path } } };
  const [totalRows, dailyRows] = await Promise.all([
    runReport(token, property, { dateRanges: [{ startDate: current.start, endDate: current.end }], dimensionFilter: filter, metrics: [{ name: "screenPageViews" }, { name: "sessions" }, { name: "engagementRate" }, { name: "averageSessionDuration" }] }, signal),
    runReport(token, property, { dateRanges: [{ startDate: current.start, endDate: current.end }], dimensionFilter: filter, dimensions: [{ name: "date" }], metrics: [{ name: "screenPageViews" }], limit: 200 }, signal),
  ]);
  const values = totalRows[0]?.metricValues ?? [];
  return {
    path, days, pageViews: num(values[0]?.value), sessions: num(values[1]?.value), engagementRate: num(values[2]?.value), avgEngagementSeconds: num(values[3]?.value),
    daily: dailyRows.map(row => ({ date: gaDate(row.dimensionValues?.[0]?.value ?? ""), pageViews: num(row.metricValues?.[0]?.value) })).sort((a, b) => a.date.localeCompare(b.date)),
    source: "ga4",
  };
}
