import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route protection for the authenticated `(app)` route group.
 *
 * (Next.js 16 renamed the `middleware` file convention to `proxy`; the runtime
 * is `nodejs`. This gate only reads a cookie and redirects, so it is
 * runtime-agnostic and migrates cleanly.)
 *
 * The `(app)` group is URL-less, so we match its concrete page paths here.
 * Auth is inferred from the non-HttpOnly `brandpilot_token` cookie that the
 * client sets on login (see lib/api.ts). Unauthenticated users hitting a
 * protected page are sent to /login (with a `next` hint); already-authenticated
 * users hitting /login are sent on to the dashboard.
 *
 * /verify-email and /accept-invite are public but, unlike the other auth pages
 * below, are NOT part of the authed-redirect block. A already-logged-in user
 * can legitimately click a verification link from their inbox, and a
 * logged-in user might accept an invite to a DIFFERENT org than the one
 * they're currently signed into — so both authed and unauthed visitors must
 * be able to load these pages.
 */

const TOKEN_COOKIE = "brandpilot_token";
const LOGIN_PATH = "/login";
const SIGNUP_PATH = "/signup";
const FORGOT_PASSWORD_PATH = "/forgot-password";
const RESET_PASSWORD_PATH = "/reset-password";
const DEFAULT_AUTHED_PATH = "/dashboard";

/** Concrete paths rendered by the (app) route group. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/content",
  "/calendar",
  "/inbox",
  "/leads",
  "/analytics",
  "/settings",
  "/onboarding",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const isAuthed = Boolean(token && token.length > 0);

  // Keep authenticated users out of the login/signup/password-reset screens.
  if (
    (pathname === LOGIN_PATH ||
      pathname === SIGNUP_PATH ||
      pathname === FORGOT_PASSWORD_PATH ||
      pathname === RESET_PASSWORD_PATH) &&
    isAuthed
  ) {
    const url = request.nextUrl.clone();
    url.pathname = DEFAULT_AUTHED_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Gate the protected app shell.
  if (isProtected(pathname) && !isAuthed) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/content/:path*",
    "/calendar/:path*",
    "/inbox/:path*",
    "/leads/:path*",
    "/analytics/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/accept-invite",
  ],
};
