/**
 * SCN-08b · Ayudas PURAS de presentación de la revisión del escaneo: textos,
 * colores por estado, formato de importes y precarga de "Nuevo producto".
 * La semántica (estados, totales, bloqueos) es de `../reviewModel.ts`.
 */
import { PRICE_DEVIATION_LIMIT } from "@/modules/invoice-scan/server/match/money";
import { normalizeInvoiceNumber } from "@/modules/invoice-scan/server/match/text";
import type { ProductFormInitialValues } from "@/modules/products/product-details/components/ProductFormModal";
import type { TaxRate } from "@/shared/hooks/useTaxRates";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";

import {
  getLineCosts,
  getLineNeeds,
  getUnitConversion,
  linePackWord,
  MAX_REVIEW_UNITS_PER_PACK,
  needsExplicitChoice,
  PRICE_CHOICE_QUESTION,
  type EntryModeOutcome,
  type InvoiceReviewLine,
  type InvoiceReviewLineStatus,
  type InvoiceReviewState,
  type InvoiceReviewTotals,
} from "../reviewModel";

/**
 * REP3-03a (B6): criterio con el que `findDuplicateScan` marcó la factura, según lo
 * leído: con número, el mismo (o uno a un carácter, con la misma fecha y total); sin
 * número, proveedor y total, y la fecha si se leyó.
 */
export function duplicateCriterionLabel(extraction: InvoiceReviewState["extraction"]): string {
  if (normalizeInvoiceNumber(extraction.number)) {
    return "mismo proveedor y número igual o casi igual";
  }
  return extraction.date?.trim() ? "mismo proveedor, fecha y total" : "mismo proveedor y total";
}

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
    // D24-d: el SKU distingue candidatos de igual nombre.
    detail: `${candidate.sku ? `SKU ${candidate.sku} · ` : ""}${candidate.reason} · ${formatScore(candidate.score)}`,
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
  // REP6-04 (B-p6-1): sin preselección (D33-a), la línea dice qué opción falta elegir.
  const choice = needsExplicitChoice(line) ? [`Elige cómo viene: Por unidad o Por ${linePackWord(line)}.`] : [];
  return getLineNeeds(line).flatMap((need) => {
    if (need === "unitsPerPack" && line.unitsPerPack !== undefined && line.unitsPerPack > MAX_REVIEW_UNITS_PER_PACK) {
      return [`Máximo ${MAX_REVIEW_UNITS_PER_PACK.toLocaleString("es-VE")} unidades por empaque.`];
    }
    if (need === "unitsPerPack" && line.unitsPerPack !== undefined) {
      return ["Debe ser un entero mayor que 0."];
    }
    if (need === "unitsPerPack") {
      return [`Indica cuántas unidades trae cada ${line.packLabel.trim().toLowerCase() || "empaque"}.`];
    }
    if (need === "quantity") {
      // Fraccionaria (0,50 cajas): con conversión posible la fila ofrece el botón; si no, dice qué editar.
      const conversion = getUnitConversion(line);
      return conversion.ok ? [] : [conversion.reason];
    }
    if (need === "unitPrice") {
      return ["Revisa el costo: no puede ser negativo ni estar vacío."];
    }
    return [];
  }).concat(choice);
}

/**
 * REP6-04 (B-p6-2): el aviso de precio del servidor pregunta por «caja»; se muestra con la
 * palabra del empaque de la línea, la misma de la opción «Por <empaque>». El texto guardado
 * no cambia (`isExplicitChoiceIssue` lo sigue reconociendo).
 */
export function lineIssueText(line: InvoiceReviewLine, issue: string): string {
  return issue.startsWith(PRICE_CHOICE_QUESTION)
    ? `¿Precio por ${linePackWord(line)} o por unidad?${issue.slice(PRICE_CHOICE_QUESTION.length)}`
    : issue;
}

function formatCount(value: number): string {
  return value.toLocaleString("es-VE", { maximumFractionDigits: 3 });
}

/** Dos decimales como el aviso de precio del servidor («0,10 REF»). */
function formatRefAmount(value: number): string {
  return value.toLocaleString("es-VE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** «caja» → «cajas» (una palabra); una etiqueta compuesta («caja x6») se deja tal cual. */
function packNoun(word: string, count: number): string {
  if (count === 1 || !/^[a-záéíóúñ]+$/.test(word)) {
    return word;
  }
  return /[aeiouáéíóú]$/.test(word) ? `${word}s` : `${word}es`;
}

/** B-p7-3: texto (no solo el ámbar) de la opción que deja el costo desviado como el aviso 6.18. */
export const ENTRY_MODE_DEVIATION_TEXT = `Se aparta más del ${Math.round(PRICE_DEVIATION_LIMIT * 100)} % del último costo`;

/**
 * B-p7-3: lo que deja la opción, para mostrarlo en ella antes de elegir: «6 cajas = 36 u ·
 * 0,10 REF/u (último 0,59)» / «6 u · 0,59 REF/u». El último costo se cita en la desviada.
 */
export function entryModeOutcomeText(line: InvoiceReviewLine, outcome: EntryModeOutcome): string {
  const word = linePackWord(line);
  const packs = `${formatCount(outcome.quantity)} ${packNoun(word, outcome.quantity)}`;
  let text = `${formatCount(outcome.quantity)} u`;
  if (outcome.entryMode === "pack") {
    text =
      outcome.units === undefined
        ? `${packs} · indica las unidades por ${word}`
        : `${packs} = ${formatCount(outcome.units)} u`;
  }
  const cost = outcome.unitCost;
  if (cost) {
    text += ` · ${cost.currency === "REF" ? `${formatRefAmount(cost.amount)} REF` : formatVesBs(cost.amount)}/u`;
  }
  if (outcome.deviates && outcome.lastUnitCostRef !== undefined) {
    text += ` (último ${formatRefAmount(outcome.lastUnitCostRef)})`;
  }
  return text;
}

export type DisplayedTotals = {
  read?: number;
  /** Total que se va a registrar (base + IVA de las alícuotas elegidas). */
  registered: number;
  /** Cifra leída − su homóloga a registrar (total, base o IVA, D29); solo con descuadre. */
  difference?: number;
  ok: boolean;
};

/**
 * Pie "Total a registrar X · Leído Y" (SCN-UI-Q1): siempre el total que se va a
 * registrar, nunca "el calculado más cercano". El descuadre lo decide el modelo.
 */
export function getDisplayedTotals(totals: InvoiceReviewTotals): DisplayedTotals {
  const { read, registered, mismatch, difference } = totals;
  return {
    ...(read !== undefined ? { read } : {}),
    registered,
    ok: !mismatch,
    ...(difference !== undefined ? { difference } : {}),
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
