import { createUnitDraftItem } from "@bodega/core/purchases";

import { z } from "zod";

import { invoiceScanBodyFields } from "@/modules/invoice-scan/server/confirmScan.server";

import type { PurchaseLinesSnapshot } from "../hooks/usePurchaseLines";
import type { PurchaseProductResolutions } from "../services/resolvePurchaseProducts";
import {
  applyInvoiceReviewDraft,
  buildInvoiceScanSubmission,
  describeInvoiceForNotes,
  describeLearnedAliases,
  pruneLoadedInvoiceScan,
} from "./loadedInvoiceScan";
import { makeLoadedReviewDraft, productUuid, REVIEW_SCAN_ID, REVIEW_TAX_RATES } from "./reviewFixtures";

const EMPTY_LINES: PurchaseLinesSnapshot = {
  items: [],
  locks: { locked: {} },
  review: { baselines: {}, reviewed: {} },
  taxState: { choices: {}, exempt: false },
};

function catalogProduct(productId: string, name: string, taxRate: number) {
  return {
    costWithTaxRef: 1,
    currentStock: 0,
    link: "none" as const,
    name,
    packUnits: [],
    productId,
    sku: name.toUpperCase(),
    taxRate,
    unitCostRef: 1,
  };
}

function activeProducts(): PurchaseProductResolutions {
  return new Map([
    [productUuid(1), { product: catalogProduct(productUuid(1), "Harina PAN", 16), status: "active" }],
    [productUuid(3), { product: catalogProduct(productUuid(3), "Refresco Cola", 0), status: "active" }],
  ]);
}

function idSequence() {
  let next = 0;

  return () => {
    next += 1;
    return `line-${next}`;
  };
}

const existingItem = createUnitDraftItem({
  costCurrency: "ves",
  id: "line-old",
  productId: "prod-old",
  quantity: 1,
  rateVes: 510,
  unitCostVes: 1020,
});
const EXISTING_LINES: PurchaseLinesSnapshot = {
  items: [existingItem],
  locks: { locked: {} },
  review: { baselines: {}, reviewed: {} },
  taxState: { choices: {}, exempt: false },
};

describe("applyInvoiceReviewDraft", () => {
  it("pone las líneas bloqueadas, con su alícuota, desarme, catálogo y el mapa a la factura", () => {
    const applied = applyInvoiceReviewDraft(makeLoadedReviewDraft(), {
      current: EMPTY_LINES,
      currentCurrency: "ves",
      lockExisting: true,
      nextId: idSequence(),
      products: activeProducts(),
      rateVes: 500,
      replace: false,
    });

    // SCN-UI-C1: la compra va en los Bs de la factura a la tasa elegida (la del formulario).
    expect(applied.costCurrency).toBe("ves");
    expect(applied.lines.items.map((item) => [item.id, item.productId, item.costCurrency])).toEqual([
      ["line-1", productUuid(1), "ves"],
      ["line-2", productUuid(3), "ves"],
    ]);
    expect(applied.lines.items[0]).toMatchObject({ unitCostRef: 10, unitCostVes: 5000 });
    expect(applied.lines.locks.locked).toEqual({ "line-1": true, "line-2": true });
    expect(Object.keys(applied.lines.review.reviewed).sort()).toEqual(["line-1", "line-2"]);
    expect(applied.lines.taxState.choices).toEqual({ "line-1": "general", "line-2": "exento" });
    expect(applied.lines.disassemble).toEqual({ "line-2": true });
    expect(applied.lineMeta.get(productUuid(1))).toMatchObject({ name: "Harina PAN", taxRate: 16 });
    expect(applied.loaded).toEqual({
      extraction: makeLoadedReviewDraft().body.invoiceScanExtraction,
      invoiceRateVes: 500,
      lineIndexByItemId: { "line-1": 0, "line-2": 2 },
      scanId: REVIEW_SCAN_ID,
    });
    expect(applied.notices).toEqual([]);
  });

  it("añade sobre las líneas que había (pasadas a la moneda de la factura) o las sustituye", () => {
    const options = {
      current: EXISTING_LINES,
      currentCurrency: "ves" as const,
      nextId: idSequence(),
      products: activeProducts(),
      rateVes: 500,
    };
    const added = applyInvoiceReviewDraft(makeLoadedReviewDraft(), {
      ...options,
      lockExisting: false,
      replace: false,
    });

    expect(added.lines.items.map((item) => item.id)).toEqual(["line-1", "line-2", "line-old"]);
    expect(added.lines.items[2]).toMatchObject({ costCurrency: "ves", unitCostVes: 1020 });
    expect(added.lines.locks.locked).toEqual({ "line-1": true, "line-2": true });

    const lockedAll = applyInvoiceReviewDraft(makeLoadedReviewDraft(), {
      ...options,
      lockExisting: true,
      replace: false,
    });
    expect(lockedAll.lines.locks.locked["line-old"]).toBe(true);

    const replaced = applyInvoiceReviewDraft(makeLoadedReviewDraft(), {
      ...options,
      lockExisting: true,
      replace: true,
    });
    expect(replaced.lines.items.map((item) => item.productId)).toEqual([productUuid(1), productUuid(3)]);
  });

  it("deja fuera los productos que ya no existen o están inactivos y lo avisa", () => {
    const products = activeProducts();
    products.set(productUuid(3), { name: "Refresco Viejo", status: "unavailable" });

    const applied = applyInvoiceReviewDraft(makeLoadedReviewDraft(), {
      current: EMPTY_LINES,
      currentCurrency: "ves",
      lockExisting: true,
      nextId: idSequence(),
      products,
      rateVes: 500,
      replace: false,
    });

    expect(applied.lines.items).toHaveLength(1);
    expect(applied.loaded.lineIndexByItemId).toEqual({ "line-1": 0 });
    expect(applied.notices).toEqual([
      "Se quitó 1 producto de la factura que ya no existe o está inactivo: Refresco Viejo.",
    ]);
  });
});

describe("buildInvoiceScanSubmission", () => {
  function loadedLines() {
    return applyInvoiceReviewDraft(makeLoadedReviewDraft(), {
      current: EXISTING_LINES,
      currentCurrency: "ref",
      lockExisting: false,
      nextId: idSequence(),
      products: activeProducts(),
      rateVes: 500,
      replace: false,
    });
  }

  it("reconstruye líneas y extracción desde el formulario vigente, en Bs de la factura (D10)", () => {
    const applied = loadedLines();
    const [harina, refresco, old] = applied.lines.items;
    const edited = [
      // Editada en el formulario: 3 unidades a REF 11 → Bs 5 500 con la tasa elegida (500).
      { item: { ...harina, quantity: 3, unitCostRef: 11 }, tax: { code: "general" } },
      { item: { ...refresco, packLabel: "Bulto", unitsPerPack: 24 }, tax: { code: "exento" } },
      { item: old, tax: { code: "general" } },
    ];

    const body = buildInvoiceScanSubmission(applied.loaded, edited, {
      costCurrency: "ref",
      taxRates: REVIEW_TAX_RATES,
    });

    expect(body.invoiceScanId).toBe(REVIEW_SCAN_ID);
    expect(body.invoiceScanLines).toEqual([
      { lineIndex: 0, productId: productUuid(1) },
      { lineIndex: 2, packLabel: "Bulto", productId: productUuid(3), unitsPerPack: 24 },
    ]);
    expect(body.invoiceScanExtraction.lines.map((line) => [line.quantity, line.unitPrice, line.unitsPerPack])).toEqual([
      [3, 5500, undefined],
      [1, 10, undefined],
      [1, 12000, 24],
    ]);
    // Lo leído que no se corrige se conserva (texto, total impreso).
    expect(body.invoiceScanExtraction.lines[0]).toMatchObject({ lineTotal: 10000, rawText: "HARINA PAN 1KG" });
    expect(z.object(invoiceScanBodyFields).safeParse(body).error?.issues).toBeUndefined();
  });

  it("con la compra en Bs toma los Bs tecleados; una línea quitada sale de invoiceScanLines", () => {
    const applied = loadedLines();
    const [harina] = applied.lines.items;

    const body = buildInvoiceScanSubmission(
      applied.loaded,
      [{ item: { ...harina, unitCostVes: 4900 }, tax: { code: "general" } }],
      { costCurrency: "ves", taxRates: REVIEW_TAX_RATES },
    );

    expect(body.invoiceScanLines).toEqual([{ lineIndex: 0, productId: productUuid(1) }]);
    expect(body.invoiceScanExtraction.lines[0].unitPrice).toBe(4900);
    expect(body.invoiceScanExtraction.lines[2].unitPrice).toBe(12000);
  });

  it("factura en dólares aceptada: el precio final es el REF", () => {
    const applied = loadedLines();
    const usdLoaded = { ...applied.loaded, invoiceRateVes: undefined };
    const [harina] = applied.lines.items;

    const body = buildInvoiceScanSubmission(usdLoaded, [{ item: harina, tax: { code: "general" } }], {
      costCurrency: "ref",
      taxRates: REVIEW_TAX_RATES,
    });

    expect(body.invoiceScanExtraction.lines[0]).toMatchObject({ taxHint: "general", unitPrice: 10 });
  });
});

describe("textos y poda", () => {
  it("número y fecha de la factura para las notas", () => {
    expect(describeInvoiceForNotes({ date: "2026-10-14", purchaseNumber: "000123" })).toBe(
      "Factura 000123 del 14/10/2026",
    );
    expect(describeInvoiceForNotes({ purchaseNumber: " 9 " })).toBe("Factura 9");
    expect(describeInvoiceForNotes({ date: "2026-10-14" })).toBe("Factura del 14/10/2026");
    expect(describeInvoiceForNotes({})).toBeNull();
  });

  it("alias aprendidos", () => {
    expect(describeLearnedAliases(1)).toBe("Se aprendió 1 alias de este proveedor");
    expect(describeLearnedAliases(3)).toBe("Se aprendieron 3 alias de este proveedor");
  });

  it("la poda quita las líneas que ya no están", () => {
    const loaded = {
      extraction: makeLoadedReviewDraft().body.invoiceScanExtraction,
      lineIndexByItemId: { a: 0, b: 2 },
      scanId: REVIEW_SCAN_ID,
    };

    expect(pruneLoadedInvoiceScan(loaded, ["b"]).lineIndexByItemId).toEqual({ b: 2 });
  });
});
