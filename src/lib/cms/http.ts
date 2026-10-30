import { NextResponse } from "next/server";
import { CmsError } from "./access";

export function cmsJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}

export function cmsFailure(error: unknown) {
  if (error instanceof CmsError) return cmsJson({ error: error.message, code: error.code }, error.status);
  return cmsJson({ error: "The CMS could not complete this request. Please try again." }, 500);
}
