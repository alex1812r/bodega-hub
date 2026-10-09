import { formatRefUsd } from "@/shared/utils/currency";

import type { PosCartItem } from "../hooks/usePosCart";
import {
  describePosCartRestoration,
  describeSaleInProgress,
  findPosCartDraft,
  findSettledPosCart,
  parseStoredPosCartDraft,
  POS_CART_DRAFT_VERSION,
  POS_CART_SETTLED_MAX,
  POS_CART_SETTLED_TTL_MS,
  posCartDraftStorageKey,
  posCartRestorationHasChanges,
  posCartSettledStorageKey,
  prunePosCartDrafts,
  purgePosCartDrafts,
  readPosCartTabId,
  restorePosCartDraft,
  rotatePosCartTabId,
  serializePosCartDraft,
  settlePosCart,
  writePosCartDraft,
  type PosCartDraftScope,
} from "./posCartDraft";

const SCOPE: PosCartDraftScope = {
  cashSessionId: "session-1",
  registerId: "reg-1",
  storeId: "store-1",
  userId: "user-1",
};

function item(overrides: Partial<PosCartItem> = {}): PosCartItem {
  return {
    productId: "prod-harina",
    productName: "Harina PAN",
    quantity: 2,
    stock: 20,
    unitPriceRef: 1.5,
    ...overrides,
  };
}

function save(
  tabId: string,
  { items = [item()], savedAt = "2026-10-09T12:00:00.000Z", scope = SCOPE } = {},
) {
  const key = posCartDraftStorageKey(scope, tabId);

  window.localStorage.setItem(
    key,
    serializePosCartDraft({ customerId: "cont-1", items }, scope, new Date(savedAt)),
  );

  return key;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("clave del carrito guardado", () => {
  it("cambia con la tienda, el usuario, la caja y la pestaña", () => {
    const keys = new Set([
      posCartDraftStorageKey(SCOPE, "tab-a"),
      posCartDraftStorageKey({ ...SCOPE, storeId: "store-2" }, "tab-a"),
      posCartDraftStorageKey({ ...SCOPE, userId: "user-2" }, "tab-a"),
      posCartDraftStorageKey({ ...SCOPE, registerId: "reg-2" }, "tab-a"),
      posCartDraftStorageKey(SCOPE, "tab-b"),
    ]);

    expect(keys.size).toBe(5);
  });

  it("el identificador de pestaña sobrevive a recargar y se puede estrenar otro", () => {
    const first = readPosCartTabId();

    expect(readPosCartTabId()).toBe(first);
    expect(rotatePosCartTabId()).not.toBe(first);
    expect(readPosCartTabId()).not.toBe(first);
  });

  it("sin sessionStorage el identificador se mantiene durante la carga de página", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    const first = readPosCartTabId();

    expect(first).toEqual(expect.any(String));
    expect(readPosCartTabId()).toBe(first);
  });
});

describe("lectura del carrito guardado", () => {
  it("guarda líneas, cliente, sesión, versión y fecha; nada del cobro", () => {
    const raw = serializePosCartDraft(
      { customerId: "cont-1", items: [item()] },
      SCOPE,
      new Date("2026-10-09T12:00:00.000Z"),
    );

    expect(JSON.parse(raw)).toEqual({
      cashSessionId: "session-1",
      customerId: "cont-1",
      lines: [{ productId: "prod-harina", productName: "Harina PAN", quantity: 2, unitPriceRef: 1.5 }],
      registerId: "reg-1",
      savedAt: "2026-10-09T12:00:00.000Z",
      storeId: "store-1",
      userId: "user-1",
      version: POS_CART_DRAFT_VERSION,
    });
    expect(parseStoredPosCartDraft(raw, SCOPE)?.lines).toHaveLength(1);
  });

  it.each([
    ["texto corrupto", "{no es json"],
    ["otra forma", JSON.stringify({ lines: "x" })],
    ["sin líneas", JSON.stringify({ ...JSON.parse(serializePosCartDraft({ customerId: "", items: [item()] }, SCOPE, new Date())), lines: [] })],
    ["versión vieja", JSON.stringify({ ...JSON.parse(serializePosCartDraft({ customerId: "", items: [item()] }, SCOPE, new Date())), version: 0 })],
  ])("descarta %s", (_name, raw) => {
    expect(parseStoredPosCartDraft(raw, SCOPE)).toBeNull();
  });

  it.each([
    ["otra tienda", { storeId: "store-2" }],
    ["otro usuario", { userId: "user-2" }],
    ["otra caja", { registerId: "reg-2" }],
    ["otra sesión de caja", { cashSessionId: "session-2" }],
  ])("no devuelve el carrito de %s", (_name, change) => {
    const raw = serializePosCartDraft({ customerId: "", items: [item()] }, SCOPE, new Date());

    expect(parseStoredPosCartDraft(raw, { ...SCOPE, ...change })).toBeNull();
  });
});

describe("carrito que le toca a la pestaña", () => {
  it("prefiere el propio aunque haya otro más reciente", () => {
    const ownKey = save("tab-a", { savedAt: "2026-10-09T10:00:00.000Z" });
    save("tab-b", { savedAt: "2026-10-09T11:00:00.000Z" });

    expect(findPosCartDraft(SCOPE, "tab-a")?.key).toBe(ownKey);
  });

  it("sin carrito propio recoge el huérfano más reciente de la misma caja y sesión", () => {
    save("tab-vieja", { savedAt: "2026-10-09T10:00:00.000Z" });
    const recent = save("tab-reciente", {
      items: [item({ productId: "prod-azucar", productName: "Azúcar" })],
      savedAt: "2026-10-09T11:00:00.000Z",
    });
    save("tab-otro-usuario", {
      savedAt: "2026-10-09T12:00:00.000Z",
      scope: { ...SCOPE, userId: "user-2" },
    });
    save("tab-otra-sesion", {
      savedAt: "2026-10-09T12:00:00.000Z",
      scope: { ...SCOPE, cashSessionId: "session-0" },
    });

    const found = findPosCartDraft(SCOPE, "tab-nueva");

    expect(found?.key).toBe(recent);
    expect(found?.draft.lines[0]?.productId).toBe("prod-azucar");
  });

  it("no encuentra nada si localStorage falla", () => {
    save("tab-a");
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    expect(findPosCartDraft(SCOPE, "tab-a")).toBeNull();
  });

  it("escribir con localStorage lleno devuelve false sin lanzar", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("lleno", "QuotaExceededError");
    });

    expect(writePosCartDraft("clave", "{}")).toBe(false);
  });
});

describe("limpieza", () => {
  it("la poda borra corruptos, otra sesión y versiones viejas de esta caja, y nada más", () => {
    const valid = save("tab-a");
    const otherSession = save("tab-b", { scope: { ...SCOPE, cashSessionId: "session-0" } });
    const corrupt = posCartDraftStorageKey(SCOPE, "tab-c");
    const oldVersion = valid.replace(`:v${POS_CART_DRAFT_VERSION}:`, ":v0:");
    const otherUser = save("tab-a", { scope: { ...SCOPE, userId: "user-2" } });

    window.localStorage.setItem(corrupt, "{roto");
    window.localStorage.setItem(oldVersion, "{}");
    window.localStorage.setItem("pos:sale-attempt:store-1:user-1:reg-1", "[]");

    prunePosCartDrafts(SCOPE);

    expect(window.localStorage.getItem(valid)).not.toBeNull();
    expect(window.localStorage.getItem(otherSession)).toBeNull();
    expect(window.localStorage.getItem(corrupt)).toBeNull();
    expect(window.localStorage.getItem(oldVersion)).toBeNull();
    expect(window.localStorage.getItem(otherUser)).not.toBeNull();
    expect(window.localStorage.getItem("pos:sale-attempt:store-1:user-1:reg-1")).toBe("[]");
  });

  it("cerrar caja borra todos los carritos del usuario en la tienda, no los de otros", () => {
    const own = save("tab-a");
    const ownOtherRegister = save("tab-b", { scope: { ...SCOPE, registerId: "reg-2" } });
    const otherUser = save("tab-a", { scope: { ...SCOPE, userId: "user-2" } });
    const otherStore = save("tab-a", { scope: { ...SCOPE, storeId: "store-2" } });

    purgePosCartDrafts({ storeId: "store-1", userId: "user-1" });

    expect(window.localStorage.getItem(own)).toBeNull();
    expect(window.localStorage.getItem(ownOtherRegister)).toBeNull();
    expect(window.localStorage.getItem(otherUser)).not.toBeNull();
    expect(window.localStorage.getItem(otherStore)).not.toBeNull();
  });
});

describe("revalidación contra el catálogo", () => {
  const draft = parseStoredPosCartDraft(
    serializePosCartDraft(
      {
        customerId: "cont-1",
        items: [
          item(),
          item({ productId: "prod-azucar", productName: "Azúcar", quantity: 3, unitPriceRef: 2 }),
          item({ productId: "prod-baja", productName: "Café descontinuado", quantity: 1 }),
        ],
      },
      SCOPE,
      new Date(),
    ),
    SCOPE,
  );

  if (!draft) {
    throw new Error("montaje: el borrador de prueba no es válido");
  }

  const products = [
    { currentStock: 8, id: "prod-harina", imageUrl: null, name: "Harina PAN 1 kg", salePriceRef: 1.5 },
    { currentStock: 0, id: "prod-azucar", imageUrl: "a.png", name: "Azúcar", salePriceRef: 2.5 },
  ];

  it("quita lo que ya no se vende, toma precio y nombre del catálogo y conserva la cantidad", () => {
    const restoration = restorePosCartDraft(draft, {
      customerIds: new Set(["cont-1"]),
      products,
    });

    expect(restoration.items).toEqual([
      {
        imageUrl: undefined,
        productId: "prod-harina",
        productName: "Harina PAN 1 kg",
        quantity: 2,
        stock: 8,
        unitPriceRef: 1.5,
      },
      {
        imageUrl: "a.png",
        productId: "prod-azucar",
        productName: "Azúcar",
        quantity: 3,
        stock: 0,
        unitPriceRef: 2.5,
      },
    ]);
    expect(restoration.removed).toEqual(["Café descontinuado"]);
    expect(restoration.repriced).toEqual([{ fromRef: 2, name: "Azúcar", toRef: 2.5 }]);
    expect(restoration.customerId).toBe("cont-1");
    expect(posCartRestorationHasChanges(restoration)).toBe(true);

    const text = describePosCartRestoration(restoration);

    expect(text).toContain("Volvieron 2 productos");
    expect(text).toContain("Café descontinuado");
    expect(text).toContain(`Azúcar ${formatRefUsd(2)} → ${formatRefUsd(2.5)}`);
  });

  it("un cliente que ya no existe no se restaura y se avisa", () => {
    const restoration = restorePosCartDraft(draft, { customerIds: new Set(), products });

    expect(restoration.customerId).toBeNull();
    expect(restoration.customerMissing).toBe(true);
    expect(describePosCartRestoration(restoration)).toContain("cliente guardado ya no está");
  });

  it("sin cambios el aviso solo cuenta lo recuperado", () => {
    const restoration = restorePosCartDraft(
      { ...draft, lines: draft.lines.slice(0, 1) },
      { customerIds: new Set(["cont-1"]), products },
    );

    expect(posCartRestorationHasChanges(restoration)).toBe(false);
    expect(describePosCartRestoration(restoration)).toBe(
      "Volvió 1 producto de la venta que quedó a medias.",
    );
  });
});

describe("nombre de la venta en curso", () => {
  it("nombra productos, total y cliente", () => {
    expect(
      describeSaleInProgress({ customerName: "Cliente mostrador", lineCount: 3, totalRef: 12.5 }),
    ).toBe(`Venta en curso · 3 productos · ${formatRefUsd(12.5)} · Cliente mostrador`);
  });

  it("singular y sin cliente", () => {
    expect(describeSaleInProgress({ customerName: " ", lineCount: 1, totalRef: 2 })).toBe(
      `Venta en curso · 1 producto · ${formatRefUsd(2)}`,
    );
  });
});

describe("carrito cobrado o vaciado: identidad y marca (CNF-F5 · B3)", () => {
  const NOW = Date.parse("2026-10-09T12:00:00.000Z");

  function saveCart(tabId: string, cartId: string | undefined, scope = SCOPE) {
    const key = posCartDraftStorageKey(scope, tabId);

    window.localStorage.setItem(
      key,
      serializePosCartDraft({ cartId, customerId: "cont-1", items: [item()] }, scope, new Date(NOW)),
    );

    return key;
  }

  it("el carrito guardado lleva su identidad, y uno guardado antes (sin ella) se sigue leyendo", () => {
    const withId = saveCart("tab-a", "cart-1");
    const legacy = saveCart("tab-b", undefined);

    expect(parseStoredPosCartDraft(window.localStorage.getItem(withId), SCOPE)?.cartId).toBe("cart-1");
    expect(parseStoredPosCartDraft(window.localStorage.getItem(legacy), SCOPE)).toMatchObject({
      customerId: "cont-1",
    });
    expect(window.localStorage.getItem(legacy)).not.toContain("cartId");
  });

  it("cerrar un carrito borra TODAS sus copias de la caja y deja intactos los demás carritos", () => {
    const copyA = saveCart("tab-a", "cart-1");
    const copyB = saveCart("tab-b", "cart-1");
    const other = saveCart("tab-c", "cart-2");
    const legacy = saveCart("tab-d", undefined);
    const otherRegister = saveCart("tab-a", "cart-1", { ...SCOPE, registerId: "reg-2" });

    settlePosCart(SCOPE, "cart-1", "cobrado", NOW);

    expect(window.localStorage.getItem(copyA)).toBeNull();
    expect(window.localStorage.getItem(copyB)).toBeNull();
    expect(window.localStorage.getItem(other)).not.toBeNull();
    expect(window.localStorage.getItem(legacy)).not.toBeNull();
    expect(window.localStorage.getItem(otherRegister)).not.toBeNull();
    expect(findSettledPosCart(SCOPE, "cart-1", NOW)).toBe("cobrado");
    expect(findSettledPosCart(SCOPE, "cart-2", NOW)).toBeNull();
    expect(findSettledPosCart({ ...SCOPE, registerId: "reg-2" }, "cart-1", NOW)).toBeNull();
  });

  it("una copia reescrita después del cierre ni se encuentra ni sobrevive a la poda", () => {
    settlePosCart(SCOPE, "cart-1", "cobrado");

    const own = saveCart("tab-a", "cart-1");
    const orphan = saveCart("tab-b", "cart-1");

    expect(findPosCartDraft(SCOPE, "tab-a")).toBeNull();
    expect(findPosCartDraft(SCOPE, "tab-nueva")).toBeNull();

    prunePosCartDrafts(SCOPE);

    expect(window.localStorage.getItem(own)).toBeNull();
    expect(window.localStorage.getItem(orphan)).toBeNull();
  });

  it("la marca caduca: vigente hasta el último milisegundo y fuera después, y al escribir se van las vencidas", () => {
    settlePosCart(SCOPE, "cart-1", "cobrado", NOW);

    expect(findSettledPosCart(SCOPE, "cart-1", NOW + POS_CART_SETTLED_TTL_MS - 1)).toBe("cobrado");
    expect(findSettledPosCart(SCOPE, "cart-1", NOW + POS_CART_SETTLED_TTL_MS)).toBeNull();

    settlePosCart(SCOPE, "cart-2", "vaciado", NOW + POS_CART_SETTLED_TTL_MS);

    const stored = JSON.parse(
      window.localStorage.getItem(posCartSettledStorageKey(SCOPE)) ?? "[]",
    ) as Array<{ cartId: string }>;

    expect(stored.map((entry) => entry.cartId)).toEqual(["cart-2"]);
  });

  it("solo se conservan las marcas más recientes, y «cobrado» no pasa a «vaciado»", () => {
    for (let index = 0; index <= POS_CART_SETTLED_MAX; index += 1) {
      settlePosCart(SCOPE, `cart-${index}`, "cobrado", NOW + index);
    }

    expect(findSettledPosCart(SCOPE, "cart-0", NOW + POS_CART_SETTLED_MAX)).toBeNull();
    expect(findSettledPosCart(SCOPE, "cart-1", NOW + POS_CART_SETTLED_MAX)).toBe("cobrado");

    settlePosCart(SCOPE, "cart-1", "vaciado", NOW + POS_CART_SETTLED_MAX);

    expect(findSettledPosCart(SCOPE, "cart-1", NOW + POS_CART_SETTLED_MAX)).toBe("cobrado");
  });

  it("la marca no es un carrito (la poda no la toca) y cerrar caja la borra", () => {
    settlePosCart(SCOPE, "cart-1", "cobrado");
    settlePosCart({ ...SCOPE, userId: "user-2" }, "cart-9", "cobrado");

    prunePosCartDrafts(SCOPE);
    expect(findSettledPosCart(SCOPE, "cart-1")).toBe("cobrado");

    purgePosCartDrafts(SCOPE);

    expect(window.localStorage.getItem(posCartSettledStorageKey(SCOPE))).toBeNull();
    expect(findSettledPosCart({ ...SCOPE, userId: "user-2" }, "cart-9")).toBe("cobrado");
  });

  it("con localStorage roto o una marca ilegible no lanza y no hay nada cerrado", () => {
    window.localStorage.setItem(posCartSettledStorageKey(SCOPE), "{roto");
    expect(findSettledPosCart(SCOPE, "cart-1")).toBeNull();

    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    expect(() => settlePosCart(SCOPE, "cart-1", "cobrado")).not.toThrow();
    expect(findSettledPosCart(SCOPE, "cart-1")).toBeNull();
  });
});
