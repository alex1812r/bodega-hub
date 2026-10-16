/**
 * SCN-08a · Modelo PURO de la pantalla de revisión del escaneo de facturas
 * (plan factura-escaneo-gtm §3 "Moneda y alícuota", §5.3 SCN-08; caos 6.7, 6.8,
 * 6.16, 6.17, 6.19, 6.20, 6.21; decisiones D8 y D10).
 *
 * Sin React ni red: `createInvoiceReviewState` arma el estado desde la respuesta
 * de `POST /api/invoice-scans` y `reviewReducer` aplica las acciones del usuario.
 * Los selectores (`orderedLineIndices`, `nextPendingIndex`, `getInvoiceReviewTotals`,
 * `getInvoiceReviewBlockers`…) derivan lo que pinta la UI. La salida para el
 * formulario de compra y el body de `POST /api/purchases` está en `reviewDraft.ts`.
 *
 * REGLA DURA (6.16): ninguna línea se resuelve sola. Solo `confirmed` del
 * emparejamiento entra como `confirmed_by_match`; una dudosa con score 0,99
 * sigue pendiente hasta que el usuario acepta (Enter o clic).
 */
import type {
  InvoiceExtraction,
  InvoiceMatchCandidate,
  InvoiceMatchStatus,
  InvoiceScanResponse,
} from "@/modules/invoice-scan/contracts";
import { USD_DOCUMENT_ISSUE } from "@/modules/invoice-scan/server/match/money";
import { formatVesBs, roundMoney } from "@/shared/utils/currency";

/** Diferencia relativa tasa impresa vs del sistema por encima de la cual se avisa (D8: 2 %). */
export const PRINTED_RATE_WARNING_DELTA = 0.02;
/**
 * Tolerancia de totales (la misma del emparejamiento, `server/match/money.ts`):
 * máx(1 % del leído, 1 Bs). En facturas en dólares el mínimo es 0,01.
 */
export const TOTALS_RELATIVE_TOLERANCE = 0.01;
export const TOTALS_MIN_TOLERANCE_VES = 1;
export const TOTALS_MIN_TOLERANCE_USD = 0.01;
/**
 * Por línea se suma medio céntimo por unidad facturada a la tolerancia de totales:
 * el precio impreso viene redondeado al céntimo (3 × 33,33 = 99,99 frente a 100).
 */
export const LINE_TOLERANCE_PER_UNIT = 0.005;
/** Candidatos que se muestran por línea. */
export const MAX_REVIEW_CANDIDATES = 3;
/** Cantidad máxima de una línea (entero de 32 bits de la compra). */
export const MAX_REVIEW_QUANTITY = 2_147_483_647;
/** Importe o precio por encima de esto es una lectura imposible. */
export const MAX_REVIEW_AMOUNT = 1e12;
/** Unidades por empaque máximas: las mismas que valida el servidor en `invoiceScanLines`. */
export const MAX_REVIEW_UNITS_PER_PACK = 100_000;
/** Etiqueta de empaque cuando la factura no dice cuál (la misma de la compra duplicada). */
export const DEFAULT_PACK_LABEL = "Bulto";

export const USD_ANOMALY_NOTICE =
  "La factura parece estar en dólares ($/USD): revisa cada línea. Si la aceptas, los costos se cargan como REF (USD = REF), nunca como Bs.";

export type InvoiceReviewContext = {
  /** Tasa Bs/REF vigente de la tienda; ausente si no hay tasa del día (6.7). */
  systemRateVes?: number;
  /** Catálogo de alícuotas activas: código → porcentaje (`{ general: 16, exento: 0 }`). */
  taxRates: Record<string, number>;
};

export type InvoiceReviewLineStatus =
  | "pending_unmatched"
  | "pending_doubtful"
  | "resolved"
  | "discarded"
  | "confirmed_by_match";

/** Producto elegido en el buscador o creado con "Nuevo producto". */
export type InvoiceReviewProduct = { productId: string; name: string };

/** Lo que falta para que una línea con producto quede resuelta. */
export type InvoiceReviewLineNeed = "product" | "unitsPerPack" | "quantity" | "unitPrice";

export type InvoiceReviewLine = {
  /** Índice en `extraction.lines` (y `lineIndex` de la salida). */
  index: number;
  /** Estado con el que llegó del emparejamiento (en factura USD, nunca `confirmed`). */
  origin: InvoiceMatchStatus;
  /** Estado actual; lo recalcula el reducer tras cada acción (no se edita a mano). */
  status: InvoiceReviewLineStatus;
  productId?: string;
  /** Nombre del producto si se conoce (candidato o buscador); la UI resuelve el resto. */
  productName?: string;
  /** El usuario confirmó el producto (aceptar candidato, Enter o buscador). */
  accepted: boolean;
  /** El usuario la dejó sin emparejar (Esc): ya no se pinta como dudosa. */
  leftUnmatched?: boolean;
  discarded: boolean;
  /** Candidato marcado con las flechas: Enter lo acepta. */
  markedProductId?: string;
  /** ≤ 3 candidatos con su motivo. */
  candidates: InvoiceMatchCandidate[];
  description: string;
  /** Texto literal de la factura (gris bajo el nombre). */
  rawText: string;
  /** Cantidad en la unidad de entrada (empaques en modo empaque). */
  quantity: number;
  /** Precio por unidad de entrada SIN IVA, en la moneda de la factura (Bs; USD si es anomalía). */
  unitPrice: number;
  /** Total de la línea leído en la factura. */
  lineTotalRead: number;
  taxRateCode: string;
  entryMode: "unit" | "pack";
  /** Obligatorio (entero > 0) en modo empaque: sin él la línea no se resuelve (6.8, 6.19). */
  unitsPerPack?: number;
  packUnitId?: string;
  packLabel: string;
  disassembleOnReceive: boolean;
  /** Avisos en español del emparejamiento (más el de dólares si aplica). */
  issues: string[];
};

export type InvoiceRateChoice = "system" | "printed" | "manual";

export type InvoiceReviewRate = {
  system?: number;
  printed?: number;
  /** `null` no se usa: sin tasa del sistema ni impresa la elección es `manual` sin valor. */
  choice: InvoiceRateChoice;
  manual?: number;
  /** Aviso de diferencia impresa vs sistema > 2 % (D8); ofrece "usar la impresa". */
  warning?: string;
  /** Aviso de tasa que no es la del día (6.7): impresa usada o tasa manual pedida. */
  notice?: string;
};

export type InvoiceReviewSupplier = {
  /** Contacto confirmado; sin él no se puede cargar. */
  contactId?: string;
  /** Nombre del contacto elegido (o el leído si aún no se eligió). */
  name: string;
  /** Nombre tal como se leyó en la factura. */
  readName: string;
  candidates: { contactId: string; name: string; score: number; reason: string }[];
};

export type InvoiceReviewState = {
  scanId: string;
  /** Extracción original (no se muta; la corregida la arma `reviewDraft.ts`). */
  extraction: InvoiceExtraction;
  header: {
    supplier: InvoiceReviewSupplier;
    number?: string;
    /** ISO `YYYY-MM-DD`. */
    date?: string;
    currency: InvoiceExtraction["currency"];
  };
  lines: InvoiceReviewLine[];
  rate: InvoiceReviewRate;
  usd: { anomaly: boolean; accepted: boolean };
  taxRates: Record<string, number>;
  duplicateOfScanId?: string;
  /** Datos del emparejamiento por línea para restaurar empaque al volver al producto propuesto. */
  matchDefaults: MatchLineDefaults[];
};

type MatchLineDefaults = {
  productId?: string;
  entryMode: "unit" | "pack";
  unitsPerPack?: number;
  packUnitId?: string;
  disassembleOnReceive: boolean;
  readUnitsPerPack?: number;
};

export type InvoiceReviewAction =
  | { type: "acceptCandidate"; index: number; productId: string }
  | { type: "chooseProduct"; index: number; product: InvoiceReviewProduct }
  | { type: "markCandidate"; index: number; productId: string }
  /** Enter: acepta el candidato marcado, o el primero, o el producto propuesto. */
  | { type: "acceptMarked"; index: number }
  | { type: "discardLine"; index: number }
  /** Esc: deja la línea sin emparejar (sigue pendiente; se puede descartar). */
  | { type: "leaveUnmatched"; index: number }
  | { type: "restoreLine"; index: number }
  | { type: "editQuantity"; index: number; quantity: number }
  | { type: "editUnitPrice"; index: number; unitPrice: number }
  | { type: "editTaxRate"; index: number; taxRateCode: string }
  | { type: "editUnitsPerPack"; index: number; unitsPerPack: number | undefined }
  | { type: "editEntryMode"; index: number; entryMode: "unit" | "pack" }
  | { type: "editPackLabel"; index: number; packLabel: string }
  | { type: "setSupplier"; supplier: { contactId: string; name: string } }
  | { type: "editHeader"; number?: string; date?: string }
  | { type: "setRateChoice"; choice: InvoiceRateChoice; manualRate?: number }
  | { type: "acceptUsdAnomaly" };

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidUnitsPerPack(value: number | undefined): value is number {
  return isPositive(value) && Number.isInteger(value) && value <= MAX_REVIEW_UNITS_PER_PACK;
}

const PACK_LABELS: Record<string, string> = {
  bulto: "Bulto",
  caja: "Caja",
  display: "Display",
  paquete: "Paquete",
};

/** "La factura trae tasa Bs. 875,65; hoy es Bs. 900,00." si difieren > 2 % (D8). */
export function printedRateWarning(system: number, printed: number): string | undefined {
  return Math.abs(printed - system) / system > PRINTED_RATE_WARNING_DELTA
    ? `La factura trae tasa ${formatVesBs(printed)}; hoy es ${formatVesBs(system)}.`
    : undefined;
}

function initialRate(response: InvoiceScanResponse, ctx: InvoiceReviewContext): InvoiceReviewRate {
  const system = isPositive(ctx.systemRateVes) ? ctx.systemRateVes : undefined;
  const printedRead = response.extraction.printedRate ?? response.matched.rate?.printed;
  const printed = isPositive(printedRead) ? printedRead : undefined;
  const base = {
    ...(system !== undefined ? { system } : {}),
    ...(printed !== undefined ? { printed } : {}),
  };

  if (system !== undefined) {
    const warning = printed !== undefined ? printedRateWarning(system, printed) : undefined;
    return { ...base, choice: "system", ...(warning ? { warning } : {}) };
  }
  if (printed !== undefined) {
    return {
      ...base,
      choice: "printed",
      notice: `No hay tasa del día en el sistema: se usa la tasa impresa en la factura (${formatVesBs(printed)}).`,
    };
  }
  return {
    ...base,
    choice: "manual",
    notice: "No hay tasa del día ni tasa impresa en la factura: escribe la tasa para convertir los costos.",
  };
}

/** Valores que impiden resolver la línea aunque tenga producto. */
export function getLineNeeds(line: InvoiceReviewLine): InvoiceReviewLineNeed[] {
  const needs: InvoiceReviewLineNeed[] = [];
  if (!line.productId) {
    needs.push("product");
  }
  if (line.entryMode === "pack" && !isValidUnitsPerPack(line.unitsPerPack)) {
    needs.push("unitsPerPack");
  }
  if (!isPositive(line.quantity) || !Number.isInteger(line.quantity) || line.quantity > MAX_REVIEW_QUANTITY) {
    needs.push("quantity");
  }
  if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0 || line.unitPrice > MAX_REVIEW_AMOUNT) {
    needs.push("unitPrice");
  }
  return needs;
}

function deriveStatus(line: InvoiceReviewLine, matchProductId: string | undefined): InvoiceReviewLineStatus {
  if (line.discarded) {
    return "discarded";
  }
  if (!line.productId) {
    // Dudosa del servidor con candidatos pero sin producto propuesto: sigue siendo dudosa.
    return line.origin === "doubtful" && !line.leftUnmatched ? "pending_doubtful" : "pending_unmatched";
  }
  const complete = getLineNeeds(line).length === 0;
  if (line.accepted) {
    return complete ? "resolved" : "pending_doubtful";
  }
  if (line.origin === "confirmed" && line.productId === matchProductId) {
    return complete ? "confirmed_by_match" : "pending_doubtful";
  }
  return "pending_doubtful";
}

function withStatus(state: InvoiceReviewState, line: InvoiceReviewLine): InvoiceReviewLine {
  return { ...line, status: deriveStatus(line, state.matchDefaults[line.index]?.productId) };
}

/**
 * Estado inicial. Factura en dólares (6.21): todas las líneas entran dudosas con
 * aviso y sin costos en Bs. Tasa (6.7, 6.20): la del sistema; sin ella la impresa
 * con aviso; sin ninguna, se pide a mano (nunca se precarga en silencio).
 */
export function createInvoiceReviewState(
  response: InvoiceScanResponse,
  ctx: InvoiceReviewContext,
): InvoiceReviewState {
  const { extraction, matched } = response;
  const anomaly =
    extraction.currency === "USD" || matched.lines.some((line) => line.issues.includes(USD_DOCUMENT_ISSUE));
  const matchByIndex = new Map(matched.lines.map((line) => [line.index, line]));
  const supplierCandidates = matched.supplier.candidates ?? [];
  const confirmedSupplier = matched.supplier.contactId;
  const matchDefaults: MatchLineDefaults[] = [];

  const lines = extraction.lines.map((read, index): InvoiceReviewLine => {
    const match = matchByIndex.get(index);
    const baseOrigin = match?.status ?? "unmatched";
    const origin: InvoiceMatchStatus = anomaly && baseOrigin === "confirmed" ? "doubtful" : baseOrigin;
    const candidates = (match?.candidates ?? []).slice(0, MAX_REVIEW_CANDIDATES);
    const productId = match?.productId;
    const entryMode = match?.entryMode ?? "unit";
    const readUnitsPerPack = isValidUnitsPerPack(read.unitsPerPack) ? read.unitsPerPack : undefined;
    const unitsPerPack = isValidUnitsPerPack(match?.unitsPerPack) ? match?.unitsPerPack : undefined;
    const issues = [...(match?.issues ?? [])];
    if (anomaly && !issues.includes(USD_DOCUMENT_ISSUE)) {
      issues.push(USD_DOCUMENT_ISSUE);
    }
    const quantity = read.quantity;
    const unitPrice =
      isPositive(read.unitPrice) || !isPositive(read.lineTotal) || !isPositive(quantity)
        ? read.unitPrice
        : roundMoney(read.lineTotal / quantity);

    matchDefaults.push({
      ...(productId ? { productId } : {}),
      entryMode,
      ...(unitsPerPack !== undefined ? { unitsPerPack } : {}),
      ...(match?.packUnitId ? { packUnitId: match.packUnitId } : {}),
      disassembleOnReceive: match?.disassembleOnReceive === true,
      ...(readUnitsPerPack !== undefined ? { readUnitsPerPack } : {}),
    });

    const line: InvoiceReviewLine = {
      index,
      origin,
      status: "pending_unmatched",
      ...(productId ? { productId } : {}),
      ...(productId ? withName(candidates, productId) : {}),
      accepted: false,
      discarded: false,
      candidates,
      description: read.description,
      rawText: read.rawText,
      quantity,
      unitPrice,
      lineTotalRead: read.lineTotal,
      taxRateCode: match?.taxRateCode ?? "",
      entryMode,
      ...(unitsPerPack !== undefined ? { unitsPerPack } : {}),
      ...(match?.packUnitId ? { packUnitId: match.packUnitId } : {}),
      packLabel: (read.unit && PACK_LABELS[read.unit]) || DEFAULT_PACK_LABEL,
      disassembleOnReceive: match?.disassembleOnReceive === true,
      issues,
    };
    return line;
  });

  const state: InvoiceReviewState = {
    scanId: response.scanId,
    extraction,
    header: {
      supplier: {
        ...(confirmedSupplier ? { contactId: confirmedSupplier } : {}),
        name: extraction.supplier.name,
        readName: extraction.supplier.name,
        candidates: supplierCandidates,
      },
      ...(extraction.number ? { number: extraction.number } : {}),
      ...(extraction.date ? { date: extraction.date } : {}),
      currency: extraction.currency,
    },
    lines,
    rate: initialRate(response, ctx),
    usd: { anomaly, accepted: false },
    taxRates: { ...ctx.taxRates },
    ...(matched.duplicateOfScanId ? { duplicateOfScanId: matched.duplicateOfScanId } : {}),
    matchDefaults,
  };
  return { ...state, lines: lines.map((line) => withStatus(state, line)) };
}

function withName(candidates: InvoiceMatchCandidate[], productId: string): { productName?: string } {
  const name = candidates.find((candidate) => candidate.productId === productId)?.name;
  return name ? { productName: name } : {};
}

/**
 * Cambia el producto de la línea. Volver al producto propuesto por el
 * emparejamiento recupera su empaque (registrado, receta); otro producto pierde
 * `packUnitId` y «desarmar al recibir» (son del producto) y conserva el tamaño
 * leído en la factura, que el usuario confirma.
 */
function setProduct(state: InvoiceReviewState, line: InvoiceReviewLine, product: InvoiceReviewProduct): InvoiceReviewLine {
  const defaults = state.matchDefaults[line.index];
  const sameAsMatch = defaults?.productId === product.productId;
  const productChanged = line.productId !== product.productId;
  const base: InvoiceReviewLine = {
    ...line,
    productId: product.productId,
    productName: product.name,
    accepted: true,
    leftUnmatched: undefined,
    markedProductId: undefined,
  };
  if (!productChanged) {
    return base;
  }
  if (sameAsMatch && defaults) {
    return {
      ...base,
      entryMode: defaults.entryMode,
      unitsPerPack: defaults.unitsPerPack,
      packUnitId: defaults.packUnitId,
      disassembleOnReceive: defaults.disassembleOnReceive,
    };
  }
  return {
    ...base,
    unitsPerPack: line.entryMode === "pack" ? (line.unitsPerPack ?? defaults?.readUnitsPerPack) : line.unitsPerPack,
    packUnitId: undefined,
    disassembleOnReceive: false,
  };
}

function candidateProduct(line: InvoiceReviewLine, productId: string): InvoiceReviewProduct | undefined {
  const candidate = line.candidates.find((item) => item.productId === productId);
  if (candidate) {
    return { productId, name: candidate.name };
  }
  if (line.productId === productId) {
    return { productId, name: line.productName ?? "" };
  }
  return undefined;
}

/** Producto que acepta Enter: el marcado, o el primer candidato, o el propuesto. */
export function enterTargetProductId(line: InvoiceReviewLine): string | undefined {
  return line.markedProductId ?? line.candidates[0]?.productId ?? line.productId;
}

function updateLine(
  state: InvoiceReviewState,
  index: number,
  update: (line: InvoiceReviewLine) => InvoiceReviewLine,
): InvoiceReviewState {
  const current = state.lines[index];
  if (!current) {
    return state;
  }
  const next = update(current);
  if (next === current) {
    return state;
  }
  const lines = state.lines.slice();
  lines[index] = withStatus(state, next);
  return { ...state, lines };
}

function rateReducer(state: InvoiceReviewState, choice: InvoiceRateChoice, manualRate?: number): InvoiceReviewState {
  const { rate } = state;
  if (choice === "system" && rate.system === undefined) {
    return state;
  }
  if (choice === "printed" && rate.printed === undefined) {
    return state;
  }
  if (choice === "manual") {
    const manual = isPositive(manualRate) ? manualRate : undefined;
    return { ...state, rate: { ...rate, choice, manual } };
  }
  return { ...state, rate: { ...rate, choice } };
}

export function reviewReducer(state: InvoiceReviewState, action: InvoiceReviewAction): InvoiceReviewState {
  switch (action.type) {
    case "acceptCandidate":
      return updateLine(state, action.index, (line) => {
        const product = candidateProduct(line, action.productId);
        return product && !line.discarded ? setProduct(state, line, product) : line;
      });
    case "chooseProduct":
      return updateLine(state, action.index, (line) =>
        line.discarded ? line : setProduct(state, line, action.product),
      );
    case "markCandidate":
      return updateLine(state, action.index, (line) =>
        candidateProduct(line, action.productId) ? { ...line, markedProductId: action.productId } : line,
      );
    case "acceptMarked":
      return updateLine(state, action.index, (line) => {
        const target = enterTargetProductId(line);
        const product = target ? candidateProduct(line, target) : undefined;
        return product && !line.discarded ? setProduct(state, line, product) : line;
      });
    case "discardLine":
      return updateLine(state, action.index, (line) => (line.discarded ? line : { ...line, discarded: true }));
    case "restoreLine":
      return updateLine(state, action.index, (line) => (line.discarded ? { ...line, discarded: false } : line));
    case "leaveUnmatched":
      return updateLine(state, action.index, (line) =>
        line.discarded
          ? line
          : {
              ...line,
              productId: undefined,
              productName: undefined,
              accepted: false,
              leftUnmatched: true,
              markedProductId: undefined,
            },
      );
    case "editQuantity":
      return updateLine(state, action.index, (line) => ({ ...line, quantity: action.quantity }));
    case "editUnitPrice":
      return updateLine(state, action.index, (line) => ({ ...line, unitPrice: action.unitPrice }));
    case "editTaxRate":
      return action.taxRateCode in state.taxRates
        ? updateLine(state, action.index, (line) => ({ ...line, taxRateCode: action.taxRateCode }))
        : state;
    case "editUnitsPerPack":
      return updateLine(state, action.index, (line) => {
        const defaults = state.matchDefaults[line.index];
        // El empaque registrado es de un tamaño concreto: otro tamaño es un empaque nuevo (6.8).
        const keepsRegistered =
          defaults?.packUnitId !== undefined &&
          line.productId === defaults.productId &&
          action.unitsPerPack === defaults.unitsPerPack;
        return {
          ...line,
          unitsPerPack: action.unitsPerPack,
          packUnitId: keepsRegistered ? defaults.packUnitId : undefined,
        };
      });
    case "editEntryMode":
      return updateLine(state, action.index, (line) =>
        line.entryMode === action.entryMode ? line : { ...line, entryMode: action.entryMode },
      );
    case "editPackLabel":
      return updateLine(state, action.index, (line) => ({ ...line, packLabel: action.packLabel }));
    case "setSupplier":
      return {
        ...state,
        header: {
          ...state.header,
          supplier: { ...state.header.supplier, contactId: action.supplier.contactId, name: action.supplier.name },
        },
      };
    case "editHeader": {
      const header = { ...state.header };
      if (action.number !== undefined) {
        header.number = action.number.trim() || undefined;
      }
      if (action.date !== undefined) {
        header.date = action.date || undefined;
      }
      return { ...state, header };
    }
    case "setRateChoice":
      return rateReducer(state, action.choice, action.manualRate);
    case "acceptUsdAnomaly":
      return state.usd.anomaly ? { ...state, usd: { ...state.usd, accepted: true } } : state;
    default:
      return state;
  }
}

export function isPendingStatus(status: InvoiceReviewLineStatus): boolean {
  return status === "pending_unmatched" || status === "pending_doubtful";
}

function urgencyRank(line: InvoiceReviewLine): number {
  if (line.origin === "unmatched") {
    return 0;
  }
  if (line.origin === "doubtful") {
    return 1;
  }
  // Una confirmada que el usuario dejó pendiente (Esc, cantidad inválida) sube con las dudosas.
  return isPendingStatus(line.status) ? 1 : 2;
}

/**
 * Índices de línea en orden de urgencia: sin emparejar, dudosas, confirmadas;
 * estable por índice. El rango sale del estado de ORIGEN para que las filas no
 * salten mientras el usuario resuelve.
 */
export function orderedLineIndices(state: InvoiceReviewState): number[] {
  return state.lines
    .map((line) => ({ index: line.index, rank: urgencyRank(line) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.index);
}

export type InvoiceReviewSections = {
  /** Sin emparejar y dudosas (también las ya resueltas o descartadas de ese origen). */
  review: InvoiceReviewLine[];
  /** Confirmadas por el emparejamiento: colapsadas ("12 líneas confirmadas · ver"). */
  confirmed: InvoiceReviewLine[];
  confirmedCount: number;
};

export function getReviewSections(state: InvoiceReviewState): InvoiceReviewSections {
  const review: InvoiceReviewLine[] = [];
  const confirmed: InvoiceReviewLine[] = [];
  for (const index of orderedLineIndices(state)) {
    const line = state.lines[index];
    (urgencyRank(line) === 2 ? confirmed : review).push(line);
  }
  return {
    review,
    confirmed,
    confirmedCount: state.lines.filter((line) => line.status === "confirmed_by_match").length,
  };
}

/**
 * Siguiente línea pendiente en orden de urgencia DESPUÉS de `from` (índice de
 * línea), dando la vuelta; salta confirmadas, resueltas y descartadas. Sin `from`
 * (o `null`), la primera pendiente. `null` si no queda ninguna.
 */
export function nextPendingIndex(state: InvoiceReviewState, from?: number | null): number | null {
  const order = orderedLineIndices(state);
  const start = from === undefined || from === null ? -1 : order.indexOf(from);
  for (let step = 1; step <= order.length; step += 1) {
    const index = order[(start + step + order.length) % order.length];
    if (isPendingStatus(state.lines[index].status)) {
      return index;
    }
  }
  return null;
}

export type InvoiceReviewKeyResult = { state: InvoiceReviewState; next: number | null };

/**
 * Enter sobre la línea `index`: acepta el candidato marcado (o el primero) y
 * devuelve la siguiente pendiente. Si la línea sigue pendiente (falta
 * `unitsPerPack`, cantidad inválida o no hay a quién aceptar) el foco se queda en ella.
 */
export function pressEnter(state: InvoiceReviewState, index: number): InvoiceReviewKeyResult {
  const next = reviewReducer(state, { type: "acceptMarked", index });
  const line = next.lines[index];
  if (!line || isPendingStatus(line.status)) {
    return { state: next, next: line ? index : nextPendingIndex(next, null) };
  }
  return { state: next, next: nextPendingIndex(next, index) };
}

/** Esc sobre la línea `index`: la deja sin emparejar y devuelve la siguiente pendiente. */
export function pressEscape(state: InvoiceReviewState, index: number): InvoiceReviewKeyResult {
  const next = reviewReducer(state, { type: "leaveUnmatched", index });
  return { state: next, next: nextPendingIndex(next, index) };
}

/** Líneas sin resolver (sin emparejar o dudosas). Descartar cuenta como resuelto. */
export function getPendingCount(state: InvoiceReviewState): number {
  return state.lines.filter((line) => isPendingStatus(line.status)).length;
}

/** Tasa Bs/REF con la que se convierten los costos; `undefined` si falta (manual sin valor). */
export function getEffectiveRate(state: InvoiceReviewState): number | undefined {
  const { rate } = state;
  if (rate.choice === "system") {
    return rate.system;
  }
  if (rate.choice === "printed") {
    return rate.printed;
  }
  return rate.manual;
}

/** Costos aceptados como REF directamente: factura en dólares aceptada (USD = REF). */
export function isUsdAccepted(state: InvoiceReviewState): boolean {
  return state.usd.anomaly && state.usd.accepted;
}

/** Elecciones de tasa que la UI puede ofrecer. */
export function getRateOptions(state: InvoiceReviewState): InvoiceRateChoice[] {
  const options: InvoiceRateChoice[] = [];
  if (state.rate.system !== undefined) {
    options.push("system");
  }
  if (state.rate.printed !== undefined) {
    options.push("printed");
  }
  options.push("manual");
  return options;
}

export type InvoiceReviewLineCosts = {
  /** Costo por unidad de entrada en Bs (sin IVA); ausente en factura USD. */
  ves?: number;
  /** Costo por unidad de entrada en REF: Bs ÷ tasa elegida, o el precio USD aceptado. */
  ref?: number;
};

export function getLineCosts(state: InvoiceReviewState, line: InvoiceReviewLine): InvoiceReviewLineCosts {
  if (state.usd.anomaly) {
    return isUsdAccepted(state) ? { ref: roundMoney(line.unitPrice) } : {};
  }
  const rate = getEffectiveRate(state);
  return {
    ves: roundMoney(line.unitPrice),
    ...(rate !== undefined ? { ref: roundMoney(line.unitPrice / rate) } : {}),
  };
}

function minTolerance(state: InvoiceReviewState): number {
  return state.usd.anomaly ? TOTALS_MIN_TOLERANCE_USD : TOTALS_MIN_TOLERANCE_VES;
}

function withinTolerance(read: number, computed: number, min: number, extra = 0): boolean {
  return Math.abs(read - computed) <= Math.max(TOTALS_RELATIVE_TOLERANCE * Math.abs(read), min) + extra;
}

/** Importe de la línea: cantidad × precio, redondeado (moneda de la factura). */
export function getLineAmount(line: InvoiceReviewLine): number {
  return roundMoney(line.quantity * line.unitPrice);
}

/**
 * Cantidad × precio no cuadra con el total leído de la línea. Tolerancia: la de
 * totales más medio céntimo por unidad facturada. Sin total leído (> 0) no se marca.
 */
export function isLineMismatch(state: InvoiceReviewState, line: InvoiceReviewLine): boolean {
  if (!isPositive(line.lineTotalRead) || !Number.isFinite(line.quantity) || !Number.isFinite(line.unitPrice)) {
    return false;
  }
  const units = Math.abs(line.quantity);
  return !withinTolerance(line.lineTotalRead, getLineAmount(line), minTolerance(state), LINE_TOLERANCE_PER_UNIT * units);
}

export type InvoiceReviewTotals = {
  /** `extraction.total` leído. */
  read?: number;
  /** Σ cantidad × precio de las líneas no descartadas (sin IVA). */
  computed: number;
  /** `computed` más el IVA de la alícuota de cada línea. */
  computedWithTax: number;
  /**
   * Descuadre, con la regla del emparejamiento: contra el subtotal leído (y
   * subtotal + IVA contra total); si no, total − IVA; si solo hay total, vale
   * sin IVA o con IVA. Tolerancia máx(1 %, 1 Bs) (0,01 en USD).
   */
  mismatch: boolean;
  /** Índices de las líneas no descartadas con `isLineMismatch`. */
  lineMismatches: number[];
};

export function getInvoiceReviewTotals(state: InvoiceReviewState): InvoiceReviewTotals {
  const active = state.lines.filter((line) => !line.discarded);
  const amounts = active.map((line) => (Number.isFinite(getLineAmount(line)) ? getLineAmount(line) : 0));
  const computed = roundMoney(amounts.reduce((sum, amount) => sum + amount, 0));
  const computedWithTax = roundMoney(
    active.reduce((sum, line, position) => {
      const pct = state.taxRates[line.taxRateCode] ?? 0;
      return sum + roundMoney(amounts[position] * (1 + pct / 100));
    }, 0),
  );
  const { total, subtotal, tax } = state.extraction;
  const read = Number.isFinite(total) ? total : undefined;
  const min = minTolerance(state);

  let mismatch = false;
  if (subtotal !== undefined && Number.isFinite(subtotal)) {
    mismatch = !withinTolerance(subtotal, computed, min);
    if (!mismatch && tax !== undefined && Number.isFinite(tax) && read !== undefined) {
      mismatch = !withinTolerance(read, subtotal + tax, min);
    }
  } else if (read !== undefined && tax !== undefined && Number.isFinite(tax)) {
    mismatch = !withinTolerance(read - tax, computed, min);
  } else if (read !== undefined) {
    mismatch = !withinTolerance(read, computed, min) && !withinTolerance(read, computedWithTax, min);
  }

  return {
    ...(read !== undefined ? { read } : {}),
    computed,
    computedWithTax,
    mismatch,
    lineMismatches: active.filter((line) => isLineMismatch(state, line)).map((line) => line.index),
  };
}

/**
 * Por qué "Cargar en la compra" está deshabilitado, en español. Vacío = se puede cargar.
 * Además de las líneas pendientes exige proveedor confirmado, al menos una línea,
 * aceptar la anomalía de dólares y una tasa (salvo dólares aceptados, que ya son REF).
 */
export function getInvoiceReviewBlockers(state: InvoiceReviewState): string[] {
  const blockers: string[] = [];
  const pending = getPendingCount(state);
  if (pending > 0) {
    blockers.push(pending === 1 ? "Queda 1 línea por resolver." : `Quedan ${pending} líneas por resolver.`);
  }
  if (!state.lines.some((line) => !line.discarded)) {
    blockers.push("No queda ninguna línea para cargar.");
  }
  if (!state.header.supplier.contactId) {
    blockers.push("Elige el proveedor.");
  }
  if (state.usd.anomaly && !state.usd.accepted) {
    blockers.push("Confirma que la factura está en dólares para cargar los costos como REF.");
  }
  if (!isUsdAccepted(state) && getEffectiveRate(state) === undefined) {
    blockers.push("Escribe la tasa para convertir los costos a REF.");
  }
  return blockers;
}

export function canLoad(state: InvoiceReviewState): boolean {
  return getInvoiceReviewBlockers(state).length === 0;
}

export type InvoiceReviewSummary = {
  pendingCount: number;
  confirmedCount: number;
  canLoad: boolean;
  blockers: string[];
  totals: InvoiceReviewTotals;
  effectiveRate?: number;
};

/** Todo lo derivado que pinta el pie y la cabecera, en una llamada. */
export function summarizeInvoiceReview(state: InvoiceReviewState): InvoiceReviewSummary {
  const blockers = getInvoiceReviewBlockers(state);
  const effectiveRate = getEffectiveRate(state);
  return {
    pendingCount: getPendingCount(state),
    confirmedCount: getReviewSections(state).confirmedCount,
    canLoad: blockers.length === 0,
    blockers,
    totals: getInvoiceReviewTotals(state),
    ...(effectiveRate !== undefined ? { effectiveRate } : {}),
  };
}
