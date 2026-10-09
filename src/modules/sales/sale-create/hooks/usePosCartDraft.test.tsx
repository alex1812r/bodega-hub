import { act, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "@/shared/components/Toast";

import {
  posCartDraftStorageKey,
  readPosCartTabId,
  serializePosCartDraft,
  type PosCartDraftScope,
  type PosCartRestoration,
} from "../utils/posCartDraft";
import type { PosCartItem } from "./usePosCart";
import {
  POS_CART_DRAFT_SAVE_DELAY_MS,
  usePosCartDraft,
  type UsePosCartDraftOptions,
} from "./usePosCartDraft";

const SCOPE: PosCartDraftScope = {
  cashSessionId: "session-1",
  registerId: "reg-1",
  storeId: "store-1",
  userId: "user-1",
};

const HARINA = { currentStock: 20, id: "prod-harina", name: "Harina PAN", salePriceRef: 1.5 };
const AZUCAR = { currentStock: 10, id: "prod-azucar", name: "Azúcar", salePriceRef: 2 };
const CATALOG = { customers: [{ id: "cont-1" }], products: [HARINA, AZUCAR] };

function item(overrides: Partial<PosCartItem> = {}): PosCartItem {
  return {
    productId: HARINA.id,
    productName: HARINA.name,
    quantity: 1,
    stock: 20,
    unitPriceRef: 1.5,
    ...overrides,
  };
}

function baseOptions(overrides: Partial<UsePosCartDraftOptions> = {}): UsePosCartDraftOptions {
  return {
    ...SCOPE,
    catalog: CATALOG,
    customerId: "cont-1",
    items: [],
    onDiscard: jest.fn(),
    onRestore: jest.fn(),
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function mount(overrides: Partial<UsePosCartDraftOptions> = {}) {
  return renderHook((props: UsePosCartDraftOptions) => usePosCartDraft(props), {
    initialProps: baseOptions(overrides),
    wrapper,
  });
}

function seed(tabId: string, items: PosCartItem[], scope: PosCartDraftScope = SCOPE) {
  const key = posCartDraftStorageKey(scope, tabId);

  window.localStorage.setItem(
    key,
    serializePosCartDraft({ customerId: "cont-1", items }, scope, new Date()),
  );

  return key;
}

function storedLines(key: string) {
  const raw = window.localStorage.getItem(key);

  return raw
    ? (JSON.parse(raw) as { lines: Array<{ productId: string; quantity: number }> }).lines
    : null;
}

function draftKeys() {
  return Object.keys(window.localStorage).filter((key) => key.includes(":pos:carrito:v"));
}

function wait(ms = POS_CART_DRAFT_SAVE_DELAY_MS) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("guardado automático", () => {
  it("no escribe en el cambio: espera 500 ms y una ráfaga escribe una sola vez", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const { rerender } = mount();
    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    setItem.mockClear();
    rerender(baseOptions({ items: [item()] }));
    wait(POS_CART_DRAFT_SAVE_DELAY_MS - 1);
    rerender(baseOptions({ items: [item({ quantity: 2 })] }));
    wait(POS_CART_DRAFT_SAVE_DELAY_MS - 1);
    rerender(baseOptions({ items: [item({ quantity: 3 })] }));

    expect(setItem).not.toHaveBeenCalled();

    wait();

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(storedLines(ownKey)).toEqual([
      { productId: HARINA.id, productName: HARINA.name, quantity: 3, unitPriceRef: 1.5 },
    ]);
  });

  it("al salir de la pantalla dentro de la espera escribe lo pendiente", () => {
    const { rerender, unmount } = mount();
    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    rerender(baseOptions({ items: [item({ quantity: 4 })] }));
    expect(storedLines(ownKey)).toBeNull();

    unmount();

    expect(storedLines(ownKey)?.[0]?.quantity).toBe(4);
  });

  it("saveNow guarda en el acto y cancela el guardado pendiente", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const { rerender, result } = mount();
    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    rerender(baseOptions({ items: [item()] }));
    setItem.mockClear();
    act(() => result.current.saveNow());

    expect(storedLines(ownKey)).toHaveLength(1);

    wait();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("vaciar el carrito (cobro u orden limpiada) borra lo guardado en el acto", () => {
    const { rerender } = mount();
    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    rerender(baseOptions({ items: [item()] }));
    wait();
    expect(storedLines(ownKey)).toHaveLength(1);

    rerender(baseOptions({ items: [] }));

    expect(window.localStorage.getItem(ownKey)).toBeNull();

    // Y un guardado que estuviera pendiente no lo resucita.
    wait();
    expect(draftKeys()).toEqual([]);
  });

  it("guardar no vuelve a pintar la pantalla", () => {
    let renders = 0;
    const { rerender } = renderHook(
      (props: UsePosCartDraftOptions) => {
        renders += 1;
        return usePosCartDraft(props);
      },
      { initialProps: baseOptions(), wrapper },
    );

    rerender(baseOptions({ items: [item()] }));

    const rendersBeforeSave = renders;

    wait();

    expect(draftKeys()).toHaveLength(1);
    expect(renders).toBe(rendersBeforeSave);
  });

  it("sin sesión de caja no lee ni escribe", () => {
    const { rerender, result } = mount({ cashSessionId: null });

    rerender(baseOptions({ cashSessionId: null, items: [item()] }));
    wait();
    act(() => result.current.saveNow());

    expect(draftKeys()).toEqual([]);
  });
});

describe("restauración", () => {
  it("restaura el carrito de la pestaña cuando hay catálogo y avisa con «Vaciar»", () => {
    const ownKey = seed(readPosCartTabId(), [item({ quantity: 2 })]);
    const onRestore = jest.fn<void, [PosCartRestoration]>();
    const onDiscard = jest.fn();
    const { rerender } = mount({ catalog: null, onDiscard, onRestore });

    // Sin catálogo todavía no hay con qué revalidar.
    expect(onRestore).not.toHaveBeenCalled();

    rerender(baseOptions({ onDiscard, onRestore }));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0]?.[0]).toMatchObject({
      customerId: "cont-1",
      items: [{ productId: HARINA.id, quantity: 2, unitPriceRef: 1.5 }],
      removed: [],
      repriced: [],
    });
    expect(screen.getByText("Carrito recuperado")).toBeInTheDocument();
    expect(storedLines(ownKey)).toHaveLength(1);

    act(() => screen.getByRole("button", { name: "Vaciar" }).click());
    expect(onDiscard).toHaveBeenCalledTimes(1);

    // No se restaura dos veces aunque el catálogo se recargue.
    rerender(baseOptions({ catalog: { ...CATALOG }, onDiscard, onRestore }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("hasta restaurar no guarda: el carrito guardado no se pisa", () => {
    const ownKey = seed(readPosCartTabId(), [item({ quantity: 5 })]);
    const { rerender, result, unmount } = mount({ catalog: null });

    rerender(baseOptions({ catalog: null, items: [item({ productId: AZUCAR.id })] }));
    wait();
    act(() => result.current.saveNow());
    unmount();

    expect(storedLines(ownKey)).toEqual([expect.objectContaining({ productId: HARINA.id, quantity: 5 })]);
  });

  it("producto desactivado y precio cambiado: se quita, se toma el precio actual y el aviso no se cierra solo", () => {
    seed(readPosCartTabId(), [
      item({ unitPriceRef: 1 }),
      item({ productId: "prod-baja", productName: "Café descontinuado" }),
    ]);
    const onRestore = jest.fn<void, [PosCartRestoration]>();

    mount({ onRestore });

    const restoration = onRestore.mock.calls[0]?.[0];

    expect(restoration?.items).toEqual([expect.objectContaining({ productId: HARINA.id, unitPriceRef: 1.5 })]);
    expect(screen.getByText(/Café descontinuado/)).toBeInTheDocument();
    expect(screen.getByText(/Precio actualizado: Harina PAN/)).toBeInTheDocument();

    wait(60_000);
    expect(screen.getByText("Carrito recuperado")).toBeInTheDocument();
  });

  it("si ya no queda ningún producto a la venta borra lo guardado y lo dice", () => {
    const ownKey = seed(readPosCartTabId(), [item({ productId: "prod-baja", productName: "Café" })]);
    const onRestore = jest.fn<void, [PosCartRestoration]>();

    mount({ onRestore });

    expect(onRestore.mock.calls[0]?.[0].items).toEqual([]);
    expect(screen.getByText("El carrito guardado ya no se puede recuperar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vaciar" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(ownKey)).toBeNull();
  });

  it("al vaciarse el carrito recuperado se retira el aviso con «Vaciar»", () => {
    seed(readPosCartTabId(), [item({ unitPriceRef: 1 })]);
    const { rerender } = mount();

    rerender(baseOptions({ items: [item()] }));
    expect(screen.getByRole("button", { name: "Vaciar" })).toBeInTheDocument();

    rerender(baseOptions({ items: [] }));
    expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
  });

  it("no restaura el carrito de otra sesión de caja, de otra caja ni de otro usuario, y borra el de la sesión anterior", () => {
    const tabId = readPosCartTabId();
    const oldSession = seed(tabId, [item()], { ...SCOPE, cashSessionId: "session-0" });
    const otherRegister = seed(tabId, [item()], { ...SCOPE, registerId: "reg-2" });
    const otherUser = seed(tabId, [item()], { ...SCOPE, userId: "user-2" });
    const onRestore = jest.fn();

    mount({ onRestore });

    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
    // Misma clave que la sesión actual: es el carrito de un turno ya cerrado.
    expect(window.localStorage.getItem(oldSession)).toBeNull();
    expect(window.localStorage.getItem(otherRegister)).not.toBeNull();
    expect(window.localStorage.getItem(otherUser)).not.toBeNull();
  });
});

describe("dos pestañas", () => {
  it("cada pestaña guarda en su clave: no se pisan ni se mezclan", () => {
    const tabA = mount();
    const keyA = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    // Otra pestaña: su propio sessionStorage, mismo localStorage.
    window.sessionStorage.clear();
    const tabB = mount();
    const keyB = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    expect(keyB).not.toBe(keyA);

    tabA.rerender(baseOptions({ items: [item({ quantity: 7 })] }));
    tabB.rerender(baseOptions({ items: [item({ productId: AZUCAR.id, productName: AZUCAR.name })] }));
    wait();

    expect(storedLines(keyA)).toEqual([expect.objectContaining({ productId: HARINA.id, quantity: 7 })]);
    expect(storedLines(keyB)).toEqual([expect.objectContaining({ productId: AZUCAR.id })]);
    expect(draftKeys()).toHaveLength(2);

    // Cobrar en una no toca el carrito de la otra.
    tabB.rerender(baseOptions({ items: [] }));

    expect(window.localStorage.getItem(keyB)).toBeNull();
    expect(storedLines(keyA)).toHaveLength(1);
  });

  it("una pestaña nueva recoge el carrito huérfano más reciente y lo pasa a su clave", () => {
    const orphanKey = seed("tab-cerrada", [item({ quantity: 3 })]);
    const onRestore = jest.fn<void, [PosCartRestoration]>();

    mount({ onRestore });

    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    expect(onRestore.mock.calls[0]?.[0].items).toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(window.localStorage.getItem(orphanKey)).toBeNull();
    expect(storedLines(ownKey)).toEqual([expect.objectContaining({ quantity: 3 })]);
  });

  it("si otra pestaña se lleva el carrito de esta, lo vuelve a guardar", () => {
    const { rerender } = mount();
    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    rerender(baseOptions({ items: [item({ quantity: 2 })] }));
    wait();

    window.localStorage.removeItem(ownKey);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: ownKey, newValue: null }));
    });

    expect(storedLines(ownKey)).toEqual([expect.objectContaining({ quantity: 2 })]);
  });

  it("una pestaña duplicada (mismo identificador) estrena clave y no pisa la original", () => {
    const { rerender } = mount();
    const sharedKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    rerender(baseOptions({ items: [item({ productId: AZUCAR.id, productName: AZUCAR.name })] }));
    wait();

    // La otra pestaña escribe su carrito en la clave compartida.
    const foreign = serializePosCartDraft({ customerId: "cont-1", items: [item()] }, SCOPE, new Date());
    window.localStorage.setItem(sharedKey, foreign);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: sharedKey, newValue: foreign }));
    });
    wait();

    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());

    expect(ownKey).not.toBe(sharedKey);
    expect(storedLines(sharedKey)).toEqual([expect.objectContaining({ productId: HARINA.id })]);
    expect(storedLines(ownKey)).toEqual([expect.objectContaining({ productId: AZUCAR.id })]);
  });
});

describe("localStorage roto", () => {
  it("lleno o bloqueado al escribir: no lanza y lo informa con saveFailed", () => {
    const { rerender, result } = mount();

    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("lleno", "QuotaExceededError");
    });
    rerender(baseOptions({ items: [item()] }));
    wait();

    expect(result.current.saveFailed).toBe(true);

    jest.restoreAllMocks();
    act(() => result.current.saveNow());

    expect(result.current.saveFailed).toBe(false);
  });

  it("bloqueado del todo: monta, guarda y desmonta sin errores", () => {
    for (const method of ["getItem", "setItem", "removeItem", "key"] as const) {
      jest.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("bloqueado");
      });
    }

    const onRestore = jest.fn();
    const { rerender, result, unmount } = mount({ onRestore });

    rerender(baseOptions({ items: [item()], onRestore }));
    wait();
    act(() => result.current.saveNow());
    rerender(baseOptions({ items: [], onRestore }));
    unmount();

    expect(onRestore).not.toHaveBeenCalled();
  });

  it("contenido corrupto o de una versión vieja: se ignora y se limpia", () => {
    const ownKey = posCartDraftStorageKey(SCOPE, readPosCartTabId());
    const oldVersionKey = ownKey.replace(":v1:", ":v0:");
    const onRestore = jest.fn();

    window.localStorage.setItem(ownKey, "{roto");
    window.localStorage.setItem(oldVersionKey, JSON.stringify({ lines: [] }));

    mount({ onRestore });

    expect(onRestore).not.toHaveBeenCalled();
    expect(draftKeys()).toEqual([]);
  });
});
