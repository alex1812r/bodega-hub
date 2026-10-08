import { act, renderHook } from "@testing-library/react";

import {
  type PendingSettlement,
  clearPendingSettlement,
  hasPendingSettlement,
  loadPendingSettlement,
  savePendingSettlement,
  useHasPendingSettlement,
} from "./pendingSettlementStore";

const scope = { contactId: "contact-1", type: "sale" } as const;

function settlement(overrides: Partial<PendingSettlement> = {}): PendingSettlement {
  return {
    currency: "VES",
    payload: {
      amount: 100,
      bankName: undefined,
      currency: "VES",
      method: "efectivo_ves",
      notes: undefined,
      phone: undefined,
      referenceCode: undefined,
    },
    rows: [
      {
        allocation: {
          amount: 100,
          appliedVes: 100,
          document: {
            createdAt: "2026-09-01T14:00:00.000Z",
            id: "sale-1",
            number: "F-0001",
            pendingVes: 8475,
          },
          equivalent: 2.5,
          remainingVes: 8375,
        },
        clientRequestId: "key-1",
        errorMessage: "ERR_UPSTREAM_TIMEOUT",
        status: "failed",
        uncertain: true,
      },
    ],
    values: {
      amount: "100",
      bankName: "",
      method: "efectivo_ves",
      notes: "",
      phone: "",
      referenceCode: "",
    },
    ...overrides,
  };
}

describe("pendingSettlementStore", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("guarda y devuelve el abono con sus claves, documento, monto y campos enviados", () => {
    expect(loadPendingSettlement(scope)).toBeNull();
    expect(hasPendingSettlement(scope)).toBe(false);

    expect(savePendingSettlement(scope, settlement())).toBe(true);

    expect(hasPendingSettlement(scope)).toBe(true);
    // JSON no conserva las claves con `undefined`: se compara lo que sí viaja.
    expect(loadPendingSettlement(scope)).toEqual(JSON.parse(JSON.stringify(settlement())));
    expect(loadPendingSettlement(scope)?.rows[0].clientRequestId).toBe("key-1");
  });

  it("separa por contacto y por tipo de documento", () => {
    savePendingSettlement(scope, settlement());

    expect(loadPendingSettlement({ contactId: "contact-1", type: "purchase" })).toBeNull();
    expect(loadPendingSettlement({ contactId: "contact-2", type: "sale" })).toBeNull();
  });

  it("al borrarlo deja de existir", () => {
    savePendingSettlement(scope, settlement());
    clearPendingSettlement(scope);

    expect(loadPendingSettlement(scope)).toBeNull();
    expect(hasPendingSettlement(scope)).toBe(false);
  });

  it.each([
    ["JSON ilegible", "{no es json"],
    ["sin filas", JSON.stringify({ ...settlement(), rows: [] })],
    [
      "fila sin clave de idempotencia",
      JSON.stringify({
        ...settlement(),
        rows: [{ ...settlement().rows[0], clientRequestId: "" }],
      }),
    ],
    [
      "estado desconocido",
      JSON.stringify({ ...settlement(), rows: [{ ...settlement().rows[0], status: "otro" }] }),
    ],
    ["moneda desconocida", JSON.stringify({ ...settlement(), currency: "EUR" })],
  ])("descarta un valor corrupto (%s) en vez de devolverlo", (_name, raw) => {
    savePendingSettlement(scope, settlement());
    const [key] = Object.keys(window.sessionStorage);

    window.sessionStorage.setItem(key, raw);

    expect(loadPendingSettlement(scope)).toBeNull();
    expect(hasPendingSettlement(scope)).toBe(false);
  });

  it("si el navegador no deja guardar, devuelve false y no lanza", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    try {
      expect(savePendingSettlement(scope, settlement())).toBe(false);
    } finally {
      setItem.mockRestore();
    }

    expect(hasPendingSettlement(scope)).toBe(false);
  });

  it("useHasPendingSettlement sigue los cambios del abono guardado", () => {
    const { result } = renderHook(() => useHasPendingSettlement(scope));

    expect(result.current).toBe(false);

    act(() => {
      savePendingSettlement(scope, settlement());
    });
    expect(result.current).toBe(true);

    act(() => {
      clearPendingSettlement(scope);
    });
    expect(result.current).toBe(false);
  });
});
