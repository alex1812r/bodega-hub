import { ApiError } from "@/lib/api/apiError";
import {
  escapeIlike,
  isUnsearchableSearchTerm,
  normalizeProductSearch,
} from "@/modules/products/services/productSearch";
import type { StockMovementType } from "@/shared/mocks/erp-data";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

/** Todos los tipos de movimiento; el `Record` obliga a que no falte ninguno. */
const STOCK_MOVEMENT_TYPE_SET: Record<StockMovementType, true> = {
  ajuste_entrada: true,
  ajuste_salida: true,
  compra: true,
  conversion_entrada: true,
  conversion_salida: true,
  devolucion_cliente: true,
  devolucion_proveedor: true,
  inventario_inicial: true,
  venta: true,
};

const STOCK_MOVEMENT_TYPES: readonly string[] = Object.keys(STOCK_MOVEMENT_TYPE_SET);

/** Documento al que está ligado un movimiento. */
export type MovementDocumentKind = "compra" | "conversion" | "venta";

/** Valores del filtro `documentKind`; `sin_documento` = los tres vínculos vacíos. */
export const MOVEMENT_DOCUMENT_KIND_FILTERS = [
  "venta",
  "compra",
  "conversion",
  "sin_documento",
] as const;

export type MovementDocumentKindFilter = (typeof MOVEMENT_DOCUMENT_KIND_FILTERS)[number];

/**
 * Filtros exactos de movimientos y kardex: se rechazan con 400 si son demasiado
 * largos o traen caracteres de control (`assertListFilterParams`).
 */
export const MOVEMENT_EXACT_FILTERS = ["productId", "saleId", "purchaseId"] as const;

/** Filtros del kardex (`/api/inventory/stock-card`). */
export type StockCardListFilters = {
  from?: string;
  productId?: string;
  to?: string;
  type?: StockMovementType;
};

/** Filtros del listado de movimientos (`/api/inventory/movements`). */
export type InventoryMovementListFilters = StockCardListFilters & {
  /** Texto parcial del número de venta o de compra, ya normalizado. */
  document?: string;
  documentKind?: MovementDocumentKindFilter;
  /**
   * Llegó `document` pero no deja nada que buscar (solo comodines o caracteres
   * de control): el listado responde vacío en vez de devolverlo todo.
   */
  documentUnsearchable: boolean;
  purchaseId?: string;
  saleId?: string;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Un parámetro vacío (`type=`) cuenta como ausente. */
function readParam(searchParams: URLSearchParams, name: string) {
  return searchParams.get(name) || undefined;
}

function readDateParam(searchParams: URLSearchParams, name: "from" | "to") {
  const value = readParam(searchParams, name);

  if (value !== undefined && !isCalendarDate(value)) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `La fecha "${name}" no es válida. Usa el formato AAAA-MM-DD.`,
    );
  }

  return value;
}

function readMovementType(searchParams: URLSearchParams) {
  const value = readParam(searchParams, "type");

  if (value !== undefined && !STOCK_MOVEMENT_TYPES.includes(value)) {
    throw new ApiError(400, "BAD_REQUEST", "El tipo de movimiento no es válido.");
  }

  return value as StockMovementType | undefined;
}

function readDocumentKind(searchParams: URLSearchParams) {
  const value = readParam(searchParams, "documentKind");

  if (
    value !== undefined &&
    !(MOVEMENT_DOCUMENT_KIND_FILTERS as readonly string[]).includes(value)
  ) {
    throw new ApiError(400, "BAD_REQUEST", "El tipo de documento no es válido.");
  }

  return value as MovementDocumentKindFilter | undefined;
}

/**
 * Filtros del kardex: producto, tipo y rango de días de Caracas. Responde 400 a
 * un tipo desconocido, una fecha mal formada o un rango invertido.
 */
export function parseStockCardFilters(searchParams: URLSearchParams): StockCardListFilters {
  const from = readDateParam(searchParams, "from");
  const to = readDateParam(searchParams, "to");

  if (from && to && from > to) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "La fecha inicial no puede ser posterior a la final.",
    );
  }

  return {
    from,
    productId: readParam(searchParams, "productId"),
    to,
    type: readMovementType(searchParams),
  };
}

/** Filtros del listado de movimientos: los del kardex más los de documento. */
export function parseInventoryMovementFilters(
  searchParams: URLSearchParams,
): InventoryMovementListFilters {
  const rawDocument = searchParams.get("document");

  return {
    ...parseStockCardFilters(searchParams),
    document: normalizeProductSearch(rawDocument) || undefined,
    documentKind: readDocumentKind(searchParams),
    documentUnsearchable: isUnsearchableSearchTerm(rawDocument),
    purchaseId: readParam(searchParams, "purchaseId"),
    saleId: readParam(searchParams, "saleId"),
  };
}

type MovementDocumentLinks = {
  conversionId?: string | null;
  purchaseId?: string | null;
  saleId?: string | null;
};

/** Documento de un movimiento según sus vínculos; `null` si no tiene ninguno. */
export function resolveMovementDocumentKind(
  movement: MovementDocumentLinks,
): MovementDocumentKind | null {
  if (movement.saleId) {
    return "venta";
  }

  if (movement.purchaseId) {
    return "compra";
  }

  return movement.conversionId ? "conversion" : null;
}

/** Patrón `ilike` de PostgREST para buscar `term` dentro de un número de documento. */
export function buildDocumentNumberPattern(term: string) {
  return `%${escapeIlike(term)}%`;
}

/**
 * Lo mismo que `ilike` con `buildDocumentNumberPattern`, para el mock: contiene
 * el término sin distinguir mayúsculas, y cada carácter que `escapeIlike` cambia
 * por `_` casa con un carácter cualquiera.
 */
export function matchesDocumentNumber(documentNumber: string | null | undefined, term: string) {
  if (!documentNumber) {
    return false;
  }

  const source = Array.from(escapeIlike(term))
    .map((char) => (char === "_" ? "." : char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")))
    .join("");

  return new RegExp(source, "isu").test(documentNumber);
}

/** Filtros del kardex sobre un movimiento ya mapeado (mock). */
export function matchesStockCardFilters(
  movement: { createdAt: string; productId: string; type: StockMovementType },
  filters: StockCardListFilters,
) {
  if (filters.productId && movement.productId !== filters.productId) {
    return false;
  }

  if (filters.type && movement.type !== filters.type) {
    return false;
  }

  return isUtcTimestampInCaracasDateRange(movement.createdAt, filters.from, filters.to);
}

/**
 * Todos los filtros del listado sobre un movimiento ya mapeado (mock).
 * `documentNumber` es el número de su venta o compra, ya resuelto.
 */
export function matchesInventoryMovementFilters(
  movement: MovementDocumentLinks & {
    createdAt: string;
    documentNumber?: string | null;
    productId: string;
    type: StockMovementType;
  },
  filters: InventoryMovementListFilters,
) {
  if (filters.documentUnsearchable || !matchesStockCardFilters(movement, filters)) {
    return false;
  }

  if (filters.saleId && movement.saleId !== filters.saleId) {
    return false;
  }

  if (filters.purchaseId && movement.purchaseId !== filters.purchaseId) {
    return false;
  }

  if (filters.documentKind) {
    const matchesKind =
      filters.documentKind === "sin_documento"
        ? !movement.saleId && !movement.purchaseId && !movement.conversionId
        : filters.documentKind === "venta"
          ? Boolean(movement.saleId)
          : filters.documentKind === "compra"
            ? Boolean(movement.purchaseId)
            : Boolean(movement.conversionId);

    if (!matchesKind) {
      return false;
    }
  }

  return !filters.document || matchesDocumentNumber(movement.documentNumber, filters.document);
}
