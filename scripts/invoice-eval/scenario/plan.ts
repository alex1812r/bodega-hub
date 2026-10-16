/**
 * Plan puro (sin base) del escenario SCN-10f: tasas y compras históricas
 * derivadas de las verdades del banco y del catálogo (`catalog.ts`).
 *
 * Último costo: por cada producto del catálogo, su PRIMERA aparición en el
 * banco (fecha, luego id; sin duplicados; la verdad sabe el precio aunque la
 * foto tape la línea) da el costo por
 * unidad suelta en Bs (`lineTotal ÷ (quantity × unitsPerPack)`) y se pasa a REF
 * con la tasa de esa fecha: la impresa en la factura o, si no trae, la
 * interpolada entre las impresas de la misma familia (reales / sintéticas),
 * fija en los extremos. Se compra a ese proveedor si el escenario ya lo tiene
 * vinculado (`purchasesFromHere`); si no, al proveedor histórico.
 */
import type { InvoiceTruth } from "../truth";

import {
  HISTORY_SUPPLIER,
  SCENARIO_CATEGORIES,
  SCENARIO_PRODUCTS,
  SCENARIO_SUPPLIERS,
  type ScenarioTaxCode,
} from "./catalog";

export type RatePoint = { date: string; rate: number };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** Tasas impresas (una por fecha, la primera que aparece) de las verdades de una familia. */
export function printedRatePoints(truths: readonly InvoiceTruth[], synthetic: boolean): RatePoint[] {
  const byDate = new Map<string, number>();
  for (const truth of [...truths].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))) {
    const { date, printedRate } = truth.extraction;
    if (truth.synthetic !== synthetic || !date || !printedRate || byDate.has(date)) {
      continue;
    }
    byDate.set(date, printedRate);
  }
  return [...byDate.entries()]
    .map(([date, rate]) => ({ date, rate }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Tasa de `date`: lineal entre los puntos vecinos, fija fuera del rango. */
export function interpolateRate(points: readonly RatePoint[], date: string): number {
  if (points.length === 0) {
    throw new Error("Sin tasas impresas para interpolar");
  }
  const day = dayNumber(date);
  if (day <= dayNumber(points[0].date)) {
    return points[0].rate;
  }
  const last = points[points.length - 1];
  if (day >= dayNumber(last.date)) {
    return last.rate;
  }
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i];
    if (day <= dayNumber(right.date)) {
      const left = points[i - 1];
      const t = (day - dayNumber(left.date)) / (dayNumber(right.date) - dayNumber(left.date));
      return round4(left.rate + (right.rate - left.rate) * t);
    }
  }
  return last.rate;
}

export type ProductCostSource = {
  productKey: string;
  truthId: string;
  supplierKey: string;
  date: string;
  rate: number;
  rateSource: "printed" | "interpolated";
  /** Unidades sueltas de la línea. */
  units: number;
  unitCostVes: number;
  unitCostRef: number;
};

/** Primera aparición utilizable de cada producto del catálogo con costo conocido. */
export function productCostSources(truths: readonly InvoiceTruth[]): ProductCostSource[] {
  const real = printedRatePoints(truths, false);
  const synthetic = printedRatePoints(truths, true);
  const wanted = new Map(
    SCENARIO_PRODUCTS.filter((product) => product.inCatalog && !product.costUnknown).map((p) => [p.key, p]),
  );
  const ordered = [...truths]
    .filter((truth) => truth.duplicateOf === null && truth.supplierKey && truth.extraction.date)
    .sort(
      (a, b) =>
        (a.extraction.date ?? "").localeCompare(b.extraction.date ?? "") ||
        a.id.localeCompare(b.id, "en", { numeric: true }),
    );

  const sources = new Map<string, ProductCostSource>();
  for (const truth of ordered) {
    const date = truth.extraction.date as string;
    truth.extraction.lines.forEach((line, index) => {
      const meta = truth.lines[index];
      const key = meta.productKey;
      if (!key || !wanted.has(key) || sources.has(key)) {
        return;
      }
      const perPack = line.unitsPerPack ?? 1;
      const units = line.quantity * perPack;
      if (!Number.isInteger(units) || units <= 0 || !(line.lineTotal > 0)) {
        return;
      }
      const printed = truth.extraction.printedRate;
      const rate = printed ?? interpolateRate(truth.synthetic ? synthetic : real, date);
      const unitCostVes = line.lineTotal / units;
      sources.set(key, {
        productKey: key,
        truthId: truth.id,
        supplierKey: truth.supplierKey as string,
        date,
        rate,
        rateSource: printed ? "printed" : "interpolated",
        units,
        unitCostVes: round2(unitCostVes),
        unitCostRef: round2(unitCostVes / rate),
      });
    });
  }
  return [...sources.values()].sort((a, b) => a.productKey.localeCompare(b.productKey));
}

export type PlannedPurchaseLine = {
  productKey: string;
  quantity: number;
  unitCostVes: number;
  unitCostRef: number;
  taxCode: ScenarioTaxCode;
  taxPct: number;
};

export type PlannedPurchase = {
  number: string;
  /** supplierKey del banco o null = proveedor histórico. */
  supplierKey: string | null;
  supplierName: string;
  date: string;
  rate: number;
  lines: PlannedPurchaseLine[];
};

/** Una compra recibida por (proveedor, fecha, tasa), con número fijo `EVF-C-<fecha>-<n>`. */
export function plannedPurchases(truths: readonly InvoiceTruth[]): PlannedPurchase[] {
  const products = new Map(SCENARIO_PRODUCTS.map((product) => [product.key, product]));
  const categories = new Map(SCENARIO_CATEGORIES.map((category) => [category.key, category]));
  const suppliers = new Map(SCENARIO_SUPPLIERS.map((supplier) => [supplier.key, supplier]));

  const groups = new Map<string, PlannedPurchase>();
  for (const source of productCostSources(truths)) {
    const supplier = suppliers.get(source.supplierKey);
    const supplierKey = supplier?.purchasesFromHere ? supplier.key : null;
    const groupKey = `${source.date}|${supplierKey ?? ""}|${source.rate}`;
    let purchase = groups.get(groupKey);
    if (!purchase) {
      purchase = {
        number: "",
        supplierKey,
        supplierName: supplier?.purchasesFromHere ? supplier.name : HISTORY_SUPPLIER.name,
        date: source.date,
        rate: source.rate,
        lines: [],
      };
      groups.set(groupKey, purchase);
    }
    const product = products.get(source.productKey);
    const category = product ? categories.get(product.categoryKey) : undefined;
    if (!category) {
      throw new Error(`Producto sin categoría en el catálogo: ${source.productKey}`);
    }
    purchase.lines.push({
      productKey: source.productKey,
      quantity: source.units,
      unitCostVes: source.unitCostVes,
      unitCostRef: source.unitCostRef,
      taxCode: category.taxCode,
      taxPct: category.pct,
    });
  }

  const list = [...groups.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.supplierKey ?? "~").localeCompare(b.supplierKey ?? "~"),
  );
  const perDate = new Map<string, number>();
  for (const purchase of list) {
    const n = (perDate.get(purchase.date) ?? 0) + 1;
    perDate.set(purchase.date, n);
    purchase.number = `EVF-C-${purchase.date.replace(/-/g, "")}-${n}`;
  }
  return list;
}

/** Tasas a sembrar en exchange_rates: las impresas en las facturas REALES (la última es la del día). */
export function plannedExchangeRates(truths: readonly InvoiceTruth[]): RatePoint[] {
  return printedRatePoints(truths, false);
}
