/**
 * @jest-environment node
 */

import { readdirSync } from "node:fs";
import path from "node:path";

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

const APP_DIR = path.resolve(__dirname, "app");
/** Carpetas de `src/app` cuyas páginas se sirven sin sesión. */
const PUBLIC_PAGE_FOLDERS = new Set(["api-docs", "dev", "login"]);

/** Rutas de las páginas bajo `dir`, con los segmentos dinámicos sustituidos. */
function pageRoutes(dir: string, route: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const segment = entry.name.replace(/^\[.*\]$/, "sweep-id");

      return pageRoutes(path.join(dir, entry.name), `${route}/${segment}`);
    }

    return entry.name === "page.tsx" ? [route] : [];
  });
}

const pageFolders = readdirSync(APP_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ name: entry.name, routes: pageRoutes(path.join(APP_DIR, entry.name), `/${entry.name}`) }))
  .filter((folder) => folder.routes.length > 0);
const privateRoutes = pageFolders
  .filter((folder) => !PUBLIC_PAGE_FOLDERS.has(folder.name))
  .flatMap((folder) => folder.routes)
  .sort();
const publicRoutes = pageFolders
  .filter((folder) => PUBLIC_PAGE_FOLDERS.has(folder.name))
  .flatMap((folder) => folder.routes)
  .sort();

describe("proxy · POS-F2 toda página de la app exige sesión", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ALLOW_DEMO_AUTH = "false";
    withBrokenSession(async () => ({ data: { user: null }, error: null }));
  });

  afterAll(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("descubre las páginas de src/app y la lista de públicas no tiene entradas obsoletas", () => {
    expect(privateRoutes.length).toBeGreaterThan(30);
    expect([...PUBLIC_PAGE_FOLDERS].filter((name) => !pageFolders.some((folder) => folder.name === name))).toEqual([]);
  });

  it.each(privateRoutes)("%s sin sesión redirige a /login con next", async (route) => {
    const response = await proxy(request(`${route}?tab=1`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost/login?next=${encodeURIComponent(`${route}?tab=1`)}`,
    );
  });

  it.each(publicRoutes)("%s es pública: se sirve sin sesión", async (route) => {
    // `/dev/*` y `/api-docs` solo existen con el toolkit de desarrollo activo.
    process.env.API_DATA_SOURCE = "mock";

    const response = await proxy(request(route));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

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
