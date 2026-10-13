import "@testing-library/jest-dom";
import { act, renderHook } from "@testing-library/react";

let mockProfile: { storeId: string | null; user: { id: string } } | undefined;

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ profile: mockProfile }),
}));

import { purchaseLockOnAddStorageKey, usePurchaseLockOnAdd } from "./usePurchaseLockOnAdd";

const KEY_ANA = purchaseLockOnAddStorageKey({ storeId: "store-1", userId: "ana" });

beforeEach(() => {
  window.localStorage.clear();
  mockProfile = { storeId: "store-1", user: { id: "ana" } };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("usePurchaseLockOnAdd", () => {
  it("está activa por defecto y se recuerda al apagarla", () => {
    const first = renderHook(() => usePurchaseLockOnAdd());

    expect(first.result.current[0]).toBe(true);

    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    expect(window.localStorage.getItem(KEY_ANA)).toBe("0");
    first.unmount();

    // Otra visita a la pantalla: la preferencia sigue apagada.
    expect(renderHook(() => usePurchaseLockOnAdd()).result.current[0]).toBe(false);
  });

  it("es por usuario y tienda: otro usuario u otra tienda conservan la suya", () => {
    const ana = renderHook(() => usePurchaseLockOnAdd());
    act(() => ana.result.current[1](false));

    mockProfile = { storeId: "store-1", user: { id: "luis" } };
    expect(renderHook(() => usePurchaseLockOnAdd()).result.current[0]).toBe(true);

    mockProfile = { storeId: "store-2", user: { id: "ana" } };
    expect(renderHook(() => usePurchaseLockOnAdd()).result.current[0]).toBe(true);
  });

  it("un valor ajeno en el storage se ignora", () => {
    mockProfile = { storeId: "store-1", user: { id: "valor-ajeno" } };
    window.localStorage.setItem(
      purchaseLockOnAddStorageKey({ storeId: "store-1", userId: "valor-ajeno" }),
      "tal vez",
    );

    expect(renderHook(() => usePurchaseLockOnAdd()).result.current[0]).toBe(true);
  });

  it("sin localStorage la preferencia sigue funcionando durante la sesión", () => {
    mockProfile = { storeId: "store-9", user: { id: "sin-storage" } };
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result } = renderHook(() => usePurchaseLockOnAdd());

    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });

  it("sin usuario cargado no falla y arranca activa", () => {
    mockProfile = undefined;

    expect(renderHook(() => usePurchaseLockOnAdd()).result.current[0]).toBe(true);
  });
});
