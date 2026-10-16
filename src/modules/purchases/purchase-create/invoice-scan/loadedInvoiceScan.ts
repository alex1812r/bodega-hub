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
import { formatRate } from "./components/invoiceReviewView";
import {
  taxHintFromCode,
  type InvoiceReviewDraft,
  type InvoiceReviewScanBody,
  type InvoiceReviewScanLine,
} from "./reviewDraft";
import { TAX_RESIDUAL_CENT } from "./reviewModel";

/** Escaneo cargado en el formulario. */
export type LoadedInvoiceScan = {
  scanId: string;
  /** `item.id` de cada línea del formulario que salió de la factura → índice en `extraction.lines`. */
  lineIndexByItemId: Record<string, number>;
  /** Extracción corregida en la revisión (D10). */
  extraction: InvoiceExtraction;
  /**
   * Tasa elegida en la revisión: la de la compra mientras el escaneo esté cargado
   * (SCN-UI-C1). Ausente = precios de la factura en REF (USD aceptado), tasa del día.
   */
  invoiceRateVes?: number;
  /**
   * SCN-UI-Q1 · Los precios de la factura incluyen IVA: el formulario lleva la base y la
   * extracción que se envía (D10) devuelve el precio con IVA (el leído si no se tocó).
   */
  pricesIncludeTax?: true;
  /**
   * SCN-UI-C3 · Costo en Bs de la factura (el del modo de entrada) de cada línea cargada
   * en Bs: alternar «Costos en» Bs → REF → Bs lo devuelve sin el redondeo del REF.
   */
  invoiceCostVesByItemId?: Record<string, InvoiceLineCostVes>;
};

/** Costo Bs de una línea tal como vino de la factura. */
export type InvoiceLineCostVes = {
  costVes: number;
  entryMode: PurchaseDraftItem["entryMode"];
  /** Costo REF de la línea justo tras pasar a REF sin haberse editado; ausente si no aplica. */
  refAfterSwitch?: number;
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
  const invoiceCostVesByItemId: Record<string, InvoiceLineCostVes> = {};

  if (costCurrency === "ves") {
    for (const item of added) {
      invoiceCostVesByItemId[item.id] = { costVes: entryCostVes(item), entryMode: item.entryMode };
    }
  }

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
      ...(draft.pricesIncludeTax ? { pricesIncludeTax: true as const } : {}),
      ...(added.length > 0 && costCurrency === "ves" ? { invoiceCostVesByItemId } : {}),
      lineIndexByItemId,
      scanId: draft.body.invoiceScanId,
    },
    notices: removed.length > 0 ? [describeRemoved(removed)] : [],
  };
}

/**
 * Aviso junto a la tasa mientras el escaneo esté cargado y su tasa no sea la del día:
 * «Tasa de la factura 875,65 (hoy 900,00)». `null` si coinciden o no hay tasa elegida.
 */
export function describeLoadedInvoiceRate(
  loaded: Pick<LoadedInvoiceScan, "invoiceRateVes"> | null,
  systemRateVes: number | undefined,
) {
  const rate = loaded?.invoiceRateVes;

  if (rate === undefined || (systemRateVes !== undefined && roundMoney(rate) === roundMoney(systemRateVes))) {
    return null;
  }

  return systemRateVes === undefined
    ? `Tasa de la factura ${formatRate(rate)} (sin tasa del día)`
    : `Tasa de la factura ${formatRate(rate)} (hoy ${formatRate(systemRateVes)})`;
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

/** Aviso al quitar la última línea de la factura (SCN-UI-C3). */
export const LOADED_INVOICE_SCAN_RELEASED_NOTICE =
  "Quitaste todas las líneas de la factura: la compra ya no se vincula al escaneo";

/**
 * `true` si quitar `removedItemId` deja el formulario sin ninguna línea de la factura:
 * la compra deja de vincularse al escaneo (que sigue por revisar) y vuelve la tasa del día.
 */
export function removesLastInvoiceScanLine(
  loaded: LoadedInvoiceScan,
  itemIds: Iterable<string>,
  removedItemId: string,
) {
  if (!(removedItemId in loaded.lineIndexByItemId)) {
    return false;
  }

  for (const itemId of itemIds) {
    if (itemId !== removedItemId && itemId in loaded.lineIndexByItemId) {
      return false;
    }
  }
  return true;
}

function entryCostVes(item: PurchaseDraftItem) {
  return item.entryMode === "pack" ? item.packCostVes : item.unitCostVes;
}

function entryCostRef(item: PurchaseDraftItem) {
  return item.entryMode === "pack" ? item.packCostRef : item.unitCostRef;
}

function withEntryCostVes(item: PurchaseDraftItem, costVes: number, rateVes: number) {
  return syncLineCostFields(
    item.entryMode === "pack" ? { ...item, packCostVes: costVes } : { ...item, unitCostVes: costVes },
    rateVes,
  );
}

/**
 * «Costos en» con un escaneo cargado (SCN-UI-C3): la conversión de siempre, salvo que
 * las líneas de la factura cuyo costo no se editó desde la carga, al volver a Bs,
 * recuperan los Bs exactos de la factura (no los del REF redondeado).
 */
export function switchLoadedInvoiceScanCurrency(
  loaded: LoadedInvoiceScan,
  lines: PurchaseLinesSnapshot,
  change: { from: PurchaseCostCurrency; rateVes: number; to: PurchaseCostCurrency },
): { lines: PurchaseLinesSnapshot; loaded: LoadedInvoiceScan } {
  const { from, rateVes, to } = change;
  const items = lines.items.map((item) => switchCostCurrency(item, to, rateVes));
  const review = switchPurchaseReviewCostCurrency(lines.review, to, rateVes);
  const costs = loaded.invoiceCostVesByItemId;

  if (!costs || from === to) {
    return { lines: { ...lines, items, review }, loaded };
  }

  const nextCosts: Record<string, InvoiceLineCostVes> = {};
  const restored = new Map<string, number>();

  for (const [index, before] of lines.items.entries()) {
    const cost = costs[before.id];

    if (!cost) {
      continue;
    }

    const base: InvoiceLineCostVes = { costVes: cost.costVes, entryMode: cost.entryMode };
    const sameMode = before.entryMode === cost.entryMode;

    nextCosts[before.id] =
      to === "ref" && sameMode && roundMoney(entryCostVes(before)) === roundMoney(cost.costVes)
        ? { ...base, refAfterSwitch: roundMoney(entryCostRef(items[index])) }
        : base;

    if (
      to === "ves" &&
      sameMode &&
      cost.refAfterSwitch !== undefined &&
      roundMoney(entryCostRef(before)) === cost.refAfterSwitch
    ) {
      restored.set(before.id, entryCostVes(items[index]));
      items[index] = withEntryCostVes(items[index], cost.costVes, rateVes);
    }
  }

  // Las fotos de revisión que coincidían con la línea siguen coincidiendo (no cuenta como edición).
  const restoreSnapshots = (snapshots: PurchaseLinesSnapshot["review"]["baselines"]) =>
    Object.fromEntries(
      Object.entries(snapshots).map(([itemId, snapshot]) => {
        const switchedVes = restored.get(itemId);
        const cost = costs[itemId];

        return switchedVes !== undefined &&
          cost &&
          snapshot.item.entryMode === cost.entryMode &&
          roundMoney(entryCostVes(snapshot.item)) === roundMoney(switchedVes)
          ? [itemId, { ...snapshot, item: withEntryCostVes(snapshot.item, cost.costVes, rateVes) }]
          : [itemId, snapshot];
      }),
    );

  return {
    lines: {
      ...lines,
      items,
      review:
        restored.size > 0
          ? { baselines: restoreSnapshots(review.baselines), reviewed: restoreSnapshots(review.reviewed) }
          : review,
    },
    loaded: { ...loaded, invoiceCostVesByItemId: nextCosts },
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

/**
 * SCN-UI-Q1 · Con precios con IVA incluido la extracción guarda el precio de la factura,
 * no la base: el leído si la base sigue siendo la que salió de él (a un céntimo: la
 * revisión reparte ahí el residuo de redondeo, `settleTaxResidual`); si se editó en el
 * formulario, base × (1 + alícuota).
 */
function invoicePriceWithTax(base: number, read: InvoiceExtractionLine, taxRate: number) {
  const factor = 1 + Math.max(0, taxRate) / 100;
  const fromRead = roundMoney(read.unitPrice / factor);

  return Math.abs(roundMoney(fromRead - base)) <= TAX_RESIDUAL_CENT ? read.unitPrice : roundMoney(base * factor);
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
      unitPrice: loaded.pricesIncludeTax
        ? invoicePriceWithTax(invoicePrice(item, loaded, input.costCurrency), read, item.taxRate)
        : invoicePrice(item, loaded, input.costCurrency),
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

