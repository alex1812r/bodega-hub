/**
 * @jest-environment node
 *
 * SCN-10f · catálogo del escenario contra las verdades del banco (puro, sin base).
 */
import { resolve } from "node:path";

import { normalizeTaxId } from "../../src/modules/invoice-scan/server/match/text";

import {
  SCENARIO_CATEGORIES,
  SCENARIO_PRODUCTS,
  SCENARIO_RECIPES,
  SCENARIO_SUPPLIERS,
  inCatalogProducts,
  scenarioSku,
} from "./scenario/catalog";
import { interpolateRate, plannedExchangeRates, plannedPurchases, productCostSources } from "./scenario/plan";
import { assertScenarioEnv } from "./seed-lab";
import { loadTruth } from "./truth";

const truths = loadTruth(resolve(__dirname, "truth"));
const products = new Map(SCENARIO_PRODUCTS.map((product) => [product.key, product]));
const suppliers = new Map(SCENARIO_SUPPLIERS.map((supplier) => [supplier.key, supplier]));
const categories = new Map(SCENARIO_CATEGORIES.map((category) => [category.key, category]));

const truthLines = truths.flatMap((truth) =>
  truth.extraction.lines.map((line, index) => ({ truth, line, meta: truth.lines[index] })),
);
const truthKeys = new Set(truthLines.map((entry) => entry.meta.productKey).filter((key): key is string => key !== null));

const GOOD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:14321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STOCK_LAB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:14322/postgres",
  STOCK_TEST_ALLOW_WRITES_HOST: "127.0.0.1",
};

describe("catálogo del escenario vs verdades", () => {
  it("toda productKey de las verdades está en el catálogo (dentro o fuera) y no sobra ninguna", () => {
    const missing = [...truthKeys].filter((key) => !products.has(key));
    const extra = SCENARIO_PRODUCTS.map((product) => product.key).filter((key) => !truthKeys.has(key));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("no hay claves, nombres, SKU ni barcodes duplicados", () => {
    const keys = SCENARIO_PRODUCTS.map((product) => product.key);
    expect(new Set(keys).size).toBe(keys.length);
    const names = SCENARIO_PRODUCTS.map((product) => product.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const skus = [...SCENARIO_PRODUCTS.map((_, index) => scenarioSku(index)), ...SCENARIO_RECIPES.map((r) => r.packSku)];
    expect(new Set(skus).size).toBe(skus.length);
    const barcodes = SCENARIO_PRODUCTS.flatMap((product) => (product.barcode ? [product.barcode] : []));
    expect(new Set(barcodes).size).toBe(barcodes.length);
  });

  it("deja ~10 % fuera de catálogo, con los insumos fuera y repartido entre al menos 5 proveedores", () => {
    const out = SCENARIO_PRODUCTS.filter((product) => !product.inCatalog);
    const ratio = out.length / SCENARIO_PRODUCTS.length;
    expect(ratio).toBeGreaterThanOrEqual(0.08);
    expect(ratio).toBeLessThanOrEqual(0.13);
    for (const product of SCENARIO_PRODUCTS.filter((p) => p.key.startsWith("insumo-"))) {
      expect(product.inCatalog).toBe(false);
    }
    const outKeys = new Set(out.map((product) => product.key));
    const outSuppliers = new Set(
      truthLines.filter((entry) => entry.meta.productKey && outKeys.has(entry.meta.productKey)).map((e) => e.truth.supplierKey),
    );
    expect(outSuppliers.size).toBeGreaterThanOrEqual(5);
  });

  it("el nombre del producto no es el texto de la factura", () => {
    const raw = new Set(truthLines.map((entry) => entry.line.rawText.trim().toLowerCase()));
    for (const product of inCatalogProducts()) {
      expect(raw.has(product.name.trim().toLowerCase())).toBe(false);
    }
  });

  it("la alícuota de la categoría coincide con el taxHint de las facturas", () => {
    const conflicts: string[] = [];
    for (const { truth, line, meta } of truthLines) {
      if (!meta.productKey || !line.taxHint || (line.taxHint !== "exento" && line.taxHint !== "general")) continue;
      const product = products.get(meta.productKey);
      const category = product ? categories.get(product.categoryKey) : undefined;
      if (category?.taxCode !== line.taxHint) {
        conflicts.push(`${truth.id} ${meta.productKey}: factura ${line.taxHint}, catálogo ${category?.taxCode}`);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("cada categoría usada existe", () => {
    for (const product of SCENARIO_PRODUCTS) {
      expect(categories.has(product.categoryKey)).toBe(true);
    }
  });
});

describe("proveedores del escenario", () => {
  it("cada supplierKey de las verdades tiene proveedor y no hay proveedores sin verdad", () => {
    const truthSuppliers = new Set(truths.map((truth) => truth.supplierKey).filter((key): key is string => key !== null));
    expect([...truthSuppliers].filter((key) => !suppliers.has(key))).toEqual([]);
    expect(SCENARIO_SUPPLIERS.map((s) => s.key).filter((key) => !truthSuppliers.has(key))).toEqual([]);
  });

  it("el RIF guardado tiene los mismos dígitos que el de la verdad y formato J-XXXXXXXX-X", () => {
    for (const truth of truths) {
      if (!truth.supplierKey) continue;
      const supplier = suppliers.get(truth.supplierKey);
      const truthTax = truth.extraction.supplier.taxId;
      if (truthTax) {
        expect(supplier?.taxId).toMatch(/^J-\d{8}-\d$/);
        expect(normalizeTaxId(supplier?.taxId)).toBe(normalizeTaxId(truthTax));
      }
    }
    const taxIds = SCENARIO_SUPPLIERS.flatMap((s) => (s.taxId ? [normalizeTaxId(s.taxId)] : []));
    expect(new Set(taxIds).size).toBe(taxIds.length);
  });

  it("los vínculos apuntan a productos del catálogo, sin repetir producto por proveedor ni habitual", () => {
    const preferred = new Set<string>();
    for (const supplier of SCENARIO_SUPPLIERS) {
      const seen = new Set<string>();
      for (const link of supplier.links) {
        expect(products.get(link.productKey)?.inCatalog).toBe(true);
        expect(seen.has(link.productKey)).toBe(false);
        seen.add(link.productKey);
        if (link.isPreferred) {
          expect(preferred.has(link.productKey)).toBe(false);
          preferred.add(link.productKey);
        }
      }
    }
  });

  it("Chevere Depot tiene empaques registrados y otros sin registrar, con el tamaño de sus facturas", () => {
    const chevere = suppliers.get("chevere-depot");
    const withPack = chevere?.links.filter((link) => link.packUnit) ?? [];
    const withoutPack = chevere?.links.filter((link) => !link.packUnit) ?? [];
    expect(withPack.length).toBeGreaterThan(0);
    expect(withoutPack.length).toBeGreaterThan(0);
    for (const link of withPack) {
      const sizes = truthLines
        .filter((e) => e.truth.supplierKey === "chevere-depot" && e.meta.productKey === link.productKey)
        .map((e) => e.line.unitsPerPack);
      expect(sizes).toContain(link.packUnit?.unitsPerPack);
    }
  });

  it("El Samán está vinculado con el supplierSku SM-xxxxx de cada línea de sus facturas", () => {
    const saman = new Map((suppliers.get("sint-dist-el-saman")?.links ?? []).map((link) => [link.productKey, link.supplierSku]));
    const lines = truthLines.filter((e) => e.truth.supplierKey === "sint-dist-el-saman" && e.line.supplierSku);
    expect(lines.length).toBeGreaterThan(0);
    for (const { line, meta } of lines) {
      expect(saman.get(meta.productKey ?? "")).toBe(line.supplierSku);
    }
  });

  it("los productos de Los Andes en catálogo tienen products.barcode = EAN de sus líneas", () => {
    const lines = truthLines.filter((e) => e.truth.supplierKey === "sint-mayorista-los-andes" && e.line.barcode);
    expect(lines.length).toBeGreaterThan(0);
    for (const { line, meta } of lines) {
      const product = products.get(meta.productKey ?? "");
      if (product?.inCatalog) {
        expect(product.barcode).toBe(line.barcode);
      }
    }
  });

  it("la receta es de un producto del catálogo con el tamaño de bulto de sus facturas", () => {
    for (const recipe of SCENARIO_RECIPES) {
      expect(products.get(recipe.unitKey)?.inCatalog).toBe(true);
      const sizes = truthLines.filter((e) => e.meta.productKey === recipe.unitKey).map((e) => e.line.unitsPerPack);
      expect(sizes).toContain(recipe.unitsPerPack);
    }
  });
});

describe("plan de tasas y compras", () => {
  it("interpola linealmente y fija en los extremos", () => {
    const points = [
      { date: "2026-08-20", rate: 100 },
      { date: "2026-08-30", rate: 200 },
    ];
    expect(interpolateRate(points, "2026-08-01")).toBe(100);
    expect(interpolateRate(points, "2026-08-25")).toBe(150);
    expect(interpolateRate(points, "2026-09-30")).toBe(200);
  });

  it("las tasas sembradas son las impresas en facturas reales; la última es la del día (f01)", () => {
    const rates = plannedExchangeRates(truths);
    expect(rates.length).toBeGreaterThan(5);
    expect(rates[rates.length - 1]).toEqual({ date: "2026-10-12", rate: 875.65 });
  });

  it("da último costo a todo producto del catálogo salvo los de tamaño desconocido", () => {
    const sources = new Map(productCostSources(truths).map((source) => [source.productKey, source]));
    for (const product of inCatalogProducts()) {
      expect(sources.has(product.key)).toBe(!product.costUnknown);
    }
    // f07 (2026-08-26, tasa 787.52): Glup Cola 2L bulto x6 a 5048 Bs -> 841.33 Bs/u -> 1.07 REF.
    expect(sources.get("glup-cola-2l")).toMatchObject({ truthId: "f07", unitCostVes: 841.33, unitCostRef: 1.07 });
  });

  it("el costo REF es coherente (±40 %) con cada aparición del producto en el banco", () => {
    const sources = new Map(productCostSources(truths).map((source) => [source.productKey, source]));
    const real = plannedExchangeRates(truths);
    for (const { truth, line, meta } of truthLines) {
      const source = meta.productKey ? sources.get(meta.productKey) : undefined;
      if (!source || !truth.extraction.date) continue;
      const rate = truth.extraction.printedRate ?? interpolateRate(real, truth.extraction.date);
      const perUnitRef = line.lineTotal / (line.quantity * (line.unitsPerPack ?? 1)) / rate;
      expect(Math.abs(perUnitRef - source.unitCostRef) / source.unitCostRef).toBeLessThanOrEqual(0.4);
    }
  });

  it("las compras tienen número único y solo van a proveedores ya vinculados o al histórico", () => {
    const purchases = plannedPurchases(truths);
    const numbers = purchases.map((purchase) => purchase.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const purchase of purchases) {
      if (purchase.supplierKey) {
        const supplier = suppliers.get(purchase.supplierKey);
        expect(supplier?.purchasesFromHere).toBe(true);
        const linked = new Set(supplier?.links.map((link) => link.productKey));
        for (const line of purchase.lines) expect(linked.has(line.productKey)).toBe(true);
      }
      for (const line of purchase.lines) expect(Number.isInteger(line.quantity) && line.quantity > 0).toBe(true);
    }
    expect(plannedPurchases(truths)).toEqual(purchases);
  });
});

describe("assertScenarioEnv", () => {
  it("acepta el lab local", () => {
    expect(assertScenarioEnv(GOOD_ENV).dbUrl).toContain("127.0.0.1");
  });

  it("rechaza una base o API remotas", () => {
    expect(() =>
      assertScenarioEnv({ ...GOOD_ENV, STOCK_LAB_DB_URL: "postgresql://u:p@db.example.supabase.co:5432/postgres" }),
    ).toThrow();
    expect(() => assertScenarioEnv({ ...GOOD_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toThrow();
  });
});
