/**
 * STK-413 · regresión de C12 (rechazos de negocio y de entrada que salen como
 * 500 `INTERNAL_ERROR` o con el texto crudo de Postgres).
 *
 * Los `it.failing` describen el comportamiento SANO y hoy fallan: al corregir
 * `mapSupabaseError` (fase 5) hay que convertirlos en `it`.
 */
import { mapSupabaseError } from "./errors";

type PostgresErrorCase = { code: string; message: string };

function isClientError(status: number) {
  return status >= 400 && status < 500;
}

describe("C12 · mapSupabaseError no convierte rechazos en 500", () => {
  // Causa: las RPC de compras hacen `raise exception` sin SQLSTATE `PT4xx`; llega
  // P0001 y cae al `default` → 500 INTERNAL_ERROR.
  // Evento: caos/9.2.md (recibir x2: `200` + `500 INTERNAL_ERROR Solo se pueden recibir
  // compras en estado pedido`, 60/60) y caos/propios.md N5.
  // Código: src/lib/supabase/errors.ts:26-49 (switch sin P0001) y :93 (default 500).
  it.failing.each<[string, PostgresErrorCase]>([
    ["recibir una compra ya recibida", { code: "P0001", message: "Solo se pueden recibir compras en estado pedido" }],
    ["revertir una compra sin stock", { code: "P0001", message: "No hay stock suficiente para revertir la compra" }],
    ["cancelar o devolver dos veces una compra", { code: "P0001", message: "La compra ya fue cancelada o devuelta" }],
    ["contacto de otra tienda", { code: "P0001", message: "Contacto no pertenece a tu tienda" }],
  ])("mapea a 4xx la regla de negocio P0001: %s", (_caso, error) => {
    const mapped = mapSupabaseError(error);

    expect(isClientError(mapped.status)).toBe(true);
    expect(mapped.code).not.toBe("INTERNAL_ERROR");
    // El cajero necesita leer la regla, no un genérico.
    expect(mapped.message).toBe(error.message);
  });

  // Causa: 40P01 no está en el switch → 500 genérico, indistinguible de una caída;
  // el cliente no sabe que basta reintentar.
  // Evento: causes.md C12 (fix propuesto: 40P01 → 409/reintento); caos/9.2.md (ráfagas x20).
  // Código: src/lib/supabase/errors.ts:31-49.
  it.failing("mapea el deadlock 40P01 a un estado reintentable (409 o 503), no a 500", () => {
    const mapped = mapSupabaseError({ code: "40P01", message: "deadlock detected" });

    expect([409, 503]).toContain(mapped.status);
  });

  // Causa: las cuatro reversiones no comprueban `found` tras el `select … for update`;
  // el 23502 resultante se reenvía con el mensaje literal de Postgres.
  // Evento: caos/9.7.md (cancelar/devolver con el producto fuera de tienda:
  // `400 BAD_REQUEST null value in column "current_stock" of relation "products" …`).
  // Código: src/lib/supabase/errors.ts:39-46 (`error.message` tal cual).
  it.failing("no reenvía al cliente el texto crudo del 23502 de una reversión", () => {
    const mapped = mapSupabaseError({
      code: "23502",
      message:
        'null value in column "current_stock" of relation "products" violates not-null constraint',
    });

    expect(isClientError(mapped.status)).toBe(true);
    expect(mapped.message).not.toMatch(/null value in column|violates not-null|relation "/i);
  });

  // Causa: los errores de datos de la clase 22 (rango/formato) no están en el switch.
  // Evento: caos/propios.md N5 (cantidad 1e12 / 2147483648, precio 1e15,
  // `from=2026-13-45` → 500 en ventas, compras, ajustes y listados).
  // Código: src/lib/supabase/errors.ts:31-49 (solo 22P02 de la clase 22).
  it.failing.each<[string, PostgresErrorCase]>([
    ["numeric overflow", { code: "22003", message: "numeric field overflow" }],
    ["entero fuera de rango", { code: "22003", message: "integer out of range" }],
    [
      "entero fuera de rango al convertir",
      { code: "22003", message: 'value "1000000000000" is out of range for type integer' },
    ],
    [
      "fecha fuera de rango",
      { code: "22008", message: 'date/time field value out of range: "2026-13-45"' },
    ],
    [
      "fecha con formato inválido",
      { code: "22007", message: 'invalid input syntax for type date: "ayer"' },
    ],
  ])("mapea a 400 la entrada inválida: %s", (_caso, error) => {
    const mapped = mapSupabaseError(error);

    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe("BAD_REQUEST");
  });

  // Ya sanos hoy (van como `it` normal): sirven de control para que un arreglo
  // no los rompa.
  it.each<[string, PostgresErrorCase]>([
    ["uuid inválido (22P02)", { code: "22P02", message: 'invalid input syntax for type uuid: "abc"' }],
    ["JSON inválido en Postgres (22P02)", { code: "22P02", message: "invalid input syntax for type json" }],
    ["check violation (23514)", { code: "23514", message: "violates check constraint" }],
  ])("mantiene en 400 la entrada inválida: %s", (_caso, error) => {
    expect(mapSupabaseError(error).status).toBe(400);
  });

  it("mantiene en 500 un error desconocido sin código", () => {
    const mapped = mapSupabaseError({ message: "connection terminated unexpectedly" });

    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("INTERNAL_ERROR");
  });
});
