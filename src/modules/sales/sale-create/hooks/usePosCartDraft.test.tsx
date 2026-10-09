import { act, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "@/shared/components/Toast";

import {
  posCartDraftStorageKey,
  posCartSettledStorageKey,
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

function storedCartId(key: string) {
  return (JSON.parse(window.localStorage.getItem(key) ?? "{}") as { cartId?: string }).cartId;
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

describe("carrito cobrado o vaciado con copias en otras pestañas (CNF-F5 · B3)", () => {
  /** Lo que el navegador avisa a las DEMÁS pestañas cuando una escribe o borra `key`. */
  function announce(key: string) {
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: window.localStorage.getItem(key) }),
      );
    });
  }

  /** Abre el POS en otra pestaña: su propio `sessionStorage`, el mismo `localStorage`. */
  function openTab(overrides: Partial<UsePosCartDraftOptions> = {}) {
    window.sessionStorage.clear();

    const onRestore = jest.fn<void, [PosCartRestoration]>();
    const tab = mount({ onRestore, ...overrides });

    return { ...tab, key: posCartDraftStorageKey(SCOPE, readPosCartTabId()), onRestore };
  }

  it("secuencia de QA: la pestaña 2 copia el carrito y se cierra, la 1 cobra, y una pestaña nueva no recupera lo vendido", () => {
    const tab1 = openTab();

    tab1.rerender(baseOptions({ items: [item()] }));
    wait();

    // Pestaña 2: recoge el carrito de la 1 («Carrito recuperado») y la 1 reescribe el suyo.
    const tab2 = openTab();

    expect(tab2.onRestore).toHaveBeenCalledTimes(1);
    tab2.rerender(baseOptions({ items: [item()], onRestore: tab2.onRestore }));
    announce(tab1.key);
    expect(draftKeys()).toHaveLength(2);
    tab2.unmount();

    // Pestaña 1: cobra (el carrito queda vacío).
    tab1.rerender(baseOptions({ items: [] }));

    expect(draftKeys()).toEqual([]);

    const tab3 = openTab();

    expect(tab3.onRestore).not.toHaveBeenCalled();
    expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
  });

  const SETTLED_KEY = posCartSettledStorageKey(SCOPE);
  const CHARGED_ELSEWHERE = "Este carrito ya se cobró en otra pestaña";
  const EMPTIED_ELSEWHERE = "Este carrito se vació en otra pestaña";
  const AZUCAR_ITEM = item({ productId: AZUCAR.id, productName: AZUCAR.name, unitPriceRef: 2 });

  /** Pestaña 1 con un carrito guardado y pestaña 2, VIVA, con una copia en pantalla. */
  function openOriginalAndLiveCopy() {
    const tab1 = openTab();

    tab1.rerender(baseOptions({ items: [item()] }));
    wait();

    const onDiscard = jest.fn();
    const tab2 = openTab({ onDiscard });
    const copy = (items: PosCartItem[]) =>
      tab2.rerender(baseOptions({ items, onDiscard, onRestore: tab2.onRestore }));

    copy([item()]);
    announce(tab1.key);
    expect(draftKeys()).toHaveLength(2);

    return { copy, onDiscard, tab1, tab2 };
  }

  it("copia viva: al cobrarse en la otra pestaña avisa con «Vaciar», no borra la pantalla y no vuelve a guardarse", () => {
    const { copy, onDiscard, tab1, tab2 } = openOriginalAndLiveCopy();

    act(() => tab1.result.current.markCharged());
    tab1.rerender(baseOptions({ items: [] }));
    expect(draftKeys()).toEqual([]);

    // Lo que el navegador le avisa a la pestaña 2: la marca y el borrado de su copia.
    announce(SETTLED_KEY);
    announce(tab2.key);

    expect(screen.getByText(CHARGED_ELSEWHERE)).toBeInTheDocument();
    expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
    expect(tab2.result.current.settledElsewhere).toBe(true);
    expect(tab1.result.current.settledElsewhere).toBe(false);
    // No se vacía sola: lo decide el cajero.
    expect(onDiscard).not.toHaveBeenCalled();
    expect(draftKeys()).toEqual([]);

    // El cajero sigue tocando la copia: ni el guardado automático, ni «salir», ni desmontar la resucitan.
    copy([item({ quantity: 2 }), AZUCAR_ITEM]);
    wait();
    act(() => tab2.result.current.saveNow());
    expect(draftKeys()).toEqual([]);

    // El aviso no se cierra solo.
    wait(60_000);
    act(() => screen.getByRole("button", { name: "Vaciar" }).click());
    expect(onDiscard).toHaveBeenCalledTimes(1);

    copy([]);
    expect(screen.queryByText(CHARGED_ELSEWHERE)).not.toBeInTheDocument();
    expect(tab2.result.current.settledElsewhere).toBe(false);

    // Lo siguiente que se escanee es un carrito nuevo y se guarda con normalidad.
    copy([AZUCAR_ITEM]);
    wait();
    expect(storedLines(tab2.key)).toEqual([expect.objectContaining({ productId: AZUCAR.id })]);
    expect(screen.queryByText(CHARGED_ELSEWHERE)).not.toBeInTheDocument();

    // Y una pestaña nueva recupera ESE carrito, no el vendido.
    tab2.unmount();

    const tab3 = openTab();

    expect(tab3.onRestore.mock.calls[0]?.[0].items).toEqual([
      expect.objectContaining({ productId: AZUCAR.id }),
    ]);
  });

  it("copia viva que no recibe el aviso: al ir a guardar no reescribe y avisa; pasada la caducidad sigue sin guardarse", () => {
    const { copy, tab1, tab2 } = openOriginalAndLiveCopy();

    act(() => tab1.result.current.markCharged());
    tab1.rerender(baseOptions({ items: [] }));

    // Sin evento `storage`: la pestaña 2 cambia su copia y el guardado automático se dispara.
    copy([item({ quantity: 3 })]);
    wait();

    expect(draftKeys()).toEqual([]);
    expect(screen.getByText(CHARGED_ELSEWHERE)).toBeInTheDocument();

    jest.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
    copy([item({ quantity: 4 })]);
    wait();
    act(() => tab2.result.current.saveNow());

    expect(draftKeys()).toEqual([]);
  });

  it("copia viva en segundo plano: se entera al volver a verse", () => {
    const { tab1 } = openOriginalAndLiveCopy();

    act(() => tab1.result.current.markCharged());
    tab1.rerender(baseOptions({ items: [] }));
    expect(screen.queryByText(CHARGED_ELSEWHERE)).not.toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByText(CHARGED_ELSEWHERE)).toBeInTheDocument();
  });

  it("si la otra pestaña lo vació sin cobrarlo, el aviso no dice que se cobró", () => {
    const { tab1, tab2 } = openOriginalAndLiveCopy();

    tab1.rerender(baseOptions({ items: [] }));
    announce(SETTLED_KEY);
    announce(tab2.key);

    expect(screen.getByText(EMPTIED_ELSEWHERE)).toBeInTheDocument();
    expect(screen.queryByText(CHARGED_ELSEWHERE)).not.toBeInTheDocument();
    expect(draftKeys()).toEqual([]);
  });

  // CNF-F8 · CAOS-06: antes, vaciar la copia cerraba el carrito para la pestaña que lo creó.
  it("vaciar la COPIA solo afecta a su pestaña: el original sigue guardado, sin marca ni aviso", () => {
    const { copy, tab1, tab2 } = openOriginalAndLiveCopy();

    copy([]);
    announce(SETTLED_KEY);
    announce(tab2.key);

    expect(draftKeys()).toEqual([tab1.key]);
    expect(storedLines(tab1.key)).toEqual([expect.objectContaining({ productId: HARINA.id })]);
    expect(window.localStorage.getItem(SETTLED_KEY)).toBeNull();
    expect(screen.queryByText(EMPTIED_ELSEWHERE)).not.toBeInTheDocument();
    expect(tab1.result.current.settledElsewhere).toBe(false);

    // La pestaña 1 sigue guardando su venta, y lo siguiente de la 2 es un carrito aparte.
    tab1.rerender(baseOptions({ items: [item({ quantity: 4 })] }));
    copy([AZUCAR_ITEM]);
    wait();

    expect(storedLines(tab1.key)).toEqual([expect.objectContaining({ quantity: 4 })]);
    expect(storedLines(tab2.key)).toEqual([expect.objectContaining({ productId: AZUCAR.id })]);
    expect(storedCartId(tab2.key)).not.toBe(storedCartId(tab1.key));
  });

  it("cobrar la copia sí cierra el carrito para todas las pestañas", () => {
    const { copy, tab1, tab2 } = openOriginalAndLiveCopy();

    act(() => tab2.result.current.markCharged());
    copy([]);
    announce(SETTLED_KEY);
    announce(tab1.key);

    expect(draftKeys()).toEqual([]);
    expect(screen.getByText(CHARGED_ELSEWHERE)).toBeInTheDocument();
    expect(tab1.result.current.chargedElsewhere).toBe(true);
  });

  // CNF-F8 · CAOS-02.
  it("dos pestañas con el mismo carrito: solo una pasa a cobrar; si su cobro falla, la otra queda libre", () => {
    const { tab1, tab2 } = openOriginalAndLiveCopy();

    expect(tab1.result.current.beginCharge()).toBe("libre");
    expect(tab2.result.current.beginCharge()).toBe("cobrando");
    // La que ya está cobrando puede reintentar.
    expect(tab1.result.current.beginCharge()).toBe("libre");

    tab1.result.current.endCharge();

    expect(tab2.result.current.beginCharge()).toBe("libre");
    expect(tab1.result.current.beginCharge()).toBe("cobrando");
  });

  it("la copia de un carrito ya cobrado no pasa a cobrar hasta «Es una venta nueva», que le da otra identidad y la guarda", () => {
    const { tab1, tab2 } = openOriginalAndLiveCopy();
    const soldCartId = storedCartId(tab1.key);

    act(() => tab1.result.current.markCharged());
    tab1.rerender(baseOptions({ items: [] }));

    // A la pestaña 2 no le llegó ningún evento: lo ve al ir a cobrar.
    let gate = "";

    act(() => {
      gate = tab2.result.current.beginCharge();
    });

    expect(gate).toBe("cobrado");
    expect(tab2.result.current.chargedElsewhere).toBe(true);
    expect(screen.getByText(CHARGED_ELSEWHERE)).toBeInTheDocument();
    expect(tab2.result.current.beginCharge()).toBe("cobrado");

    act(() => tab2.result.current.startNewSale());

    expect(tab2.result.current.chargedElsewhere).toBe(false);
    expect(tab2.result.current.settledElsewhere).toBe(false);
    expect(screen.queryByText(CHARGED_ELSEWHERE)).not.toBeInTheDocument();
    expect(storedLines(tab2.key)).toEqual([expect.objectContaining({ productId: HARINA.id })]);
    expect(storedCartId(tab2.key)).not.toBe(soldCartId);
    expect(tab2.result.current.beginCharge()).toBe("libre");
  });

  it("un carrito vaciado en la pestaña original se puede cobrar en la copia, y eso lo cierra como cobrado", () => {
    const { copy, tab1, tab2 } = openOriginalAndLiveCopy();
    const cartId = storedCartId(tab1.key);

    tab1.rerender(baseOptions({ items: [] }));
    announce(SETTLED_KEY);
    expect(screen.getByText(EMPTIED_ELSEWHERE)).toBeInTheDocument();
    expect(tab2.result.current.chargedElsewhere).toBe(false);
    expect(tab2.result.current.beginCharge()).toBe("libre");

    act(() => tab2.result.current.markCharged());
    copy([]);

    expect(JSON.parse(window.localStorage.getItem(SETTLED_KEY) ?? "[]")).toEqual([
      { at: expect.any(Number), cartId, reason: "cobrado" },
    ]);
  });

  it("un carrito que nunca se guardó (venta rápida) pasa a cobrar sin leer ni escribir", () => {
    const tab = openTab();

    tab.rerender(baseOptions({ items: [item()] }));

    const getItem = jest.spyOn(Storage.prototype, "getItem");
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    expect(tab.result.current.beginCharge()).toBe("libre");
    tab.result.current.endCharge();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("un carrito guardado pasa a cobrar con una lectura y una escritura, y sin volver a pintar", () => {
    let renders = 0;

    window.sessionStorage.clear();

    const { rerender, result } = renderHook(
      (props: UsePosCartDraftOptions) => {
        renders += 1;
        return usePosCartDraft(props);
      },
      { initialProps: baseOptions(), wrapper },
    );

    rerender(baseOptions({ items: [item()] }));
    wait();

    const getItem = jest.spyOn(Storage.prototype, "getItem");
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const rendersBefore = renders;

    expect(result.current.beginCharge()).toBe("libre");
    expect(getItem.mock.calls).toEqual([[SETTLED_KEY]]);
    expect(setItem.mock.calls).toEqual([[SETTLED_KEY, expect.any(String)]]);
    expect(renders).toBe(rendersBefore);
  });

  it("dos carritos distintos en dos pestañas: cobrar uno no invalida ni avisa al otro", () => {
    const tab1 = openTab();
    const tab2 = openTab();

    tab1.rerender(baseOptions({ items: [item()] }));
    tab2.rerender(baseOptions({ items: [AZUCAR_ITEM], onRestore: tab2.onRestore }));
    wait();
    expect(tab2.onRestore).not.toHaveBeenCalled();
    expect(draftKeys()).toHaveLength(2);

    act(() => tab1.result.current.markCharged());
    tab1.rerender(baseOptions({ items: [] }));
    announce(SETTLED_KEY);
    announce(tab1.key);

    expect(storedLines(tab2.key)).toEqual([expect.objectContaining({ productId: AZUCAR.id })]);
    expect(screen.queryByText(CHARGED_ELSEWHERE)).not.toBeInTheDocument();
    expect(tab2.result.current.settledElsewhere).toBe(false);

    // La pestaña 2 sigue guardando su carrito.
    tab2.rerender(baseOptions({ items: [{ ...AZUCAR_ITEM, quantity: 5 }], onRestore: tab2.onRestore }));
    wait();
    expect(storedLines(tab2.key)).toEqual([expect.objectContaining({ quantity: 5 })]);
  });

  it("carrito leído al entrar y cobrado en otra pestaña antes de cargar el catálogo: no se restaura", () => {
    const tab1 = openTab();

    tab1.rerender(baseOptions({ items: [item()] }));
    wait();

    const tab2 = openTab({ catalog: null });

    act(() => tab1.result.current.markCharged());
    tab1.rerender(baseOptions({ items: [] }));
    tab2.rerender(baseOptions({ onRestore: tab2.onRestore }));

    expect(tab2.onRestore).not.toHaveBeenCalled();
    expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
    expect(draftKeys()).toEqual([]);
  });

  it("un carrito cobrado sin copias no deja nada recuperable ni avisa a nadie", () => {
    const tab1 = openTab();

    tab1.rerender(baseOptions({ items: [item()] }));
    wait();
    act(() => tab1.result.current.markCharged());
    tab1.rerender(baseOptions({ items: [] }));
    announce(SETTLED_KEY);

    // La misma pestaña arma la venta siguiente: se guarda y no se la confunde con la anterior.
    tab1.rerender(baseOptions({ items: [AZUCAR_ITEM] }));
    wait();

    expect(storedLines(tab1.key)).toEqual([expect.objectContaining({ productId: AZUCAR.id })]);
    expect(screen.queryByText(CHARGED_ELSEWHERE)).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTIED_ELSEWHERE)).not.toBeInTheDocument();
  });
});
