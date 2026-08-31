export interface BrandConfig {
  id: "mw" | "ws" | "ca" | "wa";
  name: string;
  fullName: string;
  short: string;
  accent: string;
  bgTint: string;
  borderTint: string;
}

export const BRANDS: Record<string, BrandConfig> = {
  mw: {
    id: "mw",
    name: "Market Watch",
    fullName: "Market Watch Magazine",
    short: "MW",
    accent: "#C9A227", // Gold
    bgTint: "rgba(201, 162, 39, 0.12)",
    borderTint: "rgba(201, 162, 39, 0.3)",
  },
  ws: {
    id: "ws",
    name: "Wine Spectator",
    fullName: "Wine Spectator",
    short: "WS",
    accent: "#8E2C35", // Bordeaux
    bgTint: "rgba(142, 44, 53, 0.15)",
    borderTint: "rgba(142, 44, 53, 0.35)",
  },
  ca: {
    id: "ca",
    name: "Cigar Aficionado",
    fullName: "Cigar Aficionado",
    short: "CA",
    accent: "#7A5C3E", // Tobacco
    bgTint: "rgba(122, 92, 62, 0.15)",
    borderTint: "rgba(122, 92, 62, 0.35)",
  },
  wa: {
    id: "wa",
    name: "Whisky Advocate",
    fullName: "Whisky Advocate",
    short: "WA",
    accent: "#B85D19", // Amber
    bgTint: "rgba(184, 93, 25, 0.12)",
    borderTint: "rgba(184, 93, 25, 0.3)",
  },
};

export type BrandKey = keyof typeof BRANDS;

export const DEFAULT_BRAND = BRANDS.mw;
