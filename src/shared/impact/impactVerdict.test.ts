import { impactQueryKey, impactQueryOptions } from "./impactQuery";
import { firstInexact, fromCents, impactAllowed, impactRejected, toCents } from "./impactVerdict";

describe("veredicto de un impact", () => {
  it("permitido: sin motivo", () => {
    expect(impactAllowed()).toEqual({ allowed: true, reason: null, reasonCode: null });
  });

  it("rechazado: mensaje y código de la RPC", () => {
    expect(impactRejected("CONFLICT", "La venta ya fue cancelada o devuelta")).toEqual({
      allowed: false,
      reason: "La venta ya fue cancelada o devuelta",
      reasonCode: "CONFLICT",
    });
  });
});

describe("firstInexact", () => {
  it("devuelve la primera parte inexacta o null", () => {
    expect(firstInexact([{ inexact: null }, { inexact: null }])).toBeNull();
    expect(
      firstInexact([{ inexact: null }, { inexact: { reason: "a" } }, { inexact: { reason: "b" } }]),
    ).toEqual({ reason: "a" });
  });
});

describe("dinero en céntimos", () => {
  it("suma sin error de coma flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(fromCents(toCents(0.1) + toCents(0.2))).toBe(0.3);
    expect(fromCents(toCents(1000.1) + toCents(2000.2))).toBe(3000.3);
    expect(toCents(19.99)).toBe(1999);
  });
});

describe("opciones de consulta de un impact", () => {
  it("no guarda caché ni reintenta", () => {
    expect(impactQueryOptions).toEqual({
      gcTime: 0,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
    });
  });

  it("clave por documento, id y acción", () => {
    expect(impactQueryKey("sales", "sale-001", "cancel")).toEqual([
      "impact",
      "sales",
      "sale-001",
      "cancel",
    ]);
  });
});
