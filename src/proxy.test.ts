/**
 * @jest-environment node
 */

import { createServerClient } from "@supabase/ssr";
import { AuthApiError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(),
}));

type CookieToSet = { name: string; options?: Record<string, unknown>; value: string };
type ClientOptions = {
  cookies: { setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void };
};

const mockedCreateServerClient = createServerClient as jest.MockedFunction<typeof createServerClient>;
const SESSION_COOKIE = "sb-example-auth-token";

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=base64-broken` },
  });
}

/** Cliente cuyo `getUser()` se comporta como auth-js ante una sesión rota. */
function withBrokenSession(getUser: (options: ClientOptions) => Promise<unknown>) {
  mockedCreateServerClient.mockImplementation(((_url: string, _key: string, options: ClientOptions) => ({
    auth: { getUser: () => getUser(options) },
  })) as unknown as typeof createServerClient);
}

describe("proxy · POS-H3 sesión rota en una página protegida", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ALLOW_DEMO_AUTH = "false";
  });

  afterAll(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("redirects to /login with the path and query in next and clears the broken session cookie", async () => {
    withBrokenSession(async (options) => {
      // auth-js borra la sesión al fallar el refresh de forma definitiva.
      options.cookies.setAll([{ name: SESSION_COOKIE, options: { maxAge: 0, path: "/" }, value: "" }], {});

      return {
        data: { user: null },
        error: new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found"),
      };
    });

    const response = await proxy(request("/sales?status=pending&page=2"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?next=%2Fsales%3Fstatus%3Dpending%26page%3D2",
    );
    expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({ maxAge: 0, value: "" });
  });

  it("redirects to /login instead of failing when getUser throws", async () => {
    withBrokenSession(async () => {
      throw new Error("unexpected auth failure");
    });

    const response = await proxy(request("/inventory"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login?next=%2Finventory");
  });

  it("drops next when the requested URL carries an unsafe nested redirect", async () => {
    withBrokenSession(async () => ({ data: { user: null }, error: null }));

    const response = await proxy(request("/sales?returnTo=https%3A%2F%2Fevil.example"));

    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("lets /login render with a broken session", async () => {
    withBrokenSession(async () => ({
      data: { user: null },
      error: new AuthApiError("Session not found", 403, "session_not_found"),
    }));

    const response = await proxy(request("/login?next=%2Fsales"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
