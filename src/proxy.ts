import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getDefaultHomePathForAuthUserId } from "@/lib/supabase/auth/profile.server";
import { buildLoginUrl } from "@/shared/auth/loginRedirect";

/**
 * Primer segmento de toda página de `src/app` que exige sesión. Una carpeta de
 * página nueva entra aquí o en las públicas de `proxy.test.ts`.
 */
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
  "/platform",
  "/vault",
  "/cash",
  "/payroll",
  "/assistant",
] as const;

function isPrivatePath(pathname: string) {
  return privatePathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => {
    // Con sus opciones: el borrado de una sesión rota es `Max-Age=0`.
    to.cookies.set(cookie);
  });
}

/** `path`: ruta interna, con query opcional (`/login?next=…`). */
function redirectTo(request: NextRequest, path: string, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(new URL(path, request.url));
  copyCookies(response, redirectResponse);

  return redirectResponse;
}

/**
 * Usuario de la sesión, o `null` si no hay sesión válida. Una sesión rota
 * (access token caducado y refresh token inválido o revocado) llega como
 * `error` con `user: null`; si `getUser()` lanza, tampoco hay usuario: una
 * página protegida redirige al login, nunca responde 500.
 */
async function readSessionUser(supabase: SupabaseClient): Promise<User | null> {
  try {
    const { data } = await supabase.auth.getUser();

    return data.user;
  } catch {
    return null;
  }
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

  const user = await readSessionUser(supabase);

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
      // `response` ya lleva el borrado de las cookies de una sesión rota (lo hace
      // auth-js al fallar el refresh): el login no repite el refresh fallido.
      return redirectTo(request, buildLoginUrl(`${pathname}${request.nextUrl.search}`), response);
    }
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();
    const isPlatformPath = pathname === "/platform" || pathname.startsWith("/platform/");
    const isSuperadmin = profile?.role === "superadmin";

    if (isPlatformPath && !isSuperadmin) {
      return redirectTo(request, "/dashboard", response);
    }

    if (!isPlatformPath && isPrivatePath(pathname) && isSuperadmin) {
      return redirectTo(request, "/platform/dashboard", response);
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
    /*
     * Exclude static assets and `/api/*` route handlers.
     * Handlers auth themselves; keeping proxy off `/api` avoids routing interference.
     * Local `next dev` uses webpack (`package.json` → `dev`) because Turbopack on
     * Windows has served HTML 404s for registered App Router API routes.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
