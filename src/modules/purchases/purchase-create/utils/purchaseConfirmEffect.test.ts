import type { PaymentFormPayload } from "@/shared/payments/PaymentFormFields";
import { DEFAULT_MARGIN_THRESHOLDS } from "@/shared/utils/pricing";

import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseDraftItem,
  type PurchaseWebLine,
} from "../types";
import {
  buildPurchaseConfirmEffect,
  type PurchaseConfirmFacts,
  type PurchaseConfirmInput,
  type PurchaseConfirmProductFacts,
  purchaseConfirmKey,
} from "./purchaseConfirmEffect";

const RATE = 510;

const NAMES: Record<string, string> = {
  "prod-cable": "Cable HDMI",
  "prod-harina": "Harina PAN",
  "prod-pack": "Caja de refrescos",
};

function webLine(item: PurchaseDraftItem, disassemble?: boolean): PurchaseWebLine {
  return {
    changes: [],
    ...(disassemble === undefined ? {} : { disassemble }),
    edited: false,
    editedMark: false,
    item,
    locked: false,
    tax: { categoryCode: null, code: "x", label: "X", manual: false, rate: item.taxRate },
  };
}

function unitLine(
  productId: string,
  input: { id?: string; quantity?: number; taxRate?: number; unitCostRef: number },
) {
  return webLine(
    createUnitDraftItem({
      costCurrency: "ref",
      id: input.id ?? `line-${productId}`,
      productId,
      quantity: input.quantity ?? 1,
      rateVes: RATE,
      taxRate: input.taxRate ?? 0,
      unitCostRef: input.unitCostRef,
    }),
  );
}

function facts(products: Record<string, Partial<PurchaseConfirmProductFacts>>): PurchaseConfirmFacts {
  return {
    products: new Map(
      Object.entries(products).map(([productId, known]) => [
        productId,
        // Precio alto: salvo que el test diga otro, ninguna ganancia baja de banda.
        { currentCostRef: 1, link: "active", salePriceRef: 100, ...known },
      ]),
    ),
    thresholds: DEFAULT_MARGIN_THRESHOLDS,
  };
}

function build(input: Partial<PurchaseConfirmInput>) {
  return buildPurchaseConfirmEffect({
    discountRef: 0,
    getProductName: (productId) => NAMES[productId] ?? "Producto",
    lines: [],
    payment: null,
    rateVes: RATE,
    status: "recibido",
    supplierName: "Distribuidora Demo",
    ...input,
  });
}

const cashPayment: PaymentFormPayload = {
  amount: 1020,
  bankName: undefined,
  currency: "VES",
  method: "efectivo_ves",
  notes: undefined,
  phone: undefined,
  referenceCode: undefined,
};

describe("buildPurchaseConfirmEffect (CNF-01)", () => {
  it("recibido: por línea, lo que entra y el costo anterior → nuevo, que ya incluye el IVA de la línea", () => {
    const effect = build({
      facts: facts({ "prod-cable": { currentCostRef: 1.5 }, "prod-harina": { currentCostRef: 1 } }),
      lines: [
        unitLine("prod-cable", { quantity: 3, unitCostRef: 2 }),
        unitLine("prod-harina", { quantity: 10, taxRate: 16, unitCostRef: 1 }),
      ],
    });

    expect(effect.receivesNow).toBe(true);
    expect(effect.supplierName).toBe("Distribuidora Demo");
    expect(effect.lines).toEqual([
      expect.objectContaining({
        cost: { afterRef: 2, beforeRef: 1.5 },
        name: "Cable HDMI",
        quantity: 3,
      }),
      // 1,00 neto + 16 % = 1,16: lo que `create_purchase` deja en `current_cost_ref`.
      expect.objectContaining({
        cost: { afterRef: 1.16, beforeRef: 1 },
        name: "Harina PAN",
        quantity: 10,
      }),
    ]);
    expect(effect.lines[0]?.pack).toBeUndefined();
  });

  it("totales con las mismas cuentas del resumen: subtotal − descuento + IVA, en REF y en Bs, y la tasa", () => {
    const effect = build({
      discountRef: 1,
      lines: [
        unitLine("prod-cable", { quantity: 3, unitCostRef: 2 }),
        unitLine("prod-harina", { quantity: 10, taxRate: 16, unitCostRef: 1 }),
      ],
    });

    // Subtotal 16,00; IVA 1,60; descuento 1,00.
    expect(effect.totalRef).toBe(16.6);
    expect(effect.totalVes).toBe(8466);
    expect(effect.rateVes).toBe(RATE);
    expect(effect.discountRef).toBe(1);
  });

  it("línea por empaque: empaques × unidades = unidades que entran, y el costo es el unitario", () => {
    const item = createPackDraftItem({
      costCurrency: "ref",
      id: "line-pack",
      packCostRef: 12,
      packCount: 2,
      packLabel: "Caja",
      productId: "prod-cable",
      rateVes: RATE,
      taxRate: 16,
      unitsPerPack: 12,
    });
    const [line] = build({ facts: facts({ "prod-cable": {} }), lines: [webLine(item)] }).lines;

    expect(line).toMatchObject({
      cost: { afterRef: 1.16, beforeRef: 1 },
      pack: { count: 2, label: "Caja", unitsPerPack: 12 },
      quantity: 24,
    });
  });

  it("línea por empaque de un producto que ES el empaque de una receta: entra en empaques, al costo del empaque", () => {
    const item = createPackDraftItem({
      costCurrency: "ref",
      id: "line-pack",
      packCostRef: 12,
      packCount: 2,
      packLabel: "Caja",
      productId: "prod-pack",
      rateVes: RATE,
      unitsPerPack: 12,
    });
    const [line] = build({
      lines: [webLine(item, false)],
      recipes: [{ components: [{ name: "Refresco", unitsPerPack: 12 }], packProduct: { id: "prod-pack" } }],
    }).lines;

    expect(line?.quantity).toBe(2);
    expect(line?.pack).toBeUndefined();
    expect(line?.cost?.afterRef).toBe(12);
    expect(line?.disassemble).toBeUndefined();
  });

  it("línea marcada para desarmar: los empaques que salen y las unidades de cada componente de la receta", () => {
    const recipes = [
      {
        components: [
          { name: "Refresco cola", unitsPerPack: 8 },
          { name: "Refresco naranja", unitsPerPack: 4 },
        ],
        packProduct: { id: "prod-pack" },
      },
    ];
    const marked = { ...unitLine("prod-pack", { quantity: 3, unitCostRef: 10 }), disassemble: true };
    const unmarked = { ...marked, disassemble: false };

    expect(build({ lines: [marked], recipes }).lines[0]?.disassemble).toEqual({
      components: [
        { name: "Refresco cola", units: 24 },
        { name: "Refresco naranja", units: 12 },
      ],
      packs: 3,
    });
    expect(build({ lines: [unmarked], recipes }).lines[0]?.disassemble).toBeUndefined();
    // Sin la receta cargada no se inventa el desarme; una respuesta rara no rompe.
    expect(build({ lines: [marked], recipes: null }).lines[0]?.disassemble).toBeUndefined();
    expect(
      build({ lines: [marked], recipes: { error: "x" } as unknown as [] }).lines[0]?.disassemble,
    ).toBeUndefined();
  });

  it("la ganancia solo se informa si BAJA de banda con el costo nuevo", () => {
    // Precio 2,00. Costo 1,00 → 100 % (alta); 1,70 → 17,65 % (media); 1,90 → 5,26 % (baja).
    const drops = build({
      facts: facts({ "prod-cable": { currentCostRef: 1, salePriceRef: 2 } }),
      lines: [unitLine("prod-cable", { unitCostRef: 1.7 })],
    }).lines[0];
    const stays = build({
      facts: facts({ "prod-cable": { currentCostRef: 1, salePriceRef: 2 } }),
      lines: [unitLine("prod-cable", { unitCostRef: 1.2 })],
    }).lines[0];
    const improves = build({
      facts: facts({ "prod-cable": { currentCostRef: 1.9, salePriceRef: 2 } }),
      lines: [unitLine("prod-cable", { unitCostRef: 1 })],
    }).lines[0];

    expect(drops?.cost?.marginDrop?.previousPct).toBe(100);
    expect(drops?.cost?.marginDrop?.pct).toBeCloseTo(17.647, 2);
    expect(stays?.cost?.marginDrop).toBeUndefined();
    expect(improves?.cost?.marginDrop).toBeUndefined();
  });

  it("usa los cortes del semáforo de la tienda", () => {
    const strict: PurchaseConfirmFacts = {
      ...facts({ "prod-cable": { currentCostRef: 1, salePriceRef: 2 } }),
      thresholds: { high: 70, low: 10 },
    };
    const effect = build({ facts: strict, lines: [unitLine("prod-cable", { unitCostRef: 1.2 })] });

    // 100 % → 66,67 %: con verde desde 70 % baja a amarillo.
    expect(effect.lines[0]?.cost?.marginDrop?.pct).toBeCloseTo(66.667, 2);
    expect(effect.thresholds).toEqual({ high: 70, low: 10 });
  });

  it("producto repetido: la segunda línea parte del costo que dejó la primera", () => {
    const effect = build({
      facts: facts({ "prod-cable": { currentCostRef: 1 } }),
      lines: [
        unitLine("prod-cable", { id: "a", unitCostRef: 2 }),
        unitLine("prod-cable", { id: "b", unitCostRef: 3 }),
      ],
    });

    expect(effect.lines.map((line) => line.cost)).toEqual([
      { afterRef: 2, beforeRef: 1 },
      { afterRef: 3, beforeRef: 2 },
    ]);
  });

  it("vínculos nuevos: solo los productos que el proveedor nunca tuvo, sin repetir", () => {
    const effect = build({
      facts: facts({
        "prod-cable": { link: "none" },
        "prod-harina": { link: "active" },
        "prod-pack": { link: "inactive" },
      }),
      lines: [
        unitLine("prod-cable", { id: "a", unitCostRef: 2 }),
        unitLine("prod-cable", { id: "b", unitCostRef: 2 }),
        unitLine("prod-harina", { unitCostRef: 1 }),
        unitLine("prod-pack", { unitCostRef: 1 }),
      ],
    });

    expect(effect.newLinkNames).toEqual(["Cable HDMI"]);
    expect(effect.lines.map((line) => line.firstLink)).toEqual([true, true, false, false]);
  });

  it("pedido: ninguna línea lleva costo (no cambia hasta recibir), pero el vínculo nuevo sí se crea", () => {
    const effect = build({
      facts: facts({ "prod-cable": { currentCostRef: 1, link: "none", salePriceRef: 1.1 } }),
      lines: [unitLine("prod-cable", { quantity: 4, unitCostRef: 2 })],
      status: "pedido",
    });

    expect(effect.receivesNow).toBe(false);
    expect(effect.lines[0]).toEqual({
      firstLink: true,
      itemId: "line-prod-cable",
      name: "Cable HDMI",
      productId: "prod-cable",
      quantity: 4,
    });
    expect(effect.newLinkNames).toEqual(["Cable HDMI"]);
    expect(effect.totalRef).toBe(8);
  });

  it("sin lo consultado no compara: costo nuevo sin anterior, sin banda y sin vínculos", () => {
    const effect = build({ lines: [unitLine("prod-cable", { unitCostRef: 2 })] });

    expect(effect.hasFacts).toBe(false);
    expect(effect.lines[0]?.cost).toEqual({ afterRef: 2, beforeRef: null });
    expect(effect.lines[0]?.firstLink).toBe(false);
    expect(effect.newLinkNames).toEqual([]);
    expect(effect.thresholds).toBeUndefined();
  });

  it("un producto que no se pudo consultar queda sin costo anterior aunque los demás lo tengan", () => {
    const effect = build({
      facts: facts({ "prod-cable": { currentCostRef: 1 } }),
      lines: [
        unitLine("prod-cable", { unitCostRef: 2 }),
        unitLine("prod-harina", { unitCostRef: 3 }),
      ],
    });

    expect(effect.hasFacts).toBe(true);
    expect(effect.lines[1]?.cost).toEqual({ afterRef: 3, beforeRef: null });
  });

  it.each([
    ["efectivo_ves", "VES", 1020, "vault_cash_ves", 2],
    ["efectivo_usd", "USD", 2, "vault_cash_ref", 1020],
    ["transferencia", "VES", 1020, "vault_account", 2],
    ["pago_movil", "VES", 1020, "vault_account", 2],
    ["punto_venta", "VES", 1020, "vault_account", 2],
  ] as const)(
    "pago con %s: monto, equivalente a la tasa y de dónde sale",
    (method, currency, amount, source, equivalent) => {
      const effect = build({
        lines: [unitLine("prod-cable", { unitCostRef: 2 })],
        payment: { ...cashPayment, amount, currency, method },
      });

      expect(effect.payment).toEqual({ amount, currency, equivalent, method, source });
    },
  );

  it("sin «Pagar ahora» no hay pago", () => {
    expect(build({ lines: [unitLine("prod-cable", { unitCostRef: 2 })] }).payment).toBeNull();
  });
});

describe("purchaseConfirmKey (CNF-01)", () => {
  const base: PurchaseConfirmInput = {
    discountRef: 0,
    getProductName: (productId) => NAMES[productId] ?? "Producto",
    lines: [unitLine("prod-cable", { unitCostRef: 2 })],
    payment: null,
    rateVes: RATE,
    status: "recibido",
    supplierName: "Distribuidora Demo",
  };
  const key = purchaseConfirmKey(base);

  it("no depende de lo consultado ni de la identidad de las líneas", () => {
    expect(purchaseConfirmKey({ ...base, facts: facts({ "prod-cable": { link: "none" } }) })).toBe(key);
    expect(
      purchaseConfirmKey({ ...base, lines: [unitLine("prod-cable", { unitCostRef: 2 })] }),
    ).toBe(key);
  });

  it.each<[string, Partial<PurchaseConfirmInput>]>([
    ["una línea más", { lines: [...base.lines, unitLine("prod-harina", { unitCostRef: 1 })] }],
    ["otra cantidad", { lines: [unitLine("prod-cable", { quantity: 2, unitCostRef: 2 })] }],
    ["otro costo", { lines: [unitLine("prod-cable", { unitCostRef: 2.5 })] }],
    ["otra alícuota", { lines: [unitLine("prod-cable", { taxRate: 16, unitCostRef: 2 })] }],
    ["otra tasa", { rateVes: 520 }],
    ["otro estado", { status: "pedido" }],
    ["otro descuento", { discountRef: 1 }],
    ["un pago", { payment: cashPayment }],
    ["otro proveedor", { supplierName: "Otro" }],
  ])("cambia con %s", (_label, change) => {
    expect(purchaseConfirmKey({ ...base, ...change })).not.toBe(key);
  });
});
