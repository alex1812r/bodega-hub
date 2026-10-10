/**
 * @jest-environment node
 */

import { mapSupabaseError } from "@/lib/supabase/errors";

describe("mapSupabaseError", () => {
  it("maps unique violation to 409", () => {
    const error = mapSupabaseError({ code: "23505", message: "duplicate key" });

    expect(error.status).toBe(409);
    expect(error.code).toBe("CONFLICT");
  });

  it("maps not found to 404", () => {
    const error = mapSupabaseError({ code: "PGRST116", message: "not found" });

    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("maps check violation to 400", () => {
    const error = mapSupabaseError({ code: "23514", message: "check failed" });

    expect(error.status).toBe(400);
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("maps invalid login to 401", () => {
    const error = mapSupabaseError({ message: "Invalid login credentials" });

    expect(error.status).toBe(401);
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("maps insufficient stock to 400", () => {
    const error = mapSupabaseError({ message: "Stock insuficiente" });

    expect(error.status).toBe(400);
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("maps missing product to 404", () => {
    const error = mapSupabaseError({ message: "Producto no encontrado" });

    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
  });
});

/**
 * AUD-04: un error de Postgres sin mapear no llega al cliente con su texto
 * (nombres de columnas y relaciones); el detalle queda en el log del servidor.
 */
describe("mapSupabaseError · errores sin mapear (AUD-04)", () => {
  const GENERIC = "Ocurrió un error inesperado. Intenta de nuevo.";
  let logged: jest.SpyInstance;

  beforeEach(() => {
    logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it.each([
    [
      "columna inexistente (42703)",
      { code: "42703", message: 'column contacts.secret_notes does not exist' },
    ],
    [
      "relación inexistente (42P01)",
      { code: "42P01", details: "tabla interna", message: 'relation "public.store_vaults_audit" does not exist' },
    ],
    [
      "filtro mal formado de PostgREST (PGRST100)",
      { code: "PGRST100", message: '"failed to parse logic tree ((name.ilike.%a(b%))"' },
    ],
    ["error sin código", { message: "connection terminated unexpectedly" }],
    ["Error de JavaScript", new Error("fetch failed: ECONNRESET 10.0.0.12:5432")],
  ])("%s: 500 con mensaje genérico en español y el detalle solo en el log", (_caso, error) => {
    const mapped = mapSupabaseError(error);

    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.message).toBe(GENERIC);
    expect(mapped.details).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls[0])).toContain(
      error instanceof Error ? "ECONNRESET" : (error.message as string).slice(0, 12).replace(/"/g, '\\"'),
    );
  });

  it.each(["PT400", "PT403", "PT404", "PT409"])(
    "%s sigue pasando el mensaje de la RPC tal cual, sin log",
    (code) => {
      const mapped = mapSupabaseError({ code, message: "La compra ya fue recibida" });

      expect(mapped.message).toBe("La compra ya fue recibida");
      expect(mapped.status).toBe(Number(code.slice(2)));
      expect(logged).not.toHaveBeenCalled();
    },
  );

  it("P0001 con mensaje (regla de negocio de una RPC) sigue pasando tal cual", () => {
    const mapped = mapSupabaseError({ code: "P0001", message: "El precio no puede ser negativo" });

    expect(mapped).toMatchObject({ message: "El precio no puede ser negativo", status: 400 });
    expect(logged).not.toHaveBeenCalled();
  });
});
