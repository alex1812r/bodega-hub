import { ApiError } from "@/lib/api/apiError";
import { assertListFilterParams } from "@/modules/products/services/listFilterParams";
import type { StockMovementType } from "@/shared/mocks/erp-data";
import {
  caracasDateToUtcRange,
  getCaracasIsoDate,
  shiftIsoDate,
  toCaracasDateKey,
} from "@/shared/utils/caracasBusinessDay";

import type { MovementDocumentKind } from "../utils/inventoryMovementFilters";

/** Días de Caracas de la serie, contando hoy. */
export const KARDEX_DAYS = 30;
/** Últimos movimientos que lista el kardex del producto. */
export const KARDEX_LAST_MOVEMENTS = 10;
/** Filas por página al leer los movimientos de la ventana. */
export const KARDEX_WINDOW_PAGE_SIZE = 1000;
/**
 * Tope duro de filas de la ventana que lee el BFF (5 páginas). Al alcanzarlo la
 * respuesta va con `truncated: true` y la serie solo cubre los días que se
 * leyeron completos.
 */
export const KARDEX_WINDOW_MAX_ROWS = 5000;

export type ProductKardexPoint = {
  /** Saldo al cierre del día; `null` si el día quedó fuera de lo leído (`truncated`). */
  balance: number | null;
  /** Día de Caracas `YYYY-MM-DD`. */
  date: string;
  /** Σ movimientos positivos del día; `null` si el día quedó fuera de lo leído. */
  entries: number | null;
  /** Σ |movimientos negativos| del día (positivo); `null` si el día quedó fuera de lo leído. */
  exits: number | null;
};

export type ProductKardexMovement = {
  conversionId: string | null;
  createdAt: string;
  /** `null` = sin documento: la UI lo muestra como "Ajuste manual". */
  documentKind: MovementDocumentKind | null;
  documentNumber: string | null;
  id: string;
  purchaseId: string | null;
  quantityDelta: number;
  reason: string | null;
  saleId: string | null;
  stockAfter: number;
  type: StockMovementType;
};

export type ProductKardex = {
  /** Σ entradas de los días de la serie con dato. */
  entries30d: number;
  /** Σ salidas (positivo) de los días de la serie con dato. */
  exits30d: number;
  /** Los últimos movimientos del producto, del más reciente al más antiguo. */
  lastMovements: ProductKardexMovement[];
  /** Saldo antes del primer día de la serie; `null` si `truncated`. */
  openingBalance: number | null;
  product: {
    currentStock: number;
    id: string;
    minStock: number;
    name: string;
    sku: string;
  };
  /** `KARDEX_DAYS` puntos, del día más antiguo a hoy. */
  series: ProductKardexPoint[];
  /** La ventana superó `KARDEX_WINDOW_MAX_ROWS`: los días más antiguos van sin dato. */
  truncated: boolean;
};

/** Movimiento de la ventana, con lo justo para la serie. */
export type KardexWindowRow = {
  createdAt: string;
  quantityDelta: number;
};

type ListedMovement = {
  conversionId?: string | null;
  createdAt: string;
  documentKind: MovementDocumentKind | null;
  documentNumber: string | null;
  id: string;
  purchaseId?: string | null;
  quantityDelta: number;
  reason?: string | null;
  saleId?: string | null;
  stockAfter: number;
  type: StockMovementType;
};

/**
 * `productId` de la consulta. Ausente o vacío → 400; demasiado largo o con
 * caracteres de control → 400 (`assertListFilterParams`).
 */
export function readKardexProductId(searchParams: URLSearchParams) {
  assertListFilterParams(searchParams, ["productId"]);

  const productId = searchParams.get("productId")?.trim();

  if (!productId) {
    throw new ApiError(400, "BAD_REQUEST", "Indica el producto del kardex.");
  }

  return productId;
}

/** Los `KARDEX_DAYS` días de Caracas de la serie y el instante UTC en que empieza el primero. */
export function getKardexWindow(now: Date = new Date()) {
  const today = getCaracasIsoDate(now);
  const dates = Array.from({ length: KARDEX_DAYS }, (_, index) =>
    shiftIsoDate(today, index - (KARDEX_DAYS - 1)),
  );

  return { dates, startUtc: caracasDateToUtcRange(dates[0]).startUtc, today };
}

/** Un movimiento del listado (`listStockMovements`) con solo lo que muestra el kardex. */
export function toKardexMovement(movement: ListedMovement): ProductKardexMovement {
  return {
    conversionId: movement.conversionId ?? null,
    createdAt: movement.createdAt,
    documentKind: movement.documentKind,
    documentNumber: movement.documentNumber,
    id: movement.id,
    purchaseId: movement.purchaseId ?? null,
    quantityDelta: movement.quantityDelta,
    reason: movement.reason ?? null,
    saleId: movement.saleId ?? null,
    stockAfter: movement.stockAfter,
    type: movement.type,
  };
}

/**
 * Serie diaria del kardex.
 *
 * El saldo se reconstruye hacia atrás desde `currentStock`: el cierre de hoy es
 * el stock actual y el de cada día anterior resta los movimientos del día
 * siguiente. Se prefiere al `stock_after` del último movimiento del día porque
 * (a) cuadra siempre con las entradas y salidas que se muestran al lado,
 * (b) coincide con el stock actual de la ficha aunque el producto arrastre un
 * descuadre histórico entre `current_stock` y el libro, y (c) no depende del
 * orden: un movimiento fechado antes de lo que se registró lleva el
 * `stock_after` de la cadena (`seq`), no el del día al que pertenece.
 *
 * `rows` llega del más reciente al más antiguo por fecha. Si `truncated`, el
 * día de la última fila pudo quedar a medias: ese día y los anteriores van sin
 * dato. Un movimiento fechado después de hoy (reloj adelantado) cuenta en hoy.
 */
export function buildKardexSeries(params: {
  currentStock: number;
  dates: string[];
  rows: KardexWindowRow[];
  truncated: boolean;
}) {
  const { currentStock, dates, rows, truncated } = params;
  const today = dates[dates.length - 1];
  const totalsByDay = new Map<string, { entries: number; exits: number }>();

  const dayOf = (row: KardexWindowRow) => {
    const day = toCaracasDateKey(row.createdAt);

    return day > today ? today : day;
  };

  for (const row of rows) {
    const day = dayOf(row);
    const totals = totalsByDay.get(day) ?? { entries: 0, exits: 0 };

    if (row.quantityDelta > 0) {
      totals.entries += row.quantityDelta;
    } else {
      totals.exits -= row.quantityDelta;
    }

    totalsByDay.set(day, totals);
  }

  const lastRow = rows[rows.length - 1];
  const firstUnreadDay = truncated && lastRow ? dayOf(lastRow) : null;
  const series: ProductKardexPoint[] = [];
  let balance = currentStock;
  let entries30d = 0;
  let exits30d = 0;

  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const date = dates[index];

    if (firstUnreadDay !== null && date <= firstUnreadDay) {
      series.unshift({ balance: null, date, entries: null, exits: null });
      continue;
    }

    const { entries, exits } = totalsByDay.get(date) ?? { entries: 0, exits: 0 };

    series.unshift({ balance, date, entries, exits });
    entries30d += entries;
    exits30d += exits;
    balance -= entries - exits;
  }

  return { entries30d, exits30d, openingBalance: truncated ? null : balance, series };
}
