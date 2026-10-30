import type { CmsBrand } from "@/lib/cms/types";

/** The audience report for one publication over a period, in the shape the UI renders. */
export type AudienceTotals = {
  sessions: number;
  users: number;
  newUsers: number;
  pageViews: number;
  /** 0..1 */
  engagementRate: number;
  /** Seconds per session. */
  avgEngagementSeconds: number;
};

export type AudienceDay = { date: string; sessions: number; users: number; pageViews: number };
export type AudiencePage = { path: string; title: string; pageViews: number; sessions: number; engagementRate: number };
export type AudienceShare = { name: string; sessions: number; share: number };

export type AudienceReport = {
  brand: CmsBrand;
  days: number;
  /** ISO dates for the current window. */
  start: string;
  end: string;
  totals: AudienceTotals;
  previous: AudienceTotals;
  daily: AudienceDay[];
  previousDaily: AudienceDay[];
  topPages: AudiencePage[];
  channels: AudienceShare[];
  devices: AudienceShare[];
  /** Where the numbers came from. */
  source: "ga4" | "sample";
  fetchedAt: string;
};

export type PagePerformance = {
  path: string;
  days: number;
  pageViews: number;
  sessions: number;
  engagementRate: number;
  avgEngagementSeconds: number;
  daily: { date: string; pageViews: number }[];
  source: "ga4" | "sample";
};

export const AUDIENCE_PERIODS = [7, 28, 90] as const;
export type AudiencePeriod = (typeof AUDIENCE_PERIODS)[number];

export type Ga4PropertyOption = { propertyId: string; displayName: string; account: string };

/** The Google Analytics connection for one publication, as the Audience page shows it. */
export type ConnectionStatus = {
  brand: string;
  oauth_available: boolean;
  connected: boolean;
  google_email: string | null;
  property_id: string | null;
  property_name: string | null;
  connected_by: string | null;
  connected_at: string | null;
  service_account_property: string | null;
  properties: Ga4PropertyOption[];
  properties_error: string | null;
};
