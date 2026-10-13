/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");
jest.mock("../../../../lib/supabase/auth/profile.server");

import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from "@supabase/supabase-js";

import { getProfileByUserId } from "@/lib/supabase/auth/profile.server";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { POST } from "./route";

describe("/api/auth/login", () => {
  const mockSignInWithPassword = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      auth: {
        signInWithPassword: mockSignInWithPassword,
      },
    });
    (getProfileByUserId as jest.Mock).mockResolvedValue({
      deniedPermissions: [],
      email: "admin@example.com",
      grantedPermissions: [],
      id: "11111111-1111-4111-8111-111111111111",
      isActive: true,
      name: "Admin Demo",
      role: "admin",
    });
  });

  it("signs in and returns user profile from cookies flow", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: {
          email: "admin@example.com",
          id: "11111111-1111-4111-8111-111111111111",
        },
      },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "Admin123!",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("admin");
    expect(body.data.user.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "Admin123!",
    });
  });

  it("returns 401 for invalid credentials", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "wrong",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

/**
 * POS-F4 (caos pos-nav pasada 2, H1 y H2): un usuario que no puede entrar recibía
 * 500 y se quedaba con la cookie de la sesión recién creada; los rechazos y las
 * caídas del servidor de auth salían como 500 con el texto crudo.
 */
describe("/api/auth/login · rechazos sin 500 (POS-F4)", () => {
  const USER = { email: "contador@example.com", id: "22222222-2222-4222-8222-222222222222" };
  const mockSignInWithPassword = jest.fn();
  const mockSignOut = jest.fn();

  function login() {
    return POST(
      new Request("http://localhost/api/auth/login", {
        body: JSON.stringify({ email: USER.email, password: "Clave123!" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  }

  function rejectSignIn(error: unknown) {
    mockSignInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignInWithPassword.mockResolvedValue({ data: { user: USER }, error: null });
    mockSignOut.mockResolvedValue({ error: null });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      auth: { signInWithPassword: mockSignInWithPassword, signOut: mockSignOut },
    });
  });

  it.each([
    ["inactivo", { id: USER.id, isActive: false, name: "Contador", role: "contador" }, "Tu usuario está inactivo."],
    ["sin perfil", null, "Tu usuario no tiene un perfil asignado."],
  ])("usuario %s → 403 y cierra la sesión recién creada", async (_caso, profile, message) => {
    (getProfileByUserId as jest.Mock).mockResolvedValue(profile);

    const response = await login();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: "FORBIDDEN", message } });
    // `local`: revoca solo esta sesión y borra sus cookies de la respuesta.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("usuario inactivo cuya sesión no se pudo cerrar → 503, no un 403 con la cookie puesta", async () => {
    (getProfileByUserId as jest.Mock).mockResolvedValue({ id: USER.id, isActive: false, name: "Contador", role: "contador" });
    mockSignOut.mockResolvedValue({ error: new AuthRetryableFetchError("fetch failed", 0) });

    const response = await login();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "No se pudo iniciar sesión. Inténtalo de nuevo." },
    });
  });

  it("usuario activo no cierra la sesión", async () => {
    (getProfileByUserId as jest.Mock).mockResolvedValue({ id: USER.id, isActive: true, name: "Contador", role: "contador" });

    const response = await login();

    expect(response.status).toBe(200);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it.each<[string, unknown, number, string, string]>([
    // Formas exactas de GoTrue (auth-js 2.x).
    ["usuario bloqueado", new AuthApiError("User is banned", 400, "user_banned"), 403, "FORBIDDEN", "Tu usuario está bloqueado. Contacta al administrador."],
    ["usuario bloqueado sin código", new AuthApiError("User is banned", 400, undefined), 403, "FORBIDDEN", "Tu usuario está bloqueado. Contacta al administrador."],
    ["credenciales inválidas", new AuthApiError("Invalid login credentials", 400, "invalid_credentials"), 401, "UNAUTHORIZED", "Credenciales inválidas."],
    ["correo sin confirmar", new AuthApiError("Email not confirmed", 400, "email_not_confirmed"), 401, "UNAUTHORIZED", "Debes confirmar tu correo antes de ingresar."],
    ["límite de intentos", new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"), 429, "BAD_REQUEST", "Demasiados intentos de inicio de sesión. Espera un momento e inténtalo de nuevo."],
    ["otro rechazo 4xx", new AuthApiError("Unprocessable", 422, "validation_failed"), 400, "BAD_REQUEST", "No se pudo iniciar sesión con esos datos. Revísalos e inténtalo de nuevo."],
    ["sin red", new AuthRetryableFetchError("fetch failed", 0), 503, "INTERNAL_ERROR", "No se pudo iniciar sesión. Inténtalo de nuevo."],
    ["servidor de auth caído", new AuthRetryableFetchError("Bad Gateway", 502), 503, "INTERNAL_ERROR", "No se pudo iniciar sesión. Inténtalo de nuevo."],
    ["fallo interno de GoTrue", new AuthApiError("Database is unavailable", 500, "unexpected_failure"), 503, "INTERNAL_ERROR", "No se pudo iniciar sesión. Inténtalo de nuevo."],
    ["respuesta que no es JSON", new AuthUnknownError("Unexpected token <", new Error("boom")), 500, "INTERNAL_ERROR", "No se pudo iniciar sesión. Inténtalo de nuevo."],
  ])("signInWithPassword rechaza por %s → respuesta propia en español", async (_caso, error, status, code, message) => {
    rejectSignIn(error);

    const response = await login();

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code, message } });
    expect(getProfileByUserId).not.toHaveBeenCalled();
  });
});
