import { getSessionTokenFromCookie, SESSION_COOKIE_NAME } from "@/lib/session";
import {
  getCachedSessionUser,
  getSessionCacheKey,
  setCachedSessionUser,
} from "@/lib/session-cache";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionFromQuery = request.nextUrl.searchParams.get("session");

  if (pathname === "/onboarding" && sessionFromQuery) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("session");

    const decodedToken = decodeURIComponent(sessionFromQuery);

    const response = NextResponse.redirect(url);
    response.cookies.set(SESSION_COOKIE_NAME, decodedToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });
    return response;
  }

  const isPublicPath =
    pathname === "/" ||
    pathname === "/signin" ||
    pathname === "/onboarding" ||
    pathname === "/error" ||
    pathname.startsWith("/accept-invitation") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  if (isPublicPath) {
    return NextResponse.next();
  }

  const authorization =
    request.headers.get("authorization") ??
    (getSessionTokenFromCookie(request.headers.get("cookie"))
      ? `Session ${getSessionTokenFromCookie(request.headers.get("cookie"))}`
      : "");

  const cookie = request.headers.get("cookie") ?? "";
  const cacheKey = getSessionCacheKey({ authorization, cookie });
  const cachedUser = getCachedSessionUser(cacheKey);

  if (cachedUser) {
    return NextResponse.next();
  }

  const response = await fetch(new URL("/auth/me", API_URL), {
    headers: {
      cookie,
      Authorization: authorization,
    },
  });

  if (response.status >= 500) {
    return NextResponse.rewrite(new URL("/error", request.url), {
      status: 500,
    });
  }

  if (!response.ok) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  try {
    setCachedSessionUser(cacheKey, await response.json());
  } catch {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/create", "/admin/:path*", "/:slug", "/:slug/:path*"],
};
