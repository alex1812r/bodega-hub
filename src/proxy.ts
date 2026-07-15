import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getDefaultHomePathForAuthUserId } from "@/lib/supabase/auth/profile.server";

const privatePathPrefixes = [
  "/dashboard",
  "/products",
  "/sales",
  "/purchases",
  "/inventory",
  "/contacts",
  "/payments",
  "/reports",
  "/settings",
] as const;

function isPrivatePath(pathname: string) {
  return privatePathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie.name, cookie.value);
  });
}

function redirectTo(request: NextRequest, pathname: string, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(new URL(pathname, request.url));
  copyCookies(response, redirectResponse);

  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (pathname === "/") {
      return redirectTo(request, "/login", response);
    }

    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname === "/") {
    const homePath = user
      ? await getDefaultHomePathForAuthUserId(supabase, user.id)
      : "/login";

    return redirectTo(request, homePath, response);
  }

  if (pathname === "/login" && user) {
    const homePath = await getDefaultHomePathForAuthUserId(supabase, user.id);

    return redirectTo(request, homePath, response);
  }

  if (isPrivatePath(pathname) && !user) {
    const isDemoAuthEnabled = process.env.ALLOW_DEMO_AUTH === "true";

    if (!isDemoAuthEnabled) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", pathname);
      const redirectResponse = NextResponse.redirect(loginUrl);
      copyCookies(response, redirectResponse);
      return redirectResponse;
    }
  }

  const isDevToolkitEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.ALLOW_DEMO_AUTH === "true" ||
    process.env.API_DATA_SOURCE === "mock";

  if (
    !isDevToolkitEnabled &&
    (pathname === "/dev/welcome" || pathname.startsWith("/dev/") || pathname === "/api-docs")
  ) {
    return redirectTo(request, "/login", response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
