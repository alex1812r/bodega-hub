/**
 * SCN-08b · Ayudas PURAS de presentación de la revisión del escaneo: textos,
 * colores por estado, formato de importes y precarga de "Nuevo producto".
 * La semántica (estados, totales, bloqueos) es de `../reviewModel.ts`.
 */
import type { ProductFormInitialValues } from "@/modules/products/product-details/components/ProductFormModal";
import type { TaxRate } from "@/shared/hooks/useTaxRates";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";

import {
  getLineCosts,
  getLineNeeds,
  type InvoiceReviewLine,
  type InvoiceReviewLineStatus,
  type InvoiceReviewState,
  type InvoiceReviewTotals,
} from "../reviewModel";

/** Por debajo de esta confianza global de la lectura se sugiere repetir la foto. */
export const LOW_EXTRACTION_CONFIDENCE = 0.6;

export type ReviewStatusTone = "danger" | "warning" | "success" | "default";

export const REVIEW_STATUS_META: Record<
  InvoiceReviewLineStatus,
  { label: string; tone: ReviewStatusTone; borderClassName: string }
> = {
  pending_unmatched: {
    label: "Sin emparejar",
    tone: "danger",
    borderClassName: "border-l-red-500 dark:border-l-red-400",
  },
  pending_doubtful: {
    label: "Dudosa",
    tone: "warning",
    borderClassName: "border-l-amber-500 dark:border-l-amber-400",
  },
  resolved: {
    label: "Resuelta",
    tone: "success",
    borderClassName: "border-l-emerald-500 dark:border-l-emerald-400",
  },
  confirmed_by_match: {
    label: "Confirmada",
    tone: "success",
    borderClassName: "border-l-emerald-500 dark:border-l-emerald-400",
  },
  discarded: {
    label: "Descartada",
    tone: "default",
    borderClassName: "border-l-slate-300 dark:border-l-slate-600",
  },
};

/** Importe en la moneda de la factura: Bs, o REF (= USD) si es la anomalía de dólares. */
export function formatInvoiceMoney(state: Pick<InvoiceReviewState, "usd">, value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return state.usd.anomaly ? formatRefUsd(value) : formatVesBs(value);
}

export type ChoiceChip = { productId: string; name: string; detail: string };

/**
 * Chips de elección de una línea pendiente: sus candidatos (≤ 3) con motivo y
 * score y, si el producto propuesto no está entre ellos (confirmada que pasó a
 * dudosa, factura en dólares), también él: Enter lo aceptaría.
 */
export function getChoiceChips(line: InvoiceReviewLine): ChoiceChip[] {
  const chips = line.candidates.map((candidate) => ({
    detail: `${candidate.reason} · ${formatScore(candidate.score)}`,
    name: candidate.name,
    productId: candidate.productId,
  }));
  if (line.productId && !line.candidates.some((candidate) => candidate.productId === line.productId)) {
    chips.unshift({
      detail: "Propuesto por el emparejamiento",
      name: line.productName || "Producto propuesto",
      productId: line.productId,
    });
  }
  return chips;
}

/** Score 0..1 como "0,72". */
export function formatScore(score: number): string {
  return score.toLocaleString("es-VE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** Tasa Bs/REF sin prefijo: "875,65". */
export function formatRate(rate: number): string {
  return rate.toLocaleString("es-VE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function formatConfidencePct(confidence: number): string {
  return `${Math.round(confidence * 100)} %`;
}

const TAX_RATE_LABELS: Record<string, string> = {
  exento: "Exento",
  general: "General",
  reducida: "Reducida",
};

/** Catálogo para `TaxRateChips` desde el `código → %` del contexto de la revisión. */
export function buildReviewTaxRates(taxRates: Record<string, number>): TaxRate[] {
  return Object.entries(taxRates)
    .sort(([, left], [, right]) => left - right)
    .map(([code, pct], position) => ({
      code,
      id: `invoice-review-tax-${code}`,
      isActive: true,
      isDefault: code === "general",
      isGlobal: true,
      label: TAX_RATE_LABELS[code] ?? code,
      pct,
      sortOrder: (position + 1) * 10,
    }));
}

/** "12 líneas confirmadas · ver" / "1 línea confirmada · ocultar". */
export function confirmedToggleLabel(count: number, expanded: boolean): string {
  const noun = count === 1 ? "1 línea confirmada" : `${count} líneas confirmadas`;
  return `${noun} · ${expanded ? "ocultar" : "ver"}`;
}

/** Qué le falta a la línea para quedar resuelta, en español (sin contar el producto). */
export function lineNeedMessages(line: InvoiceReviewLine): string[] {
  return getLineNeeds(line).flatMap((need) => {
    if (need === "unitsPerPack") {
      return [`Indica cuántas unidades trae cada ${line.packLabel.trim().toLowerCase() || "empaque"}.`];
    }
    if (need === "quantity") {
      return ["La cantidad debe ser un número entero mayor que 0."];
    }
    if (need === "unitPrice") {
      return ["Revisa el costo: no puede ser negativo ni estar vacío."];
    }
    return [];
  });
}

export type DisplayedTotals = {
  read?: number;
  /** El calculado que se compara con el leído: sin IVA o con IVA, el más cercano. */
  computed: number;
  /** Leído − calculado; solo con descuadre y total leído. */
  difference?: number;
  ok: boolean;
};

/**
 * Pie "Total leído X · Total calculado Y". El descuadre lo decide el modelo
 * (`totals.mismatch`); aquí solo se elige qué calculado mostrar junto al leído.
 */
export function getDisplayedTotals(totals: InvoiceReviewTotals): DisplayedTotals {
  const { read, computed, computedWithTax, mismatch } = totals;
  if (read === undefined) {
    return { computed: computedWithTax, ok: !mismatch };
  }
  const shown = Math.abs(read - computed) < Math.abs(read - computedWithTax) ? computed : computedWithTax;
  return {
    read,
    computed: shown,
    ok: !mismatch,
    ...(mismatch ? { difference: roundMoney(read - shown) } : {}),
  };
}

/**
 * Precarga del alta rápida de producto desde una línea sin emparejar: nombre
 * leído y costo REF por unidad CON IVA (el "Costo REF" del producto lleva IVA,
 * `buildPurchaseCatalog` lo lee así), con la alícuota elegida en la línea. La
 * alícuota del producto sale de su categoría: la de la línea se conserva en la
 * compra al elegir el producto creado.
 */
export function buildNewProductInitialValues(
  state: InvoiceReviewState,
  line: InvoiceReviewLine,
): ProductFormInitialValues {
  const name = line.description.trim() || line.rawText.trim();
  const values: ProductFormInitialValues = name ? { name } : {};
  const ref = getLineCosts(state, line).ref;
  if (ref === undefined || !(ref > 0)) {
    return values;
  }
  const perUnit =
    line.entryMode === "pack" && line.unitsPerPack !== undefined && line.unitsPerPack > 0
      ? ref / line.unitsPerPack
      : ref;
  const pct = state.taxRates[line.taxRateCode] ?? 0;
  return { ...values, currentCostRef: roundMoney(perUnit * (1 + pct / 100)) };
}
