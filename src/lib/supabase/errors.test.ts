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
