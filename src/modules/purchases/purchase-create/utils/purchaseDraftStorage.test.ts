import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import type { PurchaseProductResolutions } from "../services/resolvePurchaseProducts";
import { createPackDraftItem, createUnitDraftItem } from "../types";
import {
  describeDraftSupplierUnavailable,
  describeStoredPurchaseDraft,
  describeStoredPurchaseDraftContent,
  formatPurchaseDraftAge,
  isPurchaseDraftWorthSaving,
  parseStoredPurchaseDraft,
  PURCHASE_DRAFT_VERSION,
  purchaseDraftStorageKey,
  restorePurchaseDraft,
  serializePurchaseDraft,
  storedDraftSourceItems,
  type PurchaseDraftContent,
} from "./purchaseDraftStorage";
import { describePurchaseInProgress } from "./purchaseProcessLabel";

const session = { storeId: "store-1", userId: "user-1" };
const savedAt = new Date("2026-10-08T14:00:00.000Z");

const cable = createUnitDraftItem({
  costCurrency: "ves",
  id: "line-cable",
  productId: "prod-cable",
  quantity: 3,
  rateVes: 510,
  taxRate: 16,
  unitCostRef: 2,
});
const refresco = createPackDraftItem({
  costCurrency: "ves",
  id: "line-refresco",
  packCostRef: 12,
  packCount: 2,
  packLabel: "Caja",
  productId: "prod-refresco",
  rateVes: 510,
  taxRate: 16,
  unitsPerPack: 12,
});

function buildContent(overrides: Partial<PurchaseDraftContent> = {}): PurchaseDraftContent {
  return {
    costCurrency: "ves",
    discountRef: 1.5,
    lineMeta: {
      "prod-cable": { name: "Cable HDMI", packUnits: [], sku: "ELE-CAB-001", taxRate: 16 },
      "prod-refresco": { name: "Refresco Cola", sku: "BEB-REF-001", taxRate: 16 },
    },
    lines: {
      items: [refresco, cable],
      locks: { locked: { "line-cable": true } },
      review: {
        baselines: { "line-cable": { item: cable, taxChoice: null } },
        reviewed: { "line-cable": { item: cable, taxChoice: null } },
      },
      taxState: { choices: { "line-refresco": "reducida" }, exempt: true },
    },
    notes: "Factura 123",
    rateVes: 510,
    status: "pedido",
    supplierId: "cont-supplier",
    supplierName: "Proveedor Demo",
    ...overrides,
  };
}

function catalogProduct(productId: string, name: string): PurchaseCatalogProduct {
  return {
    costWithTaxRef: 0,
    currentStock: 0,
    link: "none",
    name,
    packUnits: [],
    productId,
    sku: `SKU-${productId}`,
    taxRate: 8,
    unitCostRef: 0,
  };
}

function allActive(): PurchaseProductResolutions {
  return new Map([
    ["prod-cable", { product: catalogProduct("prod-cable", "Cable HDMI 2 m"), status: "active" }],
    ["prod-refresco", { product: catalogProduct("prod-refresco", "Refresco"), status: "active" }],
  ]);
}

describe("clave del borrador de compra", () => {
  it("lleva versión, tienda y usuario", () => {
    expect(purchaseDraftStorageKey(session)).toBe("bodegahub:compras:borrador:v1:store-1:user-1");
    expect(purchaseDraftStorageKey({ storeId: null, userId: "a:b" })).toBe(
      "bodegahub:compras:borrador:v1::a%3Ab",
    );
  });
});

describe("serializar y leer el borrador de compra", () => {
  it("lo que se guarda se lee igual, con versión, sesión y fecha", () => {
    const content = buildContent();
    const draft = parseStoredPurchaseDraft(
      serializePurchaseDraft(content, session, savedAt),
      session,
    );

    expect(draft).toEqual({
      ...content,
      savedAt: "2026-10-08T14:00:00.000Z",
      storeId: "store-1",
      userId: "user-1",
      version: PURCHASE_DRAFT_VERSION,
    });
  });

  it("ignora campos que no conoce: el esquema se puede ampliar", () => {
    const raw = JSON.stringify({
      ...JSON.parse(serializePurchaseDraft(buildContent(), session, savedAt)),
      clientRequestId: "clave-futura",
    });

    expect(parseStoredPurchaseDraft(raw, session)).not.toBeNull();
  });

  it.each([
    ["nada guardado", null],
    ["texto que no es JSON", "{no es json"],
    ["JSON que no es un borrador", JSON.stringify({ version: 1, lines: "rotas" })],
    ["JSON nulo", "null"],
  ])("descarta %s", (_label, raw) => {
    expect(parseStoredPurchaseDraft(raw, session)).toBeNull();
  });

  it("descarta un borrador de otra versión", () => {
    const raw = JSON.stringify({
      ...JSON.parse(serializePurchaseDraft(buildContent(), session, savedAt)),
      version: PURCHASE_DRAFT_VERSION + 1,
    });

    expect(parseStoredPurchaseDraft(raw, session)).toBeNull();
  });

  it("descarta un borrador de otro usuario o de otra tienda", () => {
    const raw = serializePurchaseDraft(buildContent(), session, savedAt);

    expect(parseStoredPurchaseDraft(raw, { storeId: "store-1", userId: "user-2" })).toBeNull();
    expect(parseStoredPurchaseDraft(raw, { storeId: "store-2", userId: "user-1" })).toBeNull();
    expect(parseStoredPurchaseDraft(raw, { storeId: null, userId: "user-1" })).toBeNull();
  });

  it("descarta un borrador con una línea corrupta o en otra moneda que la compra", () => {
    const raw = serializePurchaseDraft(buildContent(), session, savedAt);
    const negative = JSON.parse(raw);
    negative.lines.items[0].quantity = -1;
    const mixed = JSON.parse(raw);
    mixed.lines.items[0].costCurrency = "ref";

    expect(parseStoredPurchaseDraft(JSON.stringify(negative), session)).toBeNull();
    expect(parseStoredPurchaseDraft(JSON.stringify(mixed), session)).toBeNull();
  });
});

describe("isPurchaseDraftWorthSaving", () => {
  const empty = buildContent({
    lines: {
      items: [],
      locks: { locked: {} },
      review: { baselines: {}, reviewed: {} },
      taxState: { choices: {}, exempt: false },
    },
    notes: "",
  });

  it("con una línea hay algo que perder", () => {
    expect(isPurchaseDraftWorthSaving(buildContent({ notes: "" }))).toBe(true);
  });

  it("sin líneas vale con proveedor elegido (CNF-15: lo mismo que activa el guardia)", () => {
    expect(isPurchaseDraftWorthSaving(empty)).toBe(true);
    expect(isPurchaseDraftWorthSaving({ ...empty, notes: "Factura 9" })).toBe(true);
  });

  it("sin líneas ni proveedor no hay nada que perder, aunque haya notas, descuento o estado", () => {
    expect(isPurchaseDraftWorthSaving({ ...empty, supplierId: "" })).toBe(false);
    expect(
      isPurchaseDraftWorthSaving({
        ...empty,
        discountRef: 3,
        notes: "Factura 9",
        status: "pedido",
        supplierId: "",
      }),
    ).toBe(false);
  });
});

describe("restorePurchaseDraft", () => {
  function storedDraft(overrides: Partial<PurchaseDraftContent> = {}) {
    const draft = parseStoredPurchaseDraft(
      serializePurchaseDraft(buildContent(overrides), session, savedAt),
      session,
    );

    if (!draft) {
      throw new Error("El borrador de prueba no es válido.");
    }

    return draft;
  }

  it("con la misma tasa repone líneas, bloqueos, alícuotas, exenta y moneda sin avisos", () => {
    const restored = restorePurchaseDraft(storedDraft(), { products: allActive(), rateVes: 510 });

    expect(restored.notices).toEqual([]);
    expect(restored.costCurrency).toBe("ves");
    expect(restored.lines.items).toEqual([refresco, cable]);
    expect(restored.lines.locks).toEqual({ locked: { "line-cable": true } });
    expect(restored.lines.taxState).toEqual({
      choices: { "line-refresco": "reducida" },
      exempt: true,
    });
    expect(Object.keys(restored.lines.review.baselines)).toEqual(["line-cable"]);
  });

  it("toma nombre, SKU y % de categoría del catálogo actual", () => {
    const restored = restorePurchaseDraft(storedDraft(), { products: allActive(), rateVes: 510 });

    expect(restored.lineMeta.get("prod-cable")).toEqual({
      name: "Cable HDMI 2 m",
      packUnits: [],
      sku: "SKU-prod-cable",
      taxRate: 8,
    });
  });

  it("con otra tasa deja fijo el monto en la moneda de captura, recalcula el espejo y avisa", () => {
    const restored = restorePurchaseDraft(storedDraft(), { products: allActive(), rateVes: 600 });
    const [restoredRefresco, restoredCable] = restored.lines.items;

    // Capturadas en Bs: Bs. 1.020,00 y Bs. 6.120,00 no se mueven; el REF sale de la tasa nueva.
    expect(restoredCable).toMatchObject({ unitCostRef: 1.7, unitCostVes: 1020 });
    expect(restoredRefresco).toMatchObject({ packCostRef: 10.2, packCostVes: 6120 });
    // La foto de revisión cambia igual: el cambio de tasa no cuenta como edición.
    expect(restored.lines.review.baselines["line-cable"].item).toEqual(restoredCable);
    expect(restored.notices).toEqual([
      "La tasa cambió desde que guardaste la compra (de Bs. 510,00 a Bs. 600,00): los costos se recalcularon con la tasa actual.",
    ]);
  });

  it("capturada en REF, otra tasa deja fijo el REF y recalcula los bolívares", () => {
    const cableRef = { ...cable, costCurrency: "ref" as const };
    const restored = restorePurchaseDraft(
      storedDraft({
        costCurrency: "ref",
        lines: {
          items: [cableRef],
          locks: { locked: {} },
          review: { baselines: {}, reviewed: {} },
          taxState: { choices: {}, exempt: false },
        },
      }),
      { products: allActive(), rateVes: 600 },
    );

    expect(restored.costCurrency).toBe("ref");
    expect(restored.lines.items[0]).toMatchObject({ unitCostRef: 2, unitCostVes: 1200 });
  });

  it("quita las líneas de productos inactivos o inexistentes, con su rastro, y avisa cuáles", () => {
    const products: PurchaseProductResolutions = new Map([
      ["prod-cable", { name: "Cable HDMI (descontinuado)", status: "unavailable" }],
      ["prod-refresco", { product: catalogProduct("prod-refresco", "Refresco"), status: "active" }],
    ]);
    const restored = restorePurchaseDraft(storedDraft(), { products, rateVes: 510 });

    expect(restored.lines.items.map((item) => item.id)).toEqual(["line-refresco"]);
    expect(restored.lines.locks).toEqual({ locked: {} });
    expect(restored.lines.review).toEqual({ baselines: {}, reviewed: {} });
    expect(restored.lineMeta.has("prod-cable")).toBe(false);
    expect(restored.notices).toEqual([
      "Se quitó 1 producto que ya no existe o está inactivo: Cable HDMI (descontinuado).",
    ]);
  });

  it("de un producto que el servidor ya no conoce usa el nombre guardado en el borrador", () => {
    const products: PurchaseProductResolutions = new Map([
      ["prod-cable", { name: null, status: "unavailable" }],
    ]);
    const restored = restorePurchaseDraft(storedDraft(), { products, rateVes: 510 });

    expect(restored.lines.items).toEqual([]);
    expect(restored.notices).toEqual([
      "Se quitaron 2 productos que ya no existen o están inactivos: Refresco Cola, Cable HDMI.",
    ]);
  });
});

describe("antigüedad del borrador", () => {
  const saved = "2026-10-08T14:00:00.000Z";
  const at = (minutes: number) => Date.parse(saved) + minutes * 60_000;

  it.each([
    [0, "hace un momento"],
    [20, "hace 20 min"],
    [185, "hace 3 h"],
    [24 * 60, "hace 1 día"],
    [3 * 24 * 60, "hace 3 días"],
    [-5, "hace un momento"],
  ])("a los %d min dice «%s»", (minutes, text) => {
    expect(formatPurchaseDraftAge(saved, at(minutes))).toBe(text);
  });

  it("el resumen nombra proveedor, líneas y antigüedad", () => {
    const draft = parseStoredPurchaseDraft(
      serializePurchaseDraft(buildContent(), session, savedAt),
      session,
    );

    expect(draft && describeStoredPurchaseDraft(draft, at(20))).toBe(
      "Proveedor Demo, 2 líneas, hace 20 min",
    );
  });

  it("sin proveedor lo dice, y con proveedor sin nombre guardado no inventa uno", () => {
    const read = (content: PurchaseDraftContent) =>
      parseStoredPurchaseDraft(serializePurchaseDraft(content, session, savedAt), session);
    const withoutSupplier = read(buildContent({ supplierId: "", supplierName: undefined }));
    const unnamed = read(
      buildContent({
        lines: { ...buildContent().lines, items: [refresco] },
        supplierName: undefined,
      }),
    );

    expect(withoutSupplier && describeStoredPurchaseDraftContent(withoutSupplier)).toBe(
      "sin proveedor, 2 líneas",
    );
    expect(unnamed && describeStoredPurchaseDraftContent(unnamed)).toBe(
      "proveedor elegido, 1 línea",
    );
  });
});

describe("nombre de la compra en curso para el guardia (CNF-15)", () => {
  it("nombra proveedor, líneas y total en REF", () => {
    expect(
      describePurchaseInProgress({
        lineCount: 12,
        supplierId: "cont-supplier",
        supplierName: "Distribuidora X",
        totalRef: 240,
      }),
    ).toBe("Compra a Distribuidora X · 12 líneas · ref 240.00");
  });

  it("sin proveedor lo dice; con una línea va en singular", () => {
    expect(
      describePurchaseInProgress({ lineCount: 1, supplierId: "", supplierName: null, totalRef: 2.3 }),
    ).toBe("Compra sin proveedor · 1 línea · ref 2.30");
    expect(
      describePurchaseInProgress({
        lineCount: 0,
        supplierId: "cont-supplier",
        supplierName: null,
        totalRef: 0,
      }),
    ).toBe("Compra a proveedor elegido · 0 líneas · ref 0.00");
  });
});

describe("borrador cuyo proveedor ya no está disponible (CNF-16)", () => {
  const read = (content: PurchaseDraftContent) => {
    const draft = parseStoredPurchaseDraft(
      serializePurchaseDraft(content, session, savedAt),
      session,
    );

    if (!draft) {
      throw new Error("El borrador de prueba no es válido.");
    }

    return draft;
  };

  it("las líneas guardadas sirven de origen: producto, modo, cantidad, empaque y costo de respaldo", () => {
    expect(storedDraftSourceItems(read(buildContent()))).toEqual([
      {
        entryMode: "pack",
        packCostRef: refresco.packCostRef,
        packCount: refresco.packCount,
        packLabel: refresco.packLabel,
        product: { name: "Refresco Cola" },
        productId: "prod-refresco",
        quantity: refresco.quantity,
        unitCostRef: refresco.unitCostRef,
        unitsPerPack: refresco.unitsPerPack,
      },
      {
        entryMode: "unit",
        packCostRef: cable.packCostRef,
        packCount: cable.packCount,
        packLabel: cable.packLabel,
        product: { name: "Cable HDMI" },
        productId: "prod-cable",
        quantity: 3,
        unitCostRef: 2,
        unitsPerPack: cable.unitsPerPack,
      },
    ]);
  });

  it("el aviso nombra al proveedor, cuántas líneas no se restauraron y qué no se conserva", () => {
    const notice = describeDraftSupplierUnavailable(read(buildContent()));

    expect(notice).toContain("El proveedor Proveedor Demo de la compra guardada ya no está disponible");
    expect(notice).toContain("sus 2 líneas no se restauraron");
    expect(notice).toContain("los bloqueos y alícuotas elegidas no se conservan");
    expect(
      describeDraftSupplierUnavailable(
        read(buildContent({ lines: { ...buildContent().lines, items: [refresco] } })),
      ),
    ).toContain("su línea no se restauró");
  });
});

describe("borrador de compra · «Desarmar al recibir» (COM-14)", () => {
  function stored(content: PurchaseDraftContent) {
    const draft = parseStoredPurchaseDraft(serializePurchaseDraft(content, session, savedAt), session);

    if (!draft) {
      throw new Error("El borrador de prueba no es válido.");
    }

    return draft;
  }

  it("las marcas son un campo opcional: un borrador guardado antes de COM-14 sigue siendo válido", () => {
    const draft = stored(buildContent());

    expect(draft.lines).not.toHaveProperty("disassemble");
    expect(
      restorePurchaseDraft(draft, { products: allActive(), rateVes: 510 }).lines,
    ).not.toHaveProperty("disassemble");
  });

  it("se guardan y se reponen con sus líneas", () => {
    const content = buildContent();
    const draft = stored({ ...content, lines: { ...content.lines, disassemble: { "line-refresco": true } } });

    expect(draft.lines.disassemble).toEqual({ "line-refresco": true });
    expect(restorePurchaseDraft(draft, { products: allActive(), rateVes: 510 }).lines.disassemble).toEqual({
      "line-refresco": true,
    });
  });

  it("la marca de una línea que se quita al restaurar (producto inactivo) no vuelve", () => {
    const content = buildContent();
    const draft = stored({
      ...content,
      lines: { ...content.lines, disassemble: { "line-cable": true, "line-refresco": true } },
    });
    const products = allActive();

    products.set("prod-refresco", { name: "Refresco", status: "unavailable" });

    expect(restorePurchaseDraft(draft, { products, rateVes: 510 }).lines.disassemble).toEqual({
      "line-cable": true,
    });
  });

  it("un valor que no es `true` invalida el borrador (no se restaura a medias)", () => {
    const content = buildContent();
    const raw = JSON.parse(serializePurchaseDraft(content, session, savedAt)) as {
      lines: Record<string, unknown>;
    };

    raw.lines.disassemble = { "line-cable": "si" };

    expect(parseStoredPurchaseDraft(JSON.stringify(raw), session)).toBeNull();
  });
});
