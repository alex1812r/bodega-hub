/**
 * SCN-08a · Salida de la revisión del escaneo: líneas listas para el formulario
 * de nueva compra y el bloque del escaneo para el body de `POST /api/purchases`
 * (`invoiceScanBodyFields` en `confirmScan.server.ts`; formato D10).
 *
 * Costos: el precio de la factura es la BASE SIN IVA por unidad de entrada, igual
 * que el costo de línea del formulario (`getDraftLineTotals` suma el IVA encima).
 *
 * Moneda de captura (SCN-UI-C1, decisión del supervisor):
 * - `ves` siempre, con los Bs exactos de la factura. La tasa elegida en la revisión (la
 *   del día, la impresa o una manual) es la tasa de la compra: REF = Bs ÷ tasa elegida;
 * - `ref` solo en una factura en dólares aceptada, con el precio tal cual (USD = REF) y
 *   la tasa del día.
 */
import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseCostCurrency,
  type PurchaseDraftItem,
} from "@bodega/core/purchases";

import type {
  InvoiceExtraction,
  InvoiceExtractionLine,
} from "@/modules/invoice-scan/contracts";
import { roundMoney } from "@/shared/utils/currency";

import {
  DEFAULT_PACK_LABEL,
  canLoad,
  getEffectiveRate,
  isUsdAccepted,
  type InvoiceReviewLine,
  type InvoiceReviewState,
} from "./reviewModel";

/** Línea para el formulario de compra. Nace bloqueada (COM-12): el usuario ya la revisó. */
export type InvoiceReviewDraftLine = {
  /** Índice de la línea en `extraction.lines`. */
  lineIndex: number;
  lock: true;
  productId: string;
  productName?: string;
  /** Alícuota elegida en la revisión (va a `PurchaseTaxState.choices[item.id]`). */
  taxRateCode: string;
  /** Solo presente si la línea es un empaque con receta a desarmar (COM-14). */
  disassembleOnReceive?: true;
  /** Borrador de core con `taxRate` = porcentaje de `taxRateCode`. */
  item: PurchaseDraftItem;
};

/** Línea aprendida al confirmar (`invoiceScanLineInputSchema`). */
export type InvoiceReviewScanLine = {
  lineIndex: number;
  productId: string;
  packLabel?: string;
  unitsPerPack?: number;
};

/** Campos del escaneo para el body de `POST /api/purchases`. */
export type InvoiceReviewScanBody = {
  invoiceScanId: string;
  invoiceScanLines: InvoiceReviewScanLine[];
  /** Extracción corregida por el usuario (D10): pasa `invoiceExtractionSchema`. */
  invoiceScanExtraction: InvoiceExtraction;
};

export type InvoiceReviewDraft = {
  supplier: { contactId: string; name: string };
  purchaseNumber?: string;
  /** ISO `YYYY-MM-DD` leído o corregido. */
  date?: string;
  costCurrency: PurchaseCostCurrency;
  /**
   * Tasa con la que se armaron los espejos Bs/REF de las líneas: la elegida; en una
   * factura USD aceptada, la del sistema. `undefined` solo en factura USD aceptada sin tasa.
   */
  rateVes?: number;
  /**
   * Tasa elegida en la revisión: la de la compra escaneada (`refRateVes`) y con la que
   * los Bs de la factura pasan a REF. Ausente en una factura en dólares aceptada: sus
   * precios ya son REF y la compra va a la tasa del día.
   */
  invoiceRateVes?: number;
  lines: InvoiceReviewDraftLine[];
  body: InvoiceReviewScanBody;
};

export type BuildInvoiceReviewDraftOptions = {
  /** Id de cada `item` del formulario; por defecto `invoice-scan-<scanId>-<lineIndex>`. */
  nextId?: (lineIndex: number) => string;
};

/** Pista de alícuota para la extracción corregida (misma regla que `taxRateKind`). */
export function taxHintFromCode(
  code: string,
  taxRates: Record<string, number>,
): NonNullable<InvoiceExtractionLine["taxHint"]> {
  if (code === "exento" || code === "reducida" || code === "general") {
    return code;
  }
  const pct = taxRates[code];
  if (pct === 0) {
    return "exento";
  }
  if (pct === 8) {
    return "reducida";
  }
  if (pct === 16) {
    return "general";
  }
  return "unknown";
}

/** Moneda de captura de la compra que sale de la revisión (ver cabecera del archivo). */
export function getDraftCostCurrency(state: InvoiceReviewState): PurchaseCostCurrency {
  return isUsdAccepted(state) ? "ref" : "ves";
}

function packLabelOf(line: InvoiceReviewLine): string {
  return line.packLabel.trim() || DEFAULT_PACK_LABEL;
}

function buildItem(
  state: InvoiceReviewState,
  line: InvoiceReviewLine & { productId: string },
  input: { costCurrency: PurchaseCostCurrency; id: string; mirrorRate: number },
): PurchaseDraftItem {
  const price = roundMoney(line.unitPrice);
  // Bs de la factura, o el precio en dólares de una factura USD aceptada (USD = REF).
  const cost = input.costCurrency === "ves" ? { ves: price } : { ref: price };
  const base = {
    costCurrency: input.costCurrency,
    id: input.id,
    productId: line.productId,
    rateVes: input.mirrorRate,
    taxRate: state.taxRates[line.taxRateCode] ?? 0,
  };

  if (line.entryMode === "pack" && line.unitsPerPack !== undefined) {
    return createPackDraftItem({
      ...base,
      ...(cost.ves !== undefined ? { packCostVes: cost.ves } : { packCostRef: cost.ref }),
      packCount: line.quantity,
      packLabel: packLabelOf(line),
      ...(line.packUnitId ? { packUnitId: line.packUnitId } : {}),
      unitsPerPack: line.unitsPerPack,
    });
  }
  return createUnitDraftItem({
    ...base,
    quantity: line.quantity,
    ...(cost.ves !== undefined ? { unitCostVes: cost.ves } : { unitCostRef: cost.ref }),
  });
}

/**
 * Extracción corregida (D10): cabecera (número, fecha), cantidades, precios,
 * unidades por empaque y alícuota → `taxHint`. Conserva TODAS las líneas (también
 * las descartadas) para que `lineIndex` siga apuntando a la misma; el total de
 * línea y el proveedor quedan como se leyeron (lo impreso es la verdad del documento).
 */
export function buildCorrectedExtraction(state: InvoiceReviewState): InvoiceExtraction {
  const { extraction, header } = state;
  const corrected: InvoiceExtraction = {
    ...extraction,
    lines: extraction.lines.map((read, index) => {
      const line = state.lines[index];
      const fixed: InvoiceExtractionLine = {
        ...read,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxHint: taxHintFromCode(line.taxRateCode, state.taxRates),
      };
      const unitsPerPack = line.entryMode === "pack" ? line.unitsPerPack : undefined;
      if (unitsPerPack !== undefined && Number.isInteger(unitsPerPack) && unitsPerPack > 0) {
        fixed.unitsPerPack = unitsPerPack;
      } else {
        delete fixed.unitsPerPack;
      }
      return fixed;
    }),
  };
  if (header.number) {
    corrected.number = header.number;
  } else {
    delete corrected.number;
  }
  if (header.date) {
    corrected.date = header.date;
  } else {
    delete corrected.date;
  }
  return corrected;
}

/**
 * Salida de la revisión. `null` mientras `canLoad(state)` sea falso (líneas
 * pendientes, sin proveedor, sin tasa o dólares sin aceptar). Las líneas
 * descartadas no van al formulario ni a `invoiceScanLines`.
 */
export function buildInvoiceReviewDraft(
  state: InvoiceReviewState,
  options: BuildInvoiceReviewDraftOptions = {},
): InvoiceReviewDraft | null {
  const contactId = state.header.supplier.contactId;
  if (!canLoad(state) || !contactId) {
    return null;
  }
  const nextId = options.nextId ?? ((lineIndex: number) => `invoice-scan-${state.scanId}-${lineIndex}`);
  const costCurrency = getDraftCostCurrency(state);
  const chosenRate = getEffectiveRate(state);
  const mirrorRate = isUsdAccepted(state) ? (state.rate.system ?? chosenRate) : chosenRate;
  const kept = state.lines.filter(
    (line): line is InvoiceReviewLine & { productId: string } => !line.discarded && line.productId !== undefined,
  );

  const lines = kept.map((line): InvoiceReviewDraftLine => ({
    lineIndex: line.index,
    lock: true,
    productId: line.productId,
    ...(line.productName ? { productName: line.productName } : {}),
    taxRateCode: line.taxRateCode,
    ...(line.disassembleOnReceive ? { disassembleOnReceive: true as const } : {}),
    item: buildItem(state, line, {
      costCurrency,
      id: nextId(line.index),
      mirrorRate: mirrorRate ?? 0,
    }),
  }));

  const invoiceScanLines = kept.map((line): InvoiceReviewScanLine => {
    const pack = line.entryMode === "pack" && line.unitsPerPack !== undefined;
    return {
      lineIndex: line.index,
      productId: line.productId,
      ...(pack ? { packLabel: packLabelOf(line), unitsPerPack: line.unitsPerPack } : {}),
    };
  });

  return {
    supplier: { contactId, name: state.header.supplier.name },
    ...(state.header.number ? { purchaseNumber: state.header.number } : {}),
    ...(state.header.date ? { date: state.header.date } : {}),
    costCurrency,
    ...(mirrorRate !== undefined ? { rateVes: mirrorRate } : {}),
    ...(chosenRate !== undefined && !isUsdAccepted(state) ? { invoiceRateVes: chosenRate } : {}),
    lines,
    body: {
      invoiceScanId: state.scanId,
      invoiceScanLines,
      invoiceScanExtraction: buildCorrectedExtraction(state),
    },
  };
}
