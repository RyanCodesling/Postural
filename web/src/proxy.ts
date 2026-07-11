import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  SESSION_COOKIE_CLEAR_OPTIONS,
  verifySessionToken,
} from "@/lib/session-token";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const protectedRoutes = ["/dashboard", "/camera"];
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );
  const isChangePasswordRoute = pathname === "/change-password";

  if (isProtectedRoute || isChangePasswordRoute) {
    const authToken = request.cookies.get(AUTH_COOKIE_NAME);
    const session = await verifySessionToken(authToken?.value);

    if (!session) {
      const response = NextResponse.redirect(new URL("/login", request.url));
      if (authToken) {
        response.cookies.set(
          AUTH_COOKIE_NAME,
          "",
          SESSION_COOKIE_CLEAR_OPTIONS,
        );
      }
      return response;
    }

    if (isProtectedRoute && session.mustChangePassword) {
      return NextResponse.redirect(new URL("/change-password", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public files)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
