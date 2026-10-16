/**
 * SCN-08c · La factura revisada dentro del formulario de compra.
 *
 * - `applyInvoiceReviewDraft`: pone las líneas de la revisión en las líneas del
 *   formulario, bloqueadas con el mecanismo de COM-12 (`lockPurchaseLines` y las
 *   mismas fotos de revisión que «Bloquear»), con su alícuota y su «Desarmar al recibir».
 * - `LoadedInvoiceScan`: lo que el formulario recuerda del escaneo cargado (también en el
 *   borrador local) para enviarlo con la compra.
 * - `buildInvoiceScanSubmission`: el bloque del escaneo para `POST /api/purchases`
 *   reconstruido desde las líneas VIGENTES del formulario (D10: la extracción lleva la
 *   cantidad y el precio finales, en la moneda de la factura).
 */
import type { InvoiceExtraction, InvoiceExtractionLine } from "@/modules/invoice-scan/contracts";
import { roundMoney } from "@/shared/utils/currency";

import type { PurchaseLinesSnapshot } from "../hooks/usePurchaseLines";
import type { PurchaseProductResolutions } from "../services/resolvePurchaseProducts";
import type { PurchaseCostCurrency, PurchaseDraftItem, PurchaseLineCatalogMeta } from "../types";
import { switchCostCurrency, syncLineCostFields } from "../utils/normalizePurchaseLine";
import { lockPurchaseLines } from "../utils/purchaseLineLocks";
import {
  markPurchaseLinesReviewed,
  settlePurchaseLines,
  switchPurchaseReviewCostCurrency,
} from "../utils/purchaseLineReview";
import {
  taxHintFromCode,
  type InvoiceReviewDraft,
  type InvoiceReviewScanBody,
  type InvoiceReviewScanLine,
} from "./reviewDraft";

/** Escaneo cargado en el formulario. */
export type LoadedInvoiceScan = {
  scanId: string;
  /** `item.id` de cada línea del formulario que salió de la factura → índice en `extraction.lines`. */
  lineIndexByItemId: Record<string, number>;
  /** Extracción corregida en la revisión (D10). */
  extraction: InvoiceExtraction;
  /** Tasa elegida en la revisión; ausente = precios de la factura en REF (USD aceptado). */
  invoiceRateVes?: number;
};

export type AppliedInvoiceReviewDraft = {
  costCurrency: PurchaseCostCurrency;
  lineMeta: Map<string, PurchaseLineCatalogMeta>;
  lines: PurchaseLinesSnapshot;
  loaded: LoadedInvoiceScan;
  /** Productos de la revisión que ya no existen o están inactivos (no entran). */
  notices: string[];
};

export type ApplyInvoiceReviewDraftOptions = {
  /** Las líneas del formulario antes de cargar. */
  current: PurchaseLinesSnapshot;
  /** Moneda de captura de esas líneas. */
  currentCurrency: PurchaseCostCurrency;
  /** Bloquea también las líneas que ya había (preferencia «Bloquear al agregar»). */
  lockExisting: boolean;
  /** Id nuevo para cada línea (dos cargas del mismo escaneo no repiten ids). */
  nextId: () => string;
  /** Estado actual de los productos para el proveedor de la factura. */
  products: PurchaseProductResolutions;
  /** Tasa con la que el formulario calcula los espejos Bs/REF. */
  rateVes: number;
  /** `true`: las líneas de la factura sustituyen a las que había. */
  replace: boolean;
};

function describeRemoved(names: string[]) {
  const list = names.join(", ");

  return names.length === 1
    ? `Se quitó 1 producto de la factura que ya no existe o está inactivo: ${list}.`
    : `Se quitaron ${names.length} productos de la factura que ya no existen o están inactivos: ${list}.`;
}

/**
 * Líneas del formulario tras cargar la factura: las de la factura primero (la más
 * reciente arriba, como al agregar), con costos sincronizados a la tasa del formulario
 * dejando fijo el monto en la moneda de la revisión. La compra entera pasa a esa moneda.
 */
export function applyInvoiceReviewDraft(
  draft: InvoiceReviewDraft,
  options: ApplyInvoiceReviewDraftOptions,
): AppliedInvoiceReviewDraft {
  const { costCurrency } = draft;
  const lineMeta = new Map<string, PurchaseLineCatalogMeta>();
  const removed: string[] = [];
  const lineIndexByItemId: Record<string, number> = {};
  const choices: Record<string, string> = {};
  const disassemble: Record<string, boolean> = {};
  const added: PurchaseDraftItem[] = [];

  for (const line of draft.lines) {
    const resolution = options.products.get(line.productId);

    if (resolution?.status !== "active") {
      removed.push(resolution?.name ?? line.productName ?? "Producto sin nombre");
      continue;
    }

    const { name, packUnits, sku, taxRate } = resolution.product;
    const item = syncLineCostFields({ ...line.item, id: options.nextId() }, options.rateVes);

    lineMeta.set(line.productId, { name, packUnits, sku, taxRate });
    lineIndexByItemId[item.id] = line.lineIndex;
    choices[item.id] = line.taxRateCode;
    if (line.disassembleOnReceive) {
      disassemble[item.id] = true;
    }
    added.push(item);
  }

  const kept = options.replace ? null : options.current;
  const switchExisting = kept !== null && options.currentCurrency !== costCurrency;
  const existing = kept
    ? kept.items.map((item) =>
        switchExisting ? switchCostCurrency(item, costCurrency, options.rateVes) : item,
      )
    : [];
  const taxState = {
    choices: { ...(kept?.taxState.choices ?? {}), ...choices },
    exempt: kept?.taxState.exempt ?? false,
  };
  const baseReview = kept
    ? switchExisting
      ? switchPurchaseReviewCostCurrency(kept.review, costCurrency, options.rateVes)
      : kept.review
    : { baselines: {}, reviewed: {} };
  const toLock = options.lockExisting ? [...added, ...existing] : added;
  const lockedBefore = new Set(Object.keys(kept?.locks.locked ?? {}));
  const newlyLocked = toLock.filter((item) => !lockedBefore.has(item.id));
  const mergedDisassemble = { ...(kept?.disassemble ?? {}), ...disassemble };

  return {
    costCurrency,
    lineMeta,
    lines: {
      ...(Object.keys(mergedDisassemble).length > 0 ? { disassemble: mergedDisassemble } : {}),
      items: [...added, ...existing],
      locks: lockPurchaseLines(
        kept?.locks ?? { locked: {} },
        toLock.map((item) => item.id),
      ),
      // Como «Bloquear» (COM-12): lo bloqueado queda asentado y revisado.
      review: markPurchaseLinesReviewed(
        settlePurchaseLines(baseReview, newlyLocked, taxState),
        newlyLocked,
        taxState,
      ),
      taxState,
    },
    loaded: {
      extraction: draft.body.invoiceScanExtraction,
      ...(draft.invoiceRateVes !== undefined ? { invoiceRateVes: draft.invoiceRateVes } : {}),
      lineIndexByItemId,
      scanId: draft.body.invoiceScanId,
    },
    notices: removed.length > 0 ? [describeRemoved(removed)] : [],
  };
}

/** `2026-10-14` → `14/10/2026`; otro formato se muestra tal cual. */
function formatInvoiceDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

/**
 * Número y fecha de la factura para las notas de la compra («Nro. de factura,
 * condiciones...»): la compra no tiene otro campo para ellos y su número interno no se
 * toca. `null` si la factura no trae ninguno.
 */
export function describeInvoiceForNotes(draft: Pick<InvoiceReviewDraft, "date" | "purchaseNumber">) {
  const number = draft.purchaseNumber?.trim();
  const date = draft.date ? formatInvoiceDate(draft.date) : undefined;

  if (number && date) {
    return `Factura ${number} del ${date}`;
  }
  if (number) {
    return `Factura ${number}`;
  }
  return date ? `Factura del ${date}` : null;
}

/** El escaneo sin las líneas que ya no están en el formulario. */
export function pruneLoadedInvoiceScan(
  loaded: LoadedInvoiceScan,
  itemIds: Iterable<string>,
): LoadedInvoiceScan {
  const kept = new Set(itemIds);

  return {
    ...loaded,
    lineIndexByItemId: Object.fromEntries(
      Object.entries(loaded.lineIndexByItemId).filter(([itemId]) => kept.has(itemId)),
    ),
  };
}

/** Línea del formulario que se envía: borrador de core y alícuota resuelta. */
export type InvoiceScanSubmissionLine = {
  item: PurchaseDraftItem;
  tax: { code: string | null };
};

/** Precio unitario (por unidad de entrada) en la moneda de la factura. */
function invoicePrice(
  item: PurchaseDraftItem,
  loaded: LoadedInvoiceScan,
  costCurrency: PurchaseCostCurrency,
) {
  const pack = item.entryMode === "pack";
  const ves = pack ? item.packCostVes : item.unitCostVes;
  const ref = pack ? item.packCostRef : item.unitCostRef;

  if (loaded.invoiceRateVes === undefined) {
    return roundMoney(ref);
  }

  // Bs tecleados: son los de la factura. REF: se devuelven a Bs con la tasa elegida.
  return costCurrency === "ves" ? roundMoney(ves) : roundMoney(ref * loaded.invoiceRateVes);
}

function validUnitsPerPack(item: PurchaseDraftItem) {
  return item.entryMode === "pack" &&
    Number.isInteger(item.unitsPerPack) &&
    item.unitsPerPack > 0 &&
    item.unitsPerPack <= 100_000
    ? item.unitsPerPack
    : undefined;
}

/**
 * Bloque del escaneo para `POST /api/purchases` desde las líneas que se envían. Solo
 * cuentan las que salieron de la factura (`lineIndexByItemId`); una línea quitada no va
 * en `invoiceScanLines`. La extracción conserva TODAS las líneas leídas (los índices
 * siguen apuntando a la misma) y en las cargadas pone cantidad, precio unitario, unidades
 * por empaque y alícuota finales del formulario.
 */
export function buildInvoiceScanSubmission(
  loaded: LoadedInvoiceScan,
  lines: InvoiceScanSubmissionLine[],
  input: { costCurrency: PurchaseCostCurrency; taxRates: Record<string, number> },
): InvoiceReviewScanBody {
  const invoiceScanLines: InvoiceReviewScanLine[] = [];
  const finalByIndex = new Map<number, InvoiceExtractionLine>();

  for (const { item, tax } of lines) {
    const lineIndex = loaded.lineIndexByItemId[item.id];
    const read = lineIndex === undefined ? undefined : loaded.extraction.lines[lineIndex];

    if (lineIndex === undefined || !read || finalByIndex.has(lineIndex)) {
      continue;
    }

    const unitsPerPack = validUnitsPerPack(item);
    const packLabel = item.packLabel.trim();

    invoiceScanLines.push({
      lineIndex,
      productId: item.productId,
      ...(unitsPerPack !== undefined
        ? { ...(packLabel ? { packLabel } : {}), unitsPerPack }
        : {}),
    });

    const fixed: InvoiceExtractionLine = {
      ...read,
      quantity: item.entryMode === "pack" ? item.packCount : item.quantity,
      unitPrice: invoicePrice(item, loaded, input.costCurrency),
      ...(tax.code ? { taxHint: taxHintFromCode(tax.code, input.taxRates) } : {}),
    };

    if (unitsPerPack !== undefined) {
      fixed.unitsPerPack = unitsPerPack;
    } else {
      delete fixed.unitsPerPack;
    }
    finalByIndex.set(lineIndex, fixed);
  }

  return {
    invoiceScanExtraction: {
      ...loaded.extraction,
      lines: loaded.extraction.lines.map((read, index) => finalByIndex.get(index) ?? read),
    },
    invoiceScanId: loaded.scanId,
    invoiceScanLines,
  };
}

/** Toast tras confirmar: alias que el servidor aprendió de esta factura. */
export function describeLearnedAliases(learned: number) {
  return learned === 1
    ? "Se aprendió 1 alias de este proveedor"
    : `Se aprendieron ${learned} alias de este proveedor`;
}

