import "server-only";

/** Preview deployments must opt in only after their services are verified as development targets. */
export function connectedCmsEnabled() {
  return process.env.VERCEL_ENV !== "preview" || process.env.CMS_ENABLE_CONNECTED_PREVIEW === "true";
}

/** Routes that read content without a session (media, public delivery, redirects) follow the same rule. */
export function deliveryEnabled() {
  return connectedCmsEnabled();
}
