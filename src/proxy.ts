import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { connectedCmsEnabled } from "@/lib/cms/runtime-config";

/** Refresh sessions only. Every private API/page performs its own verified authorization. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!connectedCmsEnabled() || request.nextUrl.pathname.startsWith("/cms/demo")) return response;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const client = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers || {})) response.headers.set(name, value);
      },
    },
  });
  await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/cms/:path*", "/admin/:path*", "/reader/:path*", "/api/feed", "/api/cms/:path*", "/api/issues/:path*", "/api/process", "/api/upload-url", "/api/login", "/api/logout", "/login"] };
