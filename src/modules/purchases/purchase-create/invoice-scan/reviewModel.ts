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
  InvoiceScanConfirmedPurchase,
  InvoiceScanResponse,
} from "@/modules/invoice-scan/contracts";
import { DECIMAL_QUANTITY_ISSUE, USD_DOCUMENT_ISSUE } from "@/modules/invoice-scan/server/match/money";
import { formatVesBs, roundMoney } from "@/shared/utils/currency";

/** Diferencia relativa tasa impresa vs del sistema por encima de la cual se avisa (D8: 2 %). */
export const PRINTED_RATE_WARNING_DELTA = 0.02;
/**
 * SCN-UI-Q1 (MEDIO-4): una tasa impresa a más de ±25 % de la del día no es una tasa
 * Bs/USD (p. ej. el total REF 86,75 frente a 880,12): se ignora. La misma constante
 * vive en el servidor.
 */
export const PRINTED_RATE_MAX_DEVIATION = 0.25;
/** Sin tasa del día: la impresa debe estar entre 0,5× y 2× la última tasa conocida. */
export const PRINTED_RATE_LAST_KNOWN_MIN_FACTOR = 0.5;
export const PRINTED_RATE_LAST_KNOWN_MAX_FACTOR = 2;
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
  /** Última tasa conocida (aunque no sea del día): sin tasa del día acota la impresa. */
  lastKnownRateVes?: number;
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
  /**
   * La impresa se usa sin poder comprobarla (sin tasa del día ni última conocida):
   * la UI la avisa con tono fuerte.
   */
  unverified?: boolean;
  /** Tasa impresa inverosímil (fuera de `PRINTED_RATE_MAX_DEVIATION`…): no se ofrece. */
  ignoredWarning?: string;
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
  /**
   * SCN-UI-Q1 (ALTO-1): elección explícita "los precios incluyen IVA" (`true`) o no
   * (`false`). Sin elegir manda la sugerencia de `getTaxInclusion`. Con IVA incluido
   * `unitPrice` sigue siendo el precio leído y la base es precio ÷ (1 + alícuota).
   */
  pricesIncludeTax?: boolean;
  duplicateOfScanId?: string;
  /** REP-01: la misma foto ya se confirmó en esta compra; no se puede cargar otra vez. */
  confirmedPurchase?: InvoiceScanConfirmedPurchase;
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
  /** Cantidad fraccionaria de empaques → unidades enteras (`getUnitConversion`). */
  | { type: "convertPackToUnits"; index: number }
  | { type: "setPricesIncludeTax"; included: boolean }
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

/** Tasa sin prefijo, como en el aviso: "86,75". */
function formatRateValue(rate: number): string {
  return rate.toLocaleString("es-VE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/**
 * ¿La tasa impresa puede ser una tasa Bs/USD? Con tasa del día, a ±25 % de ella; sin
 * ella, entre 0,5× y 2× la última conocida. Sin ninguna referencia no se puede saber
 * (`undefined`): se ofrece, pero con aviso fuerte.
 */
export function isPlausiblePrintedRate(
  printed: number,
  reference: { system?: number; lastKnown?: number },
): boolean | undefined {
  if (isPositive(reference.system)) {
    return Math.abs(printed - reference.system) / reference.system <= PRINTED_RATE_MAX_DEVIATION;
  }
  if (isPositive(reference.lastKnown)) {
    return (
      printed >= reference.lastKnown * PRINTED_RATE_LAST_KNOWN_MIN_FACTOR &&
      printed <= reference.lastKnown * PRINTED_RATE_LAST_KNOWN_MAX_FACTOR
    );
  }
  return undefined;
}

function initialRate(response: InvoiceScanResponse, ctx: InvoiceReviewContext): InvoiceReviewRate {
  const system = isPositive(ctx.systemRateVes) ? ctx.systemRateVes : undefined;
  const printedRead = response.extraction.printedRate ?? response.matched.rate?.printed;
  const plausible = isPositive(printedRead)
    ? isPlausiblePrintedRate(printedRead, { system, lastKnown: ctx.lastKnownRateVes })
    : undefined;
  const ignored = isPositive(printedRead) && plausible === false;
  const printed = isPositive(printedRead) && !ignored ? printedRead : undefined;
  const base = {
    ...(system !== undefined ? { system } : {}),
    ...(printed !== undefined ? { printed } : {}),
    ...(ignored
      ? { ignoredWarning: `La tasa leída (${formatRateValue(printedRead)}) no parece una tasa Bs/USD; se ignora.` }
      : {}),
  };

  if (system !== undefined) {
    const warning = printed !== undefined ? printedRateWarning(system, printed) : undefined;
    return { ...base, choice: "system", ...(warning ? { warning } : {}) };
  }
  if (printed !== undefined && plausible === undefined) {
    return {
      ...base,
      choice: "printed",
      unverified: true,
      notice: `No hay tasa del día ni una tasa anterior con qué comprobarla: se usa la tasa impresa en la factura (${formatVesBs(printed)}) sin verificar. Revísala antes de cargar.`,
    };
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
    notice: ignored
      ? "No hay tasa del día y la tasa leída en la factura no es válida: escribe la tasa para convertir los costos."
      : "No hay tasa del día ni tasa impresa en la factura: escribe la tasa para convertir los costos.",
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

export type InvoiceUnitConversion =
  | { ok: true; units: number; unitPrice: number }
  | { ok: false; reason: string };

function formatQuantity(value: number): string {
  return value.toLocaleString("es-VE", { maximumFractionDigits: 3 });
}

/**
 * SCN-UI-Q1 (MEDIO-3): la compra solo admite cantidades enteras
 * (`purchaseItemInputSchema`: `quantity`/`packCount` int). Una cantidad fraccionaria
 * de empaques (0,50 cajas) con unidades por empaque conocidas se carga como unidades:
 * cantidad = empaques × unidades, costo = precio ÷ unidades. Si el producto no da
 * entero o faltan las unidades, `reason` dice qué editar.
 */
export function getUnitConversion(line: InvoiceReviewLine): InvoiceUnitConversion {
  const pack = line.packLabel.trim().toLowerCase() || "empaque";
  if (!isPositive(line.quantity) || Number.isInteger(line.quantity)) {
    return { ok: false, reason: "La cantidad debe ser un número entero mayor que 0." };
  }
  if (line.entryMode !== "pack") {
    return {
      ok: false,
      reason: `La compra solo admite cantidades enteras. Si la factura vende por ${pack}, elige «Por ${pack}» e indica las unidades por empaque para cargarla como unidades; si no, corrige la cantidad.`,
    };
  }
  if (!isValidUnitsPerPack(line.unitsPerPack)) {
    return {
      ok: false,
      reason: `Indica cuántas unidades trae cada ${pack} para cargar ${formatQuantity(line.quantity)} ${pack} como unidades, o corrige la cantidad.`,
    };
  }
  const exact = line.quantity * line.unitsPerPack;
  const units = Math.round(exact);
  if (Math.abs(exact - units) > 1e-9 || units < 1 || units > MAX_REVIEW_QUANTITY) {
    return {
      ok: false,
      reason: `${formatQuantity(line.quantity)} × ${line.unitsPerPack} = ${formatQuantity(exact)} unidades no es un número entero: corrige la cantidad o las unidades por ${pack}.`,
    };
  }
  return { ok: true, units, unitPrice: roundMoney(line.unitPrice / line.unitsPerPack) };
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
        // El confirmado por el emparejamiento lleva su nombre de contacto si viene entre los candidatos.
        name:
          supplierCandidates.find((candidate) => candidate.contactId === confirmedSupplier)?.name ??
          extraction.supplier.name,
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
    ...(response.confirmedPurchase ? { confirmedPurchase: response.confirmedPurchase } : {}),
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

/**
 * Producto que acepta Enter: el marcado, o el primer candidato, o el propuesto.
 * D24-d: si los dos primeros candidatos empatan sin desempate (mismo motivo y
 * mismo score a la vista) y el emparejamiento no propuso ninguno, no se
 * premarca nada: Enter elegiría al azar sin información.
 */
export function enterTargetProductId(line: InvoiceReviewLine): string | undefined {
  if (line.markedProductId) {
    return line.markedProductId;
  }
  const [first, second] = line.candidates;
  const tied =
    first !== undefined &&
    second !== undefined &&
    first.reason === second.reason &&
    Math.round(first.score * 100) === Math.round(second.score * 100);
  if (tied) {
    return line.productId;
  }
  return first?.productId ?? line.productId;
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
    case "convertPackToUnits":
      return updateLine(state, action.index, (line) => {
        const conversion = getUnitConversion(line);
        return conversion.ok && !line.discarded
          ? {
              ...line,
              entryMode: "unit",
              quantity: conversion.units,
              unitPrice: conversion.unitPrice,
              packUnitId: undefined,
              disassembleOnReceive: false,
            }
          : line;
      });
    case "setPricesIncludeTax":
      return state.pricesIncludeTax === action.included ? state : { ...state, pricesIncludeTax: action.included };
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
  const price = getLineBasePrice(state, line);
  if (state.usd.anomaly) {
    return isUsdAccepted(state) ? { ref: price } : {};
  }
  const rate = getEffectiveRate(state);
  return {
    ves: price,
    ...(rate !== undefined ? { ref: roundMoney(price / rate) } : {}),
  };
}

function linePct(state: InvoiceReviewState, line: InvoiceReviewLine): number {
  return Math.max(0, state.taxRates[line.taxRateCode] ?? 0);
}

/** Paso con que la revisión reparte el residuo de redondeo del IVA incluido: un céntimo por base. */
export const TAX_RESIDUAL_CENT = 0.01;

/** Total con IVA que registra la compra para la línea con ese precio base (`getDraftLineTotals`). */
function registeredLineTotal(state: InvoiceReviewState, line: InvoiceReviewLine, basePrice: number): number {
  const base = roundMoney(line.quantity * basePrice);
  return roundMoney(base + roundMoney(base * (linePct(state, line) / 100)));
}

/**
 * BAJO-N1 (CIE-03a): quitar el IVA línea a línea redondea cada base al céntimo y la suma
 * puede separarse unos céntimos de lo impreso (f02: 33.150,17 frente a 33.150,15). El
 * residuo se reparte a un céntimo como mucho por base: cada paso mueve la línea que más
 * acerca el total registrado a Σ cantidad × precio leído (primero las de menor cantidad y
 * mayor importe) y para cuando ningún céntimo lo acerca más. El céntimo de más o de menos
 * en la base no cambia el precio leído que vuelve en la extracción (`invoicePriceWithTax`).
 */
function settleTaxResidual(state: InvoiceReviewState, prices: number[]): number[] {
  const active = state.lines
    .filter(
      (line) =>
        !line.discarded &&
        isPositive(line.quantity) &&
        Number.isFinite(line.unitPrice) &&
        Number.isFinite(prices[line.index]),
    )
    .sort((left, right) => left.quantity - right.quantity || getLineAmount(right) - getLineAmount(left));
  const target = sumAmounts(active, getLineAmount);
  let diff = roundMoney(target - sumAmounts(active, (line) => registeredLineTotal(state, line, prices[line.index])));
  const moved = new Set<number>();
  while (diff !== 0) {
    const step = diff > 0 ? TAX_RESIDUAL_CENT : -TAX_RESIDUAL_CENT;
    let best: { index: number; diff: number } | undefined;
    for (const line of active.filter((candidate) => !moved.has(candidate.index))) {
      const price = prices[line.index];
      const change = registeredLineTotal(state, line, roundMoney(price + step)) - registeredLineTotal(state, line, price);
      const next = roundMoney(diff - change);
      if (Math.abs(next) < Math.abs(best?.diff ?? diff)) {
        best = { index: line.index, diff: next };
      }
    }
    if (!best) {
      break;
    }
    prices[best.index] = roundMoney(prices[best.index] + step);
    moved.add(best.index);
    diff = best.diff;
  }
  return prices;
}

/** Bases por índice de línea; el estado es inmutable, así que se calculan una vez por estado. */
const basePricesByState = new WeakMap<InvoiceReviewState, number[]>();

function getBasePrices(state: InvoiceReviewState): number[] {
  const cached = basePricesByState.get(state);
  if (cached) {
    return cached;
  }
  const included = getTaxInclusion(state).included;
  const plain = state.lines.map((line) => {
    if (!Number.isFinite(line.unitPrice)) {
      return line.unitPrice;
    }
    return included ? roundMoney(line.unitPrice / (1 + linePct(state, line) / 100)) : roundMoney(line.unitPrice);
  });
  const prices = included ? settleTaxResidual(state, plain) : plain;
  basePricesByState.set(state, prices);
  return prices;
}

/**
 * Precio SIN IVA por unidad de entrada, en la moneda de la factura (redondeado al
 * céntimo, como el costo de la compra). Con "los precios incluyen IVA" es el precio
 * leído ÷ (1 + alícuota de la línea), con el residuo de redondeo repartido para que el
 * total registrado sea el leído (`settleTaxResidual`); si no, el precio tal cual.
 */
export function getLineBasePrice(state: InvoiceReviewState, line: InvoiceReviewLine): number {
  return getBasePrices(state)[line.index] ?? line.unitPrice;
}

/**
 * Avisos de la línea que siguen vigentes. BAJO-N2 (CIE-03a): el de cantidad con
 * decimales del servidor sobra en cuanto la cantidad es entera (convertida a unidades
 * o corregida a mano).
 */
export function getLineIssues(line: InvoiceReviewLine): string[] {
  return Number.isInteger(line.quantity)
    ? line.issues.filter((issue) => issue !== DECIMAL_QUANTITY_ISSUE)
    : line.issues;
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

export type InvoiceTaxInclusion = {
  /**
   * La factura no desglosa IVA, Σ cantidad × precio ≈ total leído y las alícuotas
   * elegidas añadirían IVA: los precios parecen incluirlo (se avisa y se ofrece elegir).
   */
  suggested: boolean;
  /** Se carga la base precio ÷ (1 + alícuota): la elección del usuario o, sin ella, la sugerencia. */
  included: boolean;
};

function sumAmounts(lines: InvoiceReviewLine[], amount: (line: InvoiceReviewLine) => number): number {
  return roundMoney(lines.reduce((sum, line) => sum + (Number.isFinite(amount(line)) ? amount(line) : 0), 0));
}

/**
 * SCN-UI-Q1 (ALTO-1, regla ux-mejoras 10: las líneas de compra van sin IVA). La
 * detección mira TODAS las líneas (también las descartadas) para que descartar una no
 * cambie la sugerencia. Es reversible: `setPricesIncludeTax` la fija.
 */
export function getTaxInclusion(state: InvoiceReviewState): InvoiceTaxInclusion {
  const { total, subtotal, tax } = state.extraction;
  const min = minTolerance(state);
  const read = isPositive(total) ? total : undefined;
  const breakdown =
    isPositive(tax) ||
    (read !== undefined && subtotal !== undefined && Number.isFinite(subtotal) && !withinTolerance(read, subtotal, min));
  let suggested = false;
  if (read !== undefined && !breakdown) {
    const plain = sumAmounts(state.lines, getLineAmount);
    const withTax = sumAmounts(state.lines, (line) => roundMoney(getLineAmount(line) * (1 + linePct(state, line) / 100)));
    suggested = withinTolerance(read, plain, min) && !withinTolerance(read, withTax, min);
  }
  return { suggested, included: state.pricesIncludeTax ?? suggested };
}

export type InvoiceReviewTotals = {
  /** `extraction.total` leído. */
  read?: number;
  /** Σ cantidad × precio de las líneas no descartadas, tal como se leyeron o editaron. */
  computed: number;
  /** Σ base sin IVA que se registra (cantidad × `getLineBasePrice`, redondeada por línea). */
  base: number;
  /** IVA de las alícuotas elegidas sobre la base, redondeado por línea. */
  tax: number;
  /**
   * Total que se va a registrar: base + IVA, con el mismo redondeo que el formulario
   * de compra (`getDraftLineTotals`). Es lo que muestra el pie.
   */
  registered: number;
  /**
   * `registered` no cuadra con el total leído (sin total leído: la base contra el
   * subtotal leído). Tolerancia máx(1 %, 1 Bs) (0,01 en USD).
   */
  mismatch: boolean;
  /** Índices de las líneas no descartadas con `isLineMismatch`. */
  lineMismatches: number[];
};

export function getInvoiceReviewTotals(state: InvoiceReviewState): InvoiceReviewTotals {
  const active = state.lines.filter((line) => !line.discarded);
  const computed = sumAmounts(active, getLineAmount);
  const lineBase = (line: InvoiceReviewLine) => roundMoney(line.quantity * getLineBasePrice(state, line));
  const base = sumAmounts(active, lineBase);
  const tax = sumAmounts(active, (line) => roundMoney(lineBase(line) * (linePct(state, line) / 100)));
  const registered = roundMoney(base + tax);
  const { total, subtotal } = state.extraction;
  const read = Number.isFinite(total) ? total : undefined;
  const min = minTolerance(state);

  let mismatch = false;
  if (read !== undefined) {
    mismatch = !withinTolerance(read, registered, min);
  } else if (subtotal !== undefined && Number.isFinite(subtotal)) {
    mismatch = !withinTolerance(subtotal, base, min);
  }

  return {
    ...(read !== undefined ? { read } : {}),
    computed,
    base,
    tax,
    registered,
    mismatch,
    lineMismatches: active.filter((line) => isLineMismatch(state, line)).map((line) => line.index),
  };
}

/** REP-01: "Esta factura ya se registró en la compra C-000123" (o "en una compra" sin número). */
export function confirmedPurchaseMessage(purchase: InvoiceScanConfirmedPurchase): string {
  const number = purchase.purchaseNumber?.trim();
  return number
    ? `Esta factura ya se registró en la compra ${number}`
    : "Esta factura ya se registró en una compra";
}

/**
 * Por qué "Cargar en la compra" está deshabilitado, en español. Vacío = se puede cargar.
 * Además de las líneas pendientes exige proveedor confirmado, al menos una línea,
 * aceptar la anomalía de dólares y una tasa (salvo dólares aceptados, que ya son REF).
 */
export function getInvoiceReviewBlockers(state: InvoiceReviewState): string[] {
  const blockers: string[] = [];
  if (state.confirmedPurchase) {
    blockers.push(confirmedPurchaseMessage(state.confirmedPurchase) + ".");
  }
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
