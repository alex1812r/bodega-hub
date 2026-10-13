/**
 * @jest-environment node
 *
 * POS-F4 (caos pos-nav pasada 2, H1): el login de un usuario inactivo dejaba
 * puesta la cookie de la sesión que `signInWithPassword` acababa de crear. Con
 * `@supabase/ssr` y auth-js reales; solo se simulan la red y las cookies.
 */

import { cookies } from "next/headers";

import { getProfileByUserId } from "@/lib/supabase/auth/profile.server";

import { POST } from "./route";

const SUPABASE_URL = "http://lab-f4.localhost:54321";
const COOKIE_NAME = "sb-lab-f4-auth-token";
const USER = { aud: "authenticated", email: "contador@example.com", id: "22222222-2222-4222-8222-222222222222" };

type CookieOptions = { maxAge?: number };

const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;

function accessToken(expiresAt: number) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ exp: expiresAt, sub: USER.id })}.firma`;
}

describe("/api/auth/login · cookie de sesión de un usuario que no puede entrar (POS-F4 H1)", () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
  /** Último valor escrito por cookie, como lo aplica el navegador. */
  let jar: Map<string, { options?: CookieOptions; value: string }>;

  function hasSessionCookie() {
    return [...jar].some(
      ([name, cookie]) => name.startsWith(COOKIE_NAME) && cookie.value !== "" && cookie.options?.maxAge !== 0,
    );
  }

  function login() {
    return POST(
      new Request("http://localhost/api/auth/login", {
        body: JSON.stringify({ email: USER.email, password: "Clave123!" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  }

  beforeEach(() => {
    jar = new Map();
    // Como `cookies()` de Next en un route handler: lo escrito en la respuesta se lee de vuelta.
    mockedCookies.mockResolvedValue({
      getAll: () => [...jar].map(([name, cookie]) => ({ name, value: cookie.value })),
      set: (name: string, value: string, options?: CookieOptions) => {
        jar.set(name, { options, value });
      },
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/auth/v1/token?grant_type=password")) {
        return Response.json({
          access_token: accessToken(expiresAt),
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "refresh-nuevo",
          token_type: "bearer",
          user: USER,
        });
      }

      return new Response(null, { status: 204 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it("usuario inactivo → 403, revoca la sesión recién creada y la respuesta no deja cookie", async () => {
    (getProfileByUserId as jest.Mock).mockResolvedValue({ id: USER.id, isActive: false, name: "Contador", role: "contador" });

    const response = await login();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Tu usuario está inactivo." },
    });
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toContain(
      `POST ${SUPABASE_URL}/auth/v1/logout?scope=local`,
    );
    expect(hasSessionCookie()).toBe(false);
  });

  it("usuario activo → 200 y conserva la cookie de sesión", async () => {
    (getProfileByUserId as jest.Mock).mockResolvedValue({ id: USER.id, isActive: true, name: "Contador", role: "contador" });

    const response = await login();

    expect(response.status).toBe(200);
    expect(hasSessionCookie()).toBe(true);
  });
});
