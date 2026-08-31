import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, hashPassword } from "./lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /admin routes
  if (pathname.startsWith("/admin")) {
    const adminPassword = process.env.ADMIN_PASSWORD;

    // If no ADMIN_PASSWORD is set in env yet, allow access gracefully
    if (!adminPassword) {
      return NextResponse.next();
    }

    const sessionCookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const expectedHash = await hashPassword(adminPassword);

    if (!sessionCookie || sessionCookie !== expectedHash) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
