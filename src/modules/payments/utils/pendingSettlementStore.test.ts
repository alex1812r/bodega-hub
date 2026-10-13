import { act, renderHook } from "@testing-library/react";

import {
  type PendingSettlement,
  clearPendingSettlement,
  hasPendingSettlement,
  loadPendingSettlement,
  savePendingSettlement,
  useHasPendingSettlement,
} from "./pendingSettlementStore";

const session = { storeId: "store-1", userId: "user-admin" };
const scope = { contactId: "contact-1", session, type: "sale" } as const;

/** Lo que queda en `sessionStorage`: el abono junto a la sesión que lo guardó. */
function stored(value: unknown, owner: unknown = session) {
  return JSON.stringify({ session: owner, settlement: value });
}

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

    expect(loadPendingSettlement({ ...scope, type: "purchase" })).toBeNull();
    expect(loadPendingSettlement({ ...scope, contactId: "contact-2" })).toBeNull();
  });

  it("al borrarlo deja de existir", () => {
    savePendingSettlement(scope, settlement());
    clearPendingSettlement(scope);

    expect(loadPendingSettlement(scope)).toBeNull();
    expect(hasPendingSettlement(scope)).toBe(false);
  });

  it.each([
    ["JSON ilegible", "{no es json"],
    ["sin filas", stored({ ...settlement(), rows: [] })],
    [
      "fila sin clave de idempotencia",
      stored({
        ...settlement(),
        rows: [{ ...settlement().rows[0], clientRequestId: "" }],
      }),
    ],
    [
      "estado desconocido",
      stored({ ...settlement(), rows: [{ ...settlement().rows[0], status: "otro" }] }),
    ],
    ["moneda desconocida", stored({ ...settlement(), currency: "EUR" })],
    ["sin la sesión que lo guardó", JSON.stringify(settlement())],
    ["guardado por otro usuario", stored(settlement(), { storeId: "store-1", userId: "user-seller" })],
    ["guardado en otra tienda", stored(settlement(), { storeId: "store-2", userId: "user-admin" })],
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

describe("pendingSettlementStore · PAG-F8: el abono es de la sesión que lo guardó", () => {
  const seller = { storeId: "store-1", userId: "user-seller" };
  const otherStore = { storeId: "store-2", userId: "user-admin" };

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("la clave de sessionStorage lleva tienda y usuario", () => {
    savePendingSettlement(scope, settlement());

    const [key] = Object.keys(window.sessionStorage);

    expect(key).toContain("store-1");
    expect(key).toContain("user-admin");
  });

  it("otro usuario u otra tienda en la misma pestaña no ven el abono ni lo borran", () => {
    savePendingSettlement(scope, settlement());

    for (const other of [seller, otherStore, { storeId: null, userId: "user-admin" }]) {
      expect(hasPendingSettlement({ ...scope, session: other })).toBe(false);
      expect(loadPendingSettlement({ ...scope, session: other })).toBeNull();
      clearPendingSettlement({ ...scope, session: other });
    }

    // Sigue ahí para quien lo guardó.
    expect(loadPendingSettlement(scope)?.rows[0].clientRequestId).toBe("key-1");
  });

  it("sin sesión conocida no guarda, no lee y no borra nada", () => {
    savePendingSettlement(scope, settlement());

    for (const unknown of [null, undefined]) {
      const anonymous = { ...scope, session: unknown };

      expect(savePendingSettlement(anonymous, settlement())).toBe(false);
      expect(hasPendingSettlement(anonymous)).toBe(false);
      expect(loadPendingSettlement(anonymous)).toBeNull();
      clearPendingSettlement(anonymous);
    }

    expect(window.sessionStorage).toHaveLength(1);
    expect(hasPendingSettlement(scope)).toBe(true);
  });

  it("useHasPendingSettlement cambia con la sesión", () => {
    savePendingSettlement(scope, settlement());

    const { rerender, result } = renderHook(
      ({ owner }: { owner: typeof session | null }) =>
        useHasPendingSettlement({ ...scope, session: owner }),
      { initialProps: { owner: null as typeof session | null } },
    );

    expect(result.current).toBe(false);

    rerender({ owner: session });
    expect(result.current).toBe(true);

    rerender({ owner: seller });
    expect(result.current).toBe(false);
  });
});
