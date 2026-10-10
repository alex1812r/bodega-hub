/**
 * @jest-environment node
 *
 * POS-H3 · barrido de TODAS las rutas del BFF con una sesión rota: access token
 * caducado y refresh token inválido (cookies) o JWT rechazado (Bearer). Cada
 * handler debe responder 401 con la forma de error estándar, nunca 500. Las
 * rutas se descubren por el sistema de archivos.
 */

jest.unmock("./profile.server");

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { UNAUTHENTICATED_MESSAGE } from "@/lib/api/apiError";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

jest.mock("../route-client");

const API_DIR = path.resolve(__dirname, "..", "..", "..", "app", "api");
const HANDLER_EXPORT =
  /export\s+(?:async\s+function|function|const)\s+(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/g;
const PARAM_SEGMENT = /\[([^\]]+)\]/g;
const UNAUTHORIZED_BODY = { error: { code: "UNAUTHORIZED", message: UNAUTHENTICATED_MESSAGE } };

/**
 * Handlers que no exigen sesión de usuario. Clave: `MÉTODO /api/...`; valor:
 * motivo. Un handler nuevo que no esté aquí debe responder 401.
 */
const PUBLIC_HANDLERS: Record<string, string> = {
  "GET /api/cron/cash-sessions/auto-close": "se autentica con el secreto del cron, no con sesión",
  "GET /api/docs": "documentación pública del toolkit de desarrollo",
  "GET /api/openapi": "especificación pública del toolkit de desarrollo",
  "POST /api/auth/login": "crea la sesión; su 401 es de credenciales incorrectas",
  "POST /api/auth/logout": "cerrar una sesión ya caducada no es un error",
  "POST /api/cron/cash-sessions/auto-close": "se autentica con el secreto del cron, no con sesión",
};

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Handler = { file: string; method: string; name: string; url: string };

const mockedHeaders = headers as jest.MockedFunction<typeof headers>;
const mockedCreateClient = createRouteSupabaseClient as jest.MockedFunction<
  typeof createRouteSupabaseClient
>;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return walk(full);
    }

    return entry.name === "route.ts" ? [full] : [];
  });
}

const handlers: Handler[] = walk(API_DIR)
  .sort()
  .flatMap((file) => {
    const relative = path.relative(API_DIR, file).split(path.sep).join("/");
    const url = `/api/${path.posix.dirname(relative)}`;

    return [...readFileSync(file, "utf8").matchAll(HANDLER_EXPORT)].map((match) => ({
      file,
      method: match[1],
      name: `${match[1]} ${url}`,
      url,
    }));
  });

const protectedCases = handlers
  .filter((handler) => !(handler.name in PUBLIC_HANDLERS))
  .map((handler) => [handler.name, handler] as const);

function withSession(getUserError: unknown, authorization?: string) {
  mockedHeaders.mockResolvedValue(
    new Headers(authorization ? { authorization } : {}) as unknown as Awaited<
      ReturnType<typeof headers>
    >,
  );
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: jest.fn(async () => ({ data: { user: null }, error: getUserError })) },
  } as unknown as Awaited<ReturnType<typeof createRouteSupabaseClient>>);
}

async function call(handler: Handler, authorization?: string) {
  const routeModule = (await import(handler.file)) as Record<string, RouteHandler>;
  const params = Object.fromEntries(
    [...handler.url.matchAll(PARAM_SEGMENT)].map((match) => [match[1], `sweep-${match[1]}`]),
  );
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(handler.method);
  const request = new Request(`http://localhost${handler.url.replace(PARAM_SEGMENT, "sweep-$1")}`, {
    body: hasBody ? "{}" : undefined,
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    method: handler.method,
  });

  return routeModule[handler.method](request, { params: Promise.resolve(params) });
}

describe("POS-H3 · sesión caducada en las rutas del BFF", () => {
  const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;

  beforeEach(() => {
    process.env.ALLOW_DEMO_AUTH = "false";
  });

  afterAll(() => {
    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;
  });

  it("descubre las rutas del BFF y la lista de públicas no tiene entradas obsoletas", () => {
    expect(handlers.length).toBeGreaterThan(50);
    expect(Object.keys(PUBLIC_HANDLERS).filter((name) => !handlers.some((h) => h.name === name))).toEqual([]);
  });

  it.each(protectedCases)(
    "%s responde 401 con cookies de sesión y refresh token inválido",
    async (_name, handler) => {
      withSession(
        new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found"),
      );

      const response = await call(handler);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual(UNAUTHORIZED_BODY);
    },
  );

  it.each(protectedCases)(
    "%s responde 401 con un Bearer caducado",
    async (_name, handler) => {
      withSession(new AuthApiError("invalid JWT: token is expired", 403, "bad_jwt"), "Bearer expired");

      const response = await call(handler, "Bearer expired");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual(UNAUTHORIZED_BODY);
    },
  );

  it("no convierte en 401 una caída de Supabase: sigue siendo 5xx", async () => {
    const handler = handlers.find((candidate) => candidate.name === "GET /api/auth/me");

    if (!handler) {
      throw new Error("GET /api/auth/me no existe");
    }

    withSession(new AuthRetryableFetchError("fetch failed", 0));

    const response = await call(handler);

    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
