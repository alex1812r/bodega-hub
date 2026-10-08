import { act, renderHook } from "@testing-library/react";

import { createUnitDraftItem } from "../types";
import {
  purchaseDraftStorageKey,
  type PurchaseDraftContent,
} from "../utils/purchaseDraftStorage";
import { usePurchaseDraftStorage } from "./usePurchaseDraftStorage";

let mockProfile: { storeId: string | null; user: { id: string } } | null = {
  storeId: "store-1",
  user: { id: "user-1" },
};

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, profile: mockProfile }),
}));

const key = purchaseDraftStorageKey({ storeId: "store-1", userId: "user-1" });

function buildContent(overrides: Partial<PurchaseDraftContent> = {}): PurchaseDraftContent {
  return {
    costCurrency: "ves",
    discountRef: 0,
    lineMeta: { "prod-cable": { name: "Cable HDMI", sku: "ELE-CAB-001", taxRate: 16 } },
    lines: {
      items: [
        createUnitDraftItem({ id: "line-1", productId: "prod-cable", rateVes: 510, unitCostRef: 2 }),
      ],
      locks: { locked: {} },
      review: { baselines: {}, reviewed: {} },
      taxState: { choices: {}, exempt: false },
    },
    notes: "",
    rateVes: 510,
    status: "recibido",
    supplierId: "cont-supplier",
    ...overrides,
  };
}

const emptyLines: PurchaseDraftContent["lines"] = {
  items: [],
  locks: { locked: {} },
  review: { baselines: {}, reviewed: {} },
  taxState: { choices: {}, exempt: false },
};

beforeEach(() => {
  window.localStorage.clear();
  mockProfile = { storeId: "store-1", user: { id: "user-1" } };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("usePurchaseDraftStorage", () => {
  it("lo que guarda esta visita no se le ofrece a ella, pero sí a la siguiente", () => {
    const first = renderHook(() => usePurchaseDraftStorage());

    expect(first.result.current.pending).toBeNull();

    act(() => first.result.current.sync(buildContent({ notes: "Factura 1" })));

    expect(window.localStorage.getItem(key)).toContain("Factura 1");
    expect(first.result.current.pending).toBeNull();

    first.unmount();

    const second = renderHook(() => usePurchaseDraftStorage());

    expect(second.result.current.pending).toMatchObject({
      notes: "Factura 1",
      storeId: "store-1",
      supplierId: "cont-supplier",
      userId: "user-1",
      version: 1,
    });
  });

  it("con un borrador pendiente sin decidir no lo pisa", () => {
    renderHook(() => usePurchaseDraftStorage()).result.current.sync(
      buildContent({ notes: "anterior" }),
    );

    const next = renderHook(() => usePurchaseDraftStorage());

    act(() => next.result.current.sync(buildContent({ notes: "nuevo" })));

    expect(window.localStorage.getItem(key)).toContain("anterior");
    expect(next.result.current.pending).toMatchObject({ notes: "anterior" });
  });

  it("adopt deja de ofrecerlo y vuelve a guardar; clear lo borra", () => {
    const previous = renderHook(() => usePurchaseDraftStorage());
    act(() => previous.result.current.sync(buildContent({ notes: "anterior" })));
    previous.unmount();

    const next = renderHook(() => usePurchaseDraftStorage());

    act(() => next.result.current.adopt());
    expect(next.result.current.pending).toBeNull();

    act(() => next.result.current.sync(buildContent({ notes: "restaurado y editado" })));
    expect(window.localStorage.getItem(key)).toContain("restaurado y editado");

    act(() => next.result.current.clear());
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(next.result.current.pending).toBeNull();
  });

  it("descartar el pendiente (clear) lo borra y deja guardar lo nuevo", () => {
    const previous = renderHook(() => usePurchaseDraftStorage());
    act(() => previous.result.current.sync(buildContent({ notes: "anterior" })));
    previous.unmount();

    const next = renderHook(() => usePurchaseDraftStorage());

    act(() => next.result.current.clear());
    expect(window.localStorage.getItem(key)).toBeNull();

    act(() => next.result.current.sync(buildContent({ notes: "nuevo" })));
    expect(window.localStorage.getItem(key)).toContain("nuevo");
  });

  it("sin algo que perder no guarda, y borra lo que esta visita había guardado", () => {
    const { result } = renderHook(() => usePurchaseDraftStorage());

    act(() => result.current.sync(buildContent({ lines: emptyLines })));
    expect(window.localStorage.getItem(key)).toBeNull();

    act(() => result.current.sync(buildContent()));
    expect(window.localStorage.getItem(key)).not.toBeNull();

    // Cambió de proveedor: la compra quedó sin líneas.
    act(() => result.current.sync(buildContent({ lines: emptyLines })));
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("no ofrece el borrador de otro usuario ni el de otra tienda", () => {
    const owner = renderHook(() => usePurchaseDraftStorage());
    act(() => owner.result.current.sync(buildContent()));
    owner.unmount();

    mockProfile = { storeId: "store-1", user: { id: "user-2" } };
    expect(renderHook(() => usePurchaseDraftStorage()).result.current.pending).toBeNull();

    mockProfile = { storeId: "store-2", user: { id: "user-1" } };
    expect(renderHook(() => usePurchaseDraftStorage()).result.current.pending).toBeNull();
  });

  it("descarta en silencio un borrador corrupto y deja guardar encima", () => {
    window.localStorage.setItem(key, "{esto no es un borrador");

    const { result } = renderHook(() => usePurchaseDraftStorage());

    expect(result.current.pending).toBeNull();

    act(() => result.current.sync(buildContent({ notes: "bueno" })));
    expect(window.localStorage.getItem(key)).toContain("bueno");
  });

  it("sin usuario cargado no lee ni escribe", () => {
    mockProfile = null;

    const { result } = renderHook(() => usePurchaseDraftStorage());

    act(() => result.current.sync(buildContent()));
    act(() => result.current.clear());

    expect(result.current.pending).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("si localStorage lanza al leer, escribir o borrar, no rompe", () => {
    const failure = () => {
      throw new DOMException("QuotaExceededError");
    };

    jest.spyOn(Storage.prototype, "getItem").mockImplementation(failure);
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(failure);
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(failure);

    const { result } = renderHook(() => usePurchaseDraftStorage());

    expect(result.current.pending).toBeNull();
    expect(() => {
      act(() => result.current.sync(buildContent()));
      act(() => result.current.adopt());
      act(() => result.current.clear());
    }).not.toThrow();
    expect(result.current.pending).toBeNull();
  });
});
