import "server-only";

/** Preview deployments must opt in only after their services are verified as development targets. */
export function connectedCmsEnabled() {
  return process.env.VERCEL_ENV !== "preview" || process.env.CMS_ENABLE_CONNECTED_PREVIEW === "true";
}
