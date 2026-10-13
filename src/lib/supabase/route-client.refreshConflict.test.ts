/**
 * @jest-environment node
 *
 * POS-F4 (caos pos-nav pasada 2, N1): access token caducado + refresh token VÁLIDO
 * + ráfaga en paralelo con la misma cookie. GoTrue responde 409 `conflict` a parte
 * de los refrescos; auth-js lo tomaba por un rechazo de la credencial y borraba la
 * cookie de sesión: un usuario con sesión válida quedaba fuera.
 *
 * Con `@supabase/ssr` y auth-js reales; solo se simulan la red y las cookies.
 */

import { cookies } from "next/headers";

import { isAuthServiceFailure, isSessionAuthError } from "./auth/sessionErrors";
import { createRouteSupabaseClient } from "./route-client";

const SUPABASE_URL = "http://lab-f4.localhost:54321";
const COOKIE_NAME = "sb-lab-f4-auth-token";
const REFRESH_URL = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
const CONFLICT_BODY = {
  code: 409,
  error_code: "conflict",
  msg: "Too many concurrent token refresh requests on the same session or refresh token",
};
const USER = { aud: "authenticated", email: "vendedor@example.com", id: "33333333-3333-4333-8333-333333333333" };

type StoredCookie = { name: string; options?: { maxAge?: number }; value: string };

const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;

function jwt(expiresAt: number) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ exp: expiresAt, sub: USER.id })}.firma`;
}

function session(expiresAt: number, refreshToken: string) {
  return {
    access_token: jwt(expiresAt),
    expires_at: expiresAt,
    expires_in: 3600,
    refresh_token: refreshToken,
    token_type: "bearer",
    user: USER,
  };
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

/** Cookies de la petición: sesión con el access token caducado hace un minuto. */
function mountExpiredSessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const written: StoredCookie[] = [];
  const expired = `base64-${Buffer.from(JSON.stringify(session(now - 60, "refresh-valido"))).toString("base64url")}`;

  mockedCookies.mockResolvedValue({
    getAll: () => [{ name: COOKIE_NAME, value: expired }],
    set: (name: string, value: string, options?: StoredCookie["options"]) => {
      written.push({ name, options, value });
    },
  } as unknown as Awaited<ReturnType<typeof cookies>>);

  return written;
}

function clearsSession(written: StoredCookie[]) {
  return written.some(
    (cookie) => cookie.name.startsWith(COOKIE_NAME) && (cookie.value === "" || cookie.options?.maxAge === 0),
  );
}

describe("createRouteSupabaseClient · 409 del refresh concurrente (POS-F4 N1)", () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

  function refreshCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url) === REFRESH_URL).length;
  }

  beforeEach(() => {
    // auth-js avisa por consola de cada refresh fallido.
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it("reintenta el refresh y la petición sigue con su sesión, sin borrar la cookie", async () => {
    const written = mountExpiredSessionCookie();
    const now = Math.floor(Date.now() / 1000);

    fetchMock.mockImplementation(async (url) => {
      if (String(url) === REFRESH_URL) {
        // La primera choca con otra petición de la ráfaga; la siguiente ya recibe la sesión rotada.
        return refreshCalls() === 1
          ? jsonResponse(CONFLICT_BODY, 409)
          : jsonResponse(session(now + 3600, "refresh-rotado"), 200);
      }

      return jsonResponse(USER, 200);
    });

    const supabase = await createRouteSupabaseClient();
    const { data, error } = await supabase.auth.getUser();

    expect(error).toBeNull();
    expect(data.user?.id).toBe(USER.id);
    expect(refreshCalls()).toBe(2);
    expect(clearsSession(written)).toBe(false);
  });

  it("si el 409 persiste es un fallo transitorio del servicio: ni 401 ni cookie borrada", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    const written = mountExpiredSessionCookie();

    fetchMock.mockImplementation(async () => jsonResponse(CONFLICT_BODY, 409));

    const supabase = await createRouteSupabaseClient();
    const pending = supabase.auth.getUser();

    // auth-js reintenta con espera exponencial hasta agotar su ventana (30 s).
    await jest.advanceTimersByTimeAsync(60_000);
    const { data, error } = await pending;

    expect(data.user).toBeNull();
    expect(isSessionAuthError(error)).toBe(false);
    expect(isAuthServiceFailure(error)).toBe(true);
    expect(refreshCalls()).toBeGreaterThan(1);
    expect(clearsSession(written)).toBe(false);
  });

  it("no altera otros 409 ni las demás respuestas del servidor de auth", async () => {
    const written = mountExpiredSessionCookie();
    fetchMock.mockImplementation(async (url) =>
      String(url) === REFRESH_URL
        ? jsonResponse({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, 400)
        : jsonResponse(CONFLICT_BODY, 409),
    );

    const supabase = await createRouteSupabaseClient();
    const { error } = await supabase.auth.getUser();

    // Refresh token inválido de verdad: sigue siendo «sin sesión» (401), sin reintentos.
    expect(isSessionAuthError(error)).toBe(true);
    expect(refreshCalls()).toBe(1);
    expect(clearsSession(written)).toBe(true);
  });
});
