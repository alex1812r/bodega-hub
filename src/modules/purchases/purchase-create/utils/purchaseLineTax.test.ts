import type { TaxRate } from "@/shared/hooks/useTaxRates";
import { roundMoney } from "@/shared/utils/currency";

import { createPackDraftItem, createUnitDraftItem, type PurchaseTaxState } from "../types";
import { sumDraftPurchaseTotals } from "./normalizePurchaseLine";
import {
  buildExemptOverrideNotice,
  buildPurchaseTaxBreakdown,
  buildPurchaseWebLines,
  chooseLineTax,
  countManualLinesLostToExempt,
  dropLineTax,
  EMPTY_PURCHASE_TAX_STATE,
  findActiveTaxRateByPct,
  findExemptTaxRate,
  resolvePurchaseLineTax,
  setPurchaseExempt,
} from "./purchaseLineTax";

function buildRate(overrides: Partial<TaxRate> & Pick<TaxRate, "code" | "pct">): TaxRate {
  return {
    id: `tax-${overrides.code}`,
    isActive: true,
    isDefault: false,
    isGlobal: true,
    label: overrides.code,
    sortOrder: 0,
    ...overrides,
  };
}

const exempt = buildRate({ code: "exento", label: "Exento", pct: 0 });
const reduced = buildRate({ code: "reducida", label: "Reducida", pct: 8 });
const general = buildRate({ code: "general", isDefault: true, label: "General", pct: 16 });
const luxury = buildRate({ code: "lujo", isActive: false, label: "Lujo", pct: 31 });
const rates = [exempt, reduced, general, luxury];

// Tasa real con la que el redondeo por línea no es trivial.
const RATE_VES = 798.326;

describe("resolvePurchaseLineTax", () => {
  it("por defecto usa la alícuota activa con el % de la categoría", () => {
    expect(resolvePurchaseLineTax({ categoryPct: 16, exempt: false, rates })).toEqual({
      categoryCode: "general",
      code: "general",
      label: "General",
      manual: false,
      rate: 16,
    });
  });

  it("si ninguna alícuota ACTIVA tiene el % de la categoría la línea queda sin alícuota válida", () => {
    expect(resolvePurchaseLineTax({ categoryPct: 31, exempt: false, rates })).toEqual({
      categoryCode: null,
      code: null,
      label: null,
      manual: false,
      rate: 31,
    });
    expect(resolvePurchaseLineTax({ categoryPct: 16, exempt: false, rates: [] }).code).toBeNull();
  });

  it("una elección a mano gana y se marca manual solo si difiere de la de la categoría", () => {
    expect(
      resolvePurchaseLineTax({ categoryPct: 16, choiceCode: "reducida", exempt: false, rates }),
    ).toMatchObject({ categoryCode: "general", code: "reducida", manual: true, rate: 8 });
    expect(
      resolvePurchaseLineTax({ categoryPct: 16, choiceCode: "general", exempt: false, rates }),
    ).toMatchObject({ code: "general", manual: false });
  });

  it("una elección que ya no está activa se ignora", () => {
    expect(
      resolvePurchaseLineTax({ categoryPct: 16, choiceCode: "lujo", exempt: false, rates }),
    ).toMatchObject({ code: "general", manual: false, rate: 16 });
  });

  it('con "Compra exenta" la alícuota por defecto es la del 0 % y la línea puede elegir otra', () => {
    expect(resolvePurchaseLineTax({ categoryPct: 16, exempt: true, rates })).toEqual({
      categoryCode: "general",
      code: "exento",
      label: "Exento",
      manual: false,
      rate: 0,
    });
    expect(
      resolvePurchaseLineTax({ categoryPct: 16, choiceCode: "general", exempt: true, rates }),
    ).toMatchObject({ code: "general", manual: true, rate: 16 });
  });

  it('con "Compra exenta" y sin alícuota activa del 0 % la línea calcula al 0 % pero sin código', () => {
    expect(
      resolvePurchaseLineTax({ categoryPct: 16, exempt: true, rates: [reduced, general] }),
    ).toMatchObject({ code: null, rate: 0 });
  });
});

describe("findActiveTaxRateByPct / findExemptTaxRate", () => {
  it("entre varias activas con el mismo % gana la por defecto de la tienda", () => {
    const twin = buildRate({ code: "general-b", pct: 16 });

    expect(findActiveTaxRateByPct([twin, general], 16)).toBe(general);
    expect(findActiveTaxRateByPct([twin, { ...general, isDefault: false }], 16)).toBe(twin);
  });

  it("nunca devuelve una inactiva", () => {
    expect(findActiveTaxRateByPct(rates, 31)).toBeNull();
    expect(findExemptTaxRate([{ ...exempt, isActive: false }, general])).toBeNull();
    expect(findExemptTaxRate(rates)).toBe(exempt);
  });
});

describe("estado de alícuotas de la compra", () => {
  it("elegir, quitar y alternar la compra exenta no mutan el estado anterior", () => {
    const chosen = chooseLineTax(EMPTY_PURCHASE_TAX_STATE, "line-1", "reducida");

    expect(EMPTY_PURCHASE_TAX_STATE).toEqual({ choices: {}, exempt: false });
    expect(chosen).toEqual({ choices: { "line-1": "reducida" }, exempt: false });
    expect(dropLineTax(chosen, "line-1")).toEqual({ choices: {}, exempt: false });
    expect(dropLineTax(chosen, "otra")).toBe(chosen);
    // Activar o desactivar descarta las elecciones a mano.
    expect(setPurchaseExempt(true)).toEqual({ choices: {}, exempt: true });
    expect(setPurchaseExempt(false)).toEqual({ choices: {}, exempt: false });
  });

  it("elegir una alícuota en una línea no apaga la compra exenta", () => {
    expect(chooseLineTax(setPurchaseExempt(true), "line-1", "general")).toEqual({
      choices: { "line-1": "general" },
      exempt: true,
    });
  });
});

function buildLines(taxState: PurchaseTaxState) {
  const categoryPctByProductId: Record<string, number> = {
    "prod-cable": 16,
    "prod-harina": 0,
    "prod-jugo": 8,
    "prod-refresco": 16,
  };

  return buildPurchaseWebLines({
    getCategoryPct: (productId) => categoryPctByProductId[productId] ?? 0,
    items: [
      createUnitDraftItem({
        id: "line-cable",
        productId: "prod-cable",
        quantity: 7,
        rateVes: RATE_VES,
        taxRate: 16,
        unitCostVes: 333.33,
      }),
      createPackDraftItem({
        id: "line-refresco",
        packCostVes: 1755.33,
        packCount: 3,
        packLabel: "Bulto",
        productId: "prod-refresco",
        rateVes: RATE_VES,
        taxRate: 16,
        unitsPerPack: 100,
      }),
      createUnitDraftItem({
        id: "line-jugo",
        productId: "prod-jugo",
        quantity: 13,
        rateVes: RATE_VES,
        taxRate: 8,
        unitCostVes: 91.17,
      }),
      createUnitDraftItem({
        id: "line-harina",
        productId: "prod-harina",
        quantity: 5,
        rateVes: RATE_VES,
        taxRate: 0,
        unitCostVes: 47.99,
      }),
    ],
    rateVes: RATE_VES,
    rates,
    taxState,
  });
}

describe("buildPurchaseWebLines", () => {
  it("iguala item.taxRate al % de la alícuota efectiva de cada línea", () => {
    const lines = buildLines(chooseLineTax(EMPTY_PURCHASE_TAX_STATE, "line-cable", "reducida"));

    expect(lines.map((line) => [line.item.id, line.tax.code, line.item.taxRate])).toEqual([
      ["line-cable", "reducida", 8],
      ["line-refresco", "general", 16],
      ["line-jugo", "reducida", 8],
      ["line-harina", "exento", 0],
    ]);
  });

  it('con "Compra exenta" todas las líneas calculan al 0 %', () => {
    const lines = buildLines(setPurchaseExempt(true));

    expect(lines.map((line) => line.item.taxRate)).toEqual([0, 0, 0, 0]);
    expect(lines.map((line) => line.tax.code)).toEqual(["exento", "exento", "exento", "exento"]);
  });
});

describe("countManualLinesLostToExempt / buildExemptOverrideNotice", () => {
  it("cuenta las líneas elegidas a mano que dejan de tener su alícuota", () => {
    let state = chooseLineTax(EMPTY_PURCHASE_TAX_STATE, "line-cable", "reducida");
    state = chooseLineTax(state, "line-jugo", "general");
    // Elegida a mano, pero ya exenta: no cambia al activar el toggle.
    state = chooseLineTax(state, "line-refresco", "exento");
    // Igual que la de su categoría: no es una elección distinta.
    state = chooseLineTax(state, "line-harina", "exento");

    expect(countManualLinesLostToExempt(buildLines(state), rates)).toBe(2);
    expect(countManualLinesLostToExempt(buildLines(EMPTY_PURCHASE_TAX_STATE), rates)).toBe(0);
  });

  it("redacta el aviso en singular y en plural", () => {
    expect(buildExemptOverrideNotice(1)).toBe(
      "1 línea tenía una alícuota elegida a mano; ahora es exenta",
    );
    expect(buildExemptOverrideNotice(3)).toBe(
      "3 líneas tenían una alícuota elegida a mano; ahora son exentas",
    );
  });
});

describe("buildPurchaseTaxBreakdown", () => {
  it("agrupa por alícuota, de menor a mayor %, con su nombre y porcentaje", () => {
    const breakdown = buildPurchaseTaxBreakdown(buildLines(EMPTY_PURCHASE_TAX_STATE), RATE_VES);

    expect(breakdown.map((row) => [row.key, row.label, row.rate])).toEqual([
      ["exento", "Exento 0 %", 0],
      ["reducida", "Reducida 8 %", 8],
      ["general", "General 16 %", 16],
    ]);
    expect(breakdown[0]).toMatchObject({ baseVes: 239.95, taxRef: 0, taxVes: 0 });
  });

  it("el desglose suma al céntimo lo mismo que sumDraftPurchaseTotals, en Bs y en REF", () => {
    const lines = buildLines(chooseLineTax(EMPTY_PURCHASE_TAX_STATE, "line-cable", "reducida"));
    const breakdown = buildPurchaseTaxBreakdown(lines, RATE_VES);
    const totals = sumDraftPurchaseTotals(
      lines.map((line) => line.item),
      RATE_VES,
    );
    const sum = (pick: (row: (typeof breakdown)[number]) => number) =>
      roundMoney(breakdown.reduce((acc, row) => acc + pick(row), 0));

    expect(breakdown).toHaveLength(3);
    expect(totals.taxVes).toBeGreaterThan(0);
    expect(sum((row) => row.baseRef)).toBe(totals.subtotalRef);
    expect(sum((row) => row.baseVes)).toBe(totals.subtotalVes);
    expect(sum((row) => row.taxRef)).toBe(totals.taxRef);
    expect(sum((row) => row.taxVes)).toBe(totals.taxVes);
  });

  it("las líneas sin alícuota válida se agrupan aparte, por su porcentaje", () => {
    const lines = buildPurchaseWebLines({
      getCategoryPct: () => 31,
      items: [
        createUnitDraftItem({
          id: "line-ron",
          productId: "prod-ron",
          rateVes: 510,
          taxRate: 31,
          unitCostRef: 10,
        }),
      ],
      rateVes: 510,
      rates,
      taxState: EMPTY_PURCHASE_TAX_STATE,
    });

    expect(buildPurchaseTaxBreakdown(lines, 510)).toEqual([
      {
        baseRef: 10,
        baseVes: 5100,
        key: "sin-alicuota-31",
        label: "Sin alícuota 31 %",
        rate: 31,
        taxRef: 3.1,
        taxVes: 1581,
      },
    ]);
  });

  it("sin líneas no hay desglose", () => {
    expect(buildPurchaseTaxBreakdown([], RATE_VES)).toEqual([]);
  });
});
