import { BRANDS } from "../brands";
import { CMS_BRANDS, type CmsBrand } from "./types";

export const publicationNames = Object.fromEntries(
  CMS_BRANDS.map(brand => [brand, BRANDS[brand].name]),
) as Record<CmsBrand, string>;

export function isCmsBrand(value: unknown): value is CmsBrand {
  return typeof value === "string" && CMS_BRANDS.includes(value as CmsBrand);
}

/** A URL selects a publication; it never grants access to one. */
export function resolveCmsBrand(value: unknown, allowedBrands: readonly CmsBrand[]): CmsBrand | undefined {
  if (isCmsBrand(value) && allowedBrands.includes(value)) return value;
  return allowedBrands.includes("wa") ? "wa" : allowedBrands[0];
}

/** Preserve existing query parameters and fragments on an internal CMS link. */
export function publicationHref(path: string, brand?: CmsBrand): string {
  const url = new URL(path, "https://cms.invalid");
  if (!path.startsWith("/") || url.origin !== "https://cms.invalid") {
    throw new Error("Publication links must remain inside the CMS.");
  }
  if (brand) url.searchParams.set("brand", brand);
  else url.searchParams.delete("brand");
  return `${url.pathname}${url.search}${url.hash}`;
}
