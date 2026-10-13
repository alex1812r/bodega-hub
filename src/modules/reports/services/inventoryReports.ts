import { inclusiveIsoDayCount } from "@bodega/core/dashboard";

import { ApiError } from "@/lib/api/apiError";
import { parsePagination, type PaginatedList } from "@/lib/api/pagination";
import type { Permission } from "@/shared/auth/permissions";
import type { StockMovementType } from "@/shared/mocks/erp-data";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";
import { roundMoney } from "@/shared/utils/currency";

import {
  isoDaysBetween,
  parseMoneyReportRange,
  ratioPct,
  type MoneyReportRange,
} from "./moneyReports";
import {
  buildReportSeries,
  parseReportSeriesParams,
  resolveAutoGroupBy,
  type ReportGroupBy,
  type ReportSeriesBucket,
} from "./reportSeries";

/**
 * Reportes de inventario (REP-07): tipos de respuesta y lógica pura compartida
 * por el servidor (`inventoryReports.server.ts`, vistas `report_*` del parche
 * `20261013b`) y el mock (`inventoryReports.mock-server.ts`).
 *
 * Los tres se calculan sobre el libro `stock_movements` en su orden real
 * (`seq`); nunca leen `stock_after`. Todas las fechas son días operativos de
 * Caracas (`yyyy-mm-dd`). Ninguno desglosa por usuario ni por vendedor.
 */

export const INVENTORY_REPORT_SLUGS = ["dead-stock", "stock-turnover", "stock-adjustments"] as const;

export type InventoryReportSlug = (typeof INVENTORY_REPORT_SLUGS)[number];

function badRequest(message: string) {
  return new ApiError(400, "BAD_REQUEST", message);
}

function blankToUndefined(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function inventoryProductHref(productId: string) {
  return `/products/${productId}`;
}

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

/**
 * Los tres reportes exigen `reports.view` (lo pide la ruta) y además
 * `inventory.view`, el permiso de `GET /api/inventory/kardex` y del resto de
 * lecturas del libro: se aplica el más restrictivo de los dos módulos.
 *
 * Con los roles por defecto solo los ve admin: contador tiene `reports.view`
 * pero no `inventory.view`; almacén, al revés; vendedor, ninguno.
 */
export function assertInventoryReportAccess(auth: { permissions: readonly Permission[] }) {
  const has = (permission: Permission) => auth.permissions.includes(permission);

  if (!has("reports.view") || !has("inventory.view")) {
    throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
  }
}

// ---------------------------------------------------------------------------
// Clasificación de movimientos (la de Inventario y las vistas de integridad)
// ---------------------------------------------------------------------------

type LedgerMovementLinks = {
  purchaseId?: string | null;
  saleId?: string | null;
  type: StockMovementType;
};

/**
 * Salida por venta o su reversión: `venta`, `devolucion_cliente` y el
 * `ajuste_entrada` ligado a una venta (lo que deja anular o devolver la venta).
 * Las unidades vendidas netas son `-Σ quantityDelta` de estos movimientos.
 */
export function isSaleLedgerMovement(movement: LedgerMovementLinks) {
  return (
    movement.type === "venta" ||
    movement.type === "devolucion_cliente" ||
    (movement.type === "ajuste_entrada" && Boolean(movement.saleId))
  );
}

/**
 * Ajuste manual: `ajuste_entrada` / `ajuste_salida` sin venta ni compra. La
 * merma no es un tipo propio (es un `ajuste_salida` con su motivo). Quedan
 * fuera las reversiones de documentos, el inventario inicial y las aperturas de
 * empaque (`conversion_*`, tipo propio de Inventario).
 */
export function isManualAdjustmentMovement(movement: LedgerMovementLinks) {
  return (
    (movement.type === "ajuste_entrada" || movement.type === "ajuste_salida") &&
    !movement.saleId &&
    !movement.purchaseId
  );
}

export const NO_REASON_LABEL = "Sin motivo";

/** Motivo sin espacios sobrantes; `Sin motivo` si viene vacío. */
export function normalizeAdjustmentReason(reason: string | null | undefined) {
  return (reason ?? "").replace(/\s+/g, " ").trim() || NO_REASON_LABEL;
}

// ---------------------------------------------------------------------------
// Producto con su saldo y sus fechas del libro (`report_product_last_movement`)
// ---------------------------------------------------------------------------

export type ProductLedgerRow = {
  categoryId: string | null;
  categoryName: string;
  /** `current_cost_ref`: ya incluye IVA. */
  costRef: number;
  /**
   * Día Caracas desde el que el producto está sin vender: el de su última
   * venta; si nunca se vendió, el de su primer movimiento; sin movimientos, el
   * de su alta.
   */
  idleSince: string;
  isActive: boolean;
  lastMovementAt: string | null;
  lastSaleAt: string | null;
  name: string;
  productId: string;
  sku: string;
  /** Saldo vigente (el de Inventario). */
  stock: number;
  /** `stock × costRef`, a dos decimales. */
  stockValueRef: number;
};

export type InventoryReportProduct = { href: string; id: string; name: string; sku: string };

export type InventoryReportCategory = { id: string | null; name: string };

function toReportProduct(row: ProductLedgerRow): InventoryReportProduct {
  return { href: inventoryProductHref(row.productId), id: row.productId, name: row.name, sku: row.sku };
}

function compareText(first: string, second: string) {
  return first < second ? -1 : first > second ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 1. Productos sin movimiento (capital inmovilizado)
// ---------------------------------------------------------------------------

export const DEAD_STOCK_DEFAULT_DAYS = 30;
export const DEAD_STOCK_MAX_DAYS = 3650;

const CATEGORY_ID_MAX_LENGTH = 120;

export type DeadStockQuery = {
  categoryId?: string;
  /** Días sin vender a partir de los que un producto entra en el reporte. */
  days: number;
  limit: number;
  skip: number;
};

/** `days` (entero 1–3650, 30 por defecto), `categoryId`, `skip` y `limit`. */
export function parseDeadStockQuery(searchParams: URLSearchParams): DeadStockQuery {
  const rawDays = blankToUndefined(searchParams.get("days"));
  const categoryId = blankToUndefined(searchParams.get("categoryId"));
  let days = DEAD_STOCK_DEFAULT_DAYS;

  if (rawDays !== undefined) {
    days = /^\d{1,5}$/.test(rawDays) ? Number(rawDays) : Number.NaN;

    if (!Number.isInteger(days) || days < 1 || days > DEAD_STOCK_MAX_DAYS) {
      throw badRequest(
        `Los días sin movimiento deben ser un número entero entre 1 y ${DEAD_STOCK_MAX_DAYS}.`,
      );
    }
  }

  if (categoryId !== undefined && categoryId.length > CATEGORY_ID_MAX_LENGTH) {
    throw badRequest("La categoría no es válida.");
  }

  return { ...parsePagination(searchParams), ...(categoryId ? { categoryId } : {}), days };
}

export type DeadStockRow = {
  category: InventoryReportCategory;
  costRef: number;
  /** Días de calendario Caracas desde `idleSince` hasta hoy. */
  daysIdle: number;
  /** Días desde el último movimiento de cualquier tipo; `null` sin movimientos. */
  daysSinceLastMovement: number | null;
  idleSince: string;
  lastMovementAt: string | null;
  /** `null` = nunca se vendió: cuenta desde su primer movimiento o su alta. */
  lastSaleAt: string | null;
  product: InventoryReportProduct;
  stock: number;
  /** Valor inmovilizado: `stock × costRef`. */
  stockValueRef: number;
};

export type DeadStockSummary = {
  /** Valor inmovilizado de todos los productos sin movimiento. */
  idleValueRef: number;
  /** `idleValueRef / inventoryValueRef × 100`; `null` si el inventario vale 0. */
  idleValuePct: number | null;
  /** Valor a costo de los productos activos con stock (misma categoría si se filtra). */
  inventoryValueRef: number;
  productsCount: number;
};

export type DeadStockReport = PaginatedList<DeadStockRow> & {
  /** Día operativo Caracas desde el que se cuentan los días. */
  asOf: string;
  days: number;
  /** Sobre todo el conjunto: no depende de la página. */
  summary: DeadStockSummary;
};

/**
 * `rows`: todos los productos de la tienda. Entran los activos con stock > 0
 * (y de `categoryId`, si se pide) cuyo `idleSince` tiene al menos `days` días,
 * de mayor a menor valor inmovilizado (`id` de desempate).
 */
export function buildDeadStockReport(input: {
  query: DeadStockQuery;
  rows: readonly ProductLedgerRow[];
  today: string;
}): DeadStockReport {
  const { query, rows, today } = input;
  const inventory = rows.filter(
    (row) =>
      row.isActive && row.stock > 0 && (!query.categoryId || row.categoryId === query.categoryId),
  );
  const idle = inventory
    .map((row) => ({ daysIdle: isoDaysBetween(row.idleSince, today), row }))
    .filter(({ daysIdle }) => daysIdle >= query.days)
    .sort(
      (first, second) =>
        second.row.stockValueRef - first.row.stockValueRef ||
        compareText(first.row.productId, second.row.productId),
    );
  const idleValueRef = roundMoney(idle.reduce((sum, { row }) => sum + row.stockValueRef, 0));
  const inventoryValueRef = roundMoney(inventory.reduce((sum, row) => sum + row.stockValueRef, 0));

  return {
    asOf: today,
    days: query.days,
    items: idle.slice(query.skip, query.skip + query.limit).map(({ daysIdle, row }) => ({
      category: { id: row.categoryId, name: row.categoryName },
      costRef: row.costRef,
      daysIdle,
      daysSinceLastMovement:
        row.lastMovementAt === null ? null : isoDaysBetween(toCaracasDateKey(row.lastMovementAt), today),
      idleSince: row.idleSince,
      lastMovementAt: row.lastMovementAt,
      lastSaleAt: row.lastSaleAt,
      product: toReportProduct(row),
      stock: row.stock,
      stockValueRef: row.stockValueRef,
    })),
    limit: query.limit,
    skip: query.skip,
    summary: {
      idleValuePct: ratioPct(idleValueRef, inventoryValueRef),
      idleValueRef,
      inventoryValueRef,
      productsCount: idle.length,
    },
    total: idle.length,
  };
}

// ---------------------------------------------------------------------------
// 2. Rotación por producto y por categoría
// ---------------------------------------------------------------------------

export const STOCK_TURNOVER_GROUP_BY_VALUES = ["product", "category"] as const;

export type StockTurnoverGroupBy = (typeof STOCK_TURNOVER_GROUP_BY_VALUES)[number];

export type StockTurnoverQuery = MoneyReportRange & {
  groupBy: StockTurnoverGroupBy;
  limit: number;
  skip: number;
};

/** `from` y `to` obligatorios, `groupBy` (product | category; product por defecto), `skip` y `limit`. */
export function parseStockTurnoverQuery(searchParams: URLSearchParams): StockTurnoverQuery {
  // El rango se valida sin `groupBy`: el validador de series solo conoce day | week | month.
  const rangeParams = new URLSearchParams(searchParams);
  rangeParams.delete("groupBy");
  const range = parseMoneyReportRange(rangeParams);
  const groupBy = blankToUndefined(searchParams.get("groupBy")) ?? "product";

  if (!(STOCK_TURNOVER_GROUP_BY_VALUES as readonly string[]).includes(groupBy)) {
    throw badRequest("La agrupación no es válida. Usa product o category.");
  }

  return { ...parsePagination(searchParams), ...range, groupBy: groupBy as StockTurnoverGroupBy };
}

/** Una fila de `report_stock_daily_flow`: el libro de un producto en un día Caracas. */
export type StockFlowRow = {
  /** Costo de lo vendido neto del día (costo de la línea de venta). */
  cogsRef: number;
  day: string;
  /** Σ `quantityDelta` de todos los movimientos del día. */
  netDelta: number;
  productId: string;
  /** Unidades vendidas netas de reversiones. */
  soldUnits: number;
};

export type StockTurnoverMeasures = {
  /**
   * Valor a costo del inventario promedio del rango: `(openingStock +
   * closingStock) / 2 × costo actual`.
   */
  averageStockValueRef: number;
  /** Saldo al cierre del último día del rango, reconstruido del libro. */
  closingStock: number;
  /** Costo de lo vendido neto de devoluciones en el rango. */
  cogsRef: number;
  /** `días del rango / rotación`; `null` si la rotación es 0, negativa o no se puede calcular. */
  daysOfInventory: number | null;
  /** Saldo antes del primer día del rango, reconstruido del libro. */
  openingStock: number;
  /** Unidades vendidas netas de devoluciones y anulaciones en el rango. */
  soldUnits: number;
  /** Saldo vigente. */
  stock: number;
  /** Valor a costo del saldo vigente. */
  stockValueRef: number;
  /** `cogsRef / averageStockValueRef`; `null` si el inventario promedio no vale nada. */
  turnover: number | null;
};

export type StockTurnoverRow = StockTurnoverMeasures & {
  category: InventoryReportCategory;
  /** Id del producto o de la categoría (`""` = sin categoría). */
  key: string;
  /** `null` cuando se agrupa por categoría. */
  product: InventoryReportProduct | null;
  /** Productos que suma la fila (1 por producto). */
  productsCount: number;
};

export type StockTurnoverReport = PaginatedList<StockTurnoverRow> & {
  groupBy: StockTurnoverGroupBy;
  /**
   * El inventario del divisor es el promedio de los saldos de apertura y cierre
   * del rango (reconstruidos sumando el libro), valorado al costo actual.
   */
  inventoryBasis: "average_opening_closing";
  range: MoneyReportRange;
  rangeDays: number;
  /** Suma de todos los productos del reporte: no depende de la página ni de `groupBy`. */
  totals: StockTurnoverMeasures;
};

type TurnoverSums = Omit<StockTurnoverMeasures, "daysOfInventory" | "turnover">;

function withTurnover(sums: TurnoverSums, rangeDays: number): StockTurnoverMeasures {
  const averageStockValueRef = roundMoney(sums.averageStockValueRef);
  const cogsRef = roundMoney(sums.cogsRef);
  const computable = averageStockValueRef > 0;
  const turnover = computable ? roundMoney(cogsRef / averageStockValueRef) : null;
  const daysOfInventory =
    computable && cogsRef > 0 ? roundMoney((rangeDays * averageStockValueRef) / cogsRef) : null;

  return {
    averageStockValueRef,
    closingStock: sums.closingStock,
    cogsRef,
    daysOfInventory: daysOfInventory !== null && Number.isFinite(daysOfInventory) ? daysOfInventory : null,
    openingStock: sums.openingStock,
    soldUnits: sums.soldUnits,
    stock: sums.stock,
    stockValueRef: roundMoney(sums.stockValueRef),
    turnover: turnover !== null && Number.isFinite(turnover) ? turnover : null,
  };
}

function emptyTurnoverSums(): TurnoverSums {
  return {
    averageStockValueRef: 0,
    closingStock: 0,
    cogsRef: 0,
    openingStock: 0,
    soldUnits: 0,
    stock: 0,
    stockValueRef: 0,
  };
}

function addTurnoverSums(target: TurnoverSums, source: TurnoverSums) {
  target.averageStockValueRef += source.averageStockValueRef;
  target.closingStock += source.closingStock;
  target.cogsRef += source.cogsRef;
  target.openingStock += source.openingStock;
  target.soldUnits += source.soldUnits;
  target.stock += source.stock;
  target.stockValueRef += source.stockValueRef;
}

/**
 * `products`: todos los productos de la tienda. `flow`: el libro por día desde
 * `query.from` hasta hoy (los días posteriores a `query.to` solo sirven para
 * reconstruir el saldo de cierre). Entra en el reporte todo producto con ventas
 * en el rango o con saldo al abrir o al cerrar. Orden: rotación descendente
 * (sin rotación al final), costo de lo vendido descendente y clave.
 */
export function buildStockTurnoverReport(input: {
  flow: readonly StockFlowRow[];
  products: readonly ProductLedgerRow[];
  query: StockTurnoverQuery;
}): StockTurnoverReport {
  const { flow, products, query } = input;
  const rangeDays = inclusiveIsoDayCount(query.from, query.to);
  const byProduct = new Map<string, { after: number; cogsRef: number; inRange: number; soldUnits: number }>();

  for (const row of flow) {
    if (row.day < query.from) {
      continue;
    }

    const sums = byProduct.get(row.productId) ?? { after: 0, cogsRef: 0, inRange: 0, soldUnits: 0 };

    if (row.day > query.to) {
      sums.after += row.netDelta;
    } else {
      sums.inRange += row.netDelta;
      sums.soldUnits += row.soldUnits;
      sums.cogsRef += row.cogsRef;
    }

    byProduct.set(row.productId, sums);
  }

  const groups = new Map<
    string,
    { category: InventoryReportCategory; product: InventoryReportProduct | null; productsCount: number; sums: TurnoverSums }
  >();
  const totals = emptyTurnoverSums();

  for (const product of products) {
    const moved = byProduct.get(product.productId) ?? { after: 0, cogsRef: 0, inRange: 0, soldUnits: 0 };
    const closingStock = product.stock - moved.after;
    const openingStock = closingStock - moved.inRange;

    if (moved.soldUnits === 0 && closingStock === 0 && openingStock === 0) {
      continue;
    }

    const sums: TurnoverSums = {
      averageStockValueRef: roundMoney(((openingStock + closingStock) / 2) * product.costRef),
      closingStock,
      cogsRef: moved.cogsRef,
      openingStock,
      soldUnits: moved.soldUnits,
      stock: product.stock,
      stockValueRef: product.stockValueRef,
    };
    const key = query.groupBy === "product" ? product.productId : (product.categoryId ?? "");
    const group = groups.get(key) ?? {
      category: { id: product.categoryId, name: product.categoryName },
      product: query.groupBy === "product" ? toReportProduct(product) : null,
      productsCount: 0,
      sums: emptyTurnoverSums(),
    };

    group.productsCount += 1;
    addTurnoverSums(group.sums, sums);
    addTurnoverSums(totals, sums);
    groups.set(key, group);
  }

  const rows: StockTurnoverRow[] = [...groups.entries()]
    .map(([key, group]) => ({
      ...withTurnover(group.sums, rangeDays),
      category: group.category,
      key,
      product: group.product,
      productsCount: group.productsCount,
    }))
    .sort(
      (first, second) =>
        (second.turnover ?? Number.NEGATIVE_INFINITY) - (first.turnover ?? Number.NEGATIVE_INFINITY) ||
        second.cogsRef - first.cogsRef ||
        compareText(first.key, second.key),
    );

  return {
    groupBy: query.groupBy,
    inventoryBasis: "average_opening_closing",
    items: rows.slice(query.skip, query.skip + query.limit),
    limit: query.limit,
    range: { from: query.from, to: query.to },
    rangeDays,
    skip: query.skip,
    total: rows.length,
    totals: withTurnover(totals, rangeDays),
  };
}

// ---------------------------------------------------------------------------
// 3. Ajustes y mermas por motivo y periodo
// ---------------------------------------------------------------------------

export type StockAdjustmentsQuery = MoneyReportRange & {
  /** `null` = automática según el nº de días del rango. */
  groupBy: ReportGroupBy | null;
  limit: number;
  skip: number;
};

/** `from` y `to` obligatorios, `groupBy` (day | week | month | auto), `skip` y `limit`. */
export function parseStockAdjustmentsQuery(searchParams: URLSearchParams): StockAdjustmentsQuery {
  const range = parseMoneyReportRange(searchParams);
  const { groupBy } = parseReportSeriesParams(searchParams);

  return { ...parsePagination(searchParams), ...range, groupBy };
}

/**
 * De dónde sale el costo con el que se valora un ajuste. El libro no guarda el
 * costo del movimiento: se usa el `current_cost_ref` ACTUAL del producto.
 */
export type StockAdjustmentCostBasis = "current_cost";

/** Una fila de `report_stock_adjustments`: un ajuste manual del libro. */
export type StockAdjustmentInput = {
  createdAt: string;
  /** Día operativo Caracas del movimiento. */
  date: string;
  movementId: string;
  productId: string;
  productName: string;
  quantityDelta: number;
  /** Ya normalizado (`normalizeAdjustmentReason`). */
  reason: string;
  /** Posición en el libro: el orden real de los movimientos. */
  seq: number;
  sku: string;
  type: "ajuste_entrada" | "ajuste_salida";
  unitCostRef: number;
  /** `quantityDelta × unitCostRef`, con su signo. */
  valueRef: number;
};

export type StockAdjustmentMeasures = {
  movementsCount: number;
  /** `unitsIn - unitsOut`. */
  netUnits: number;
  /** `valueInRef - valueOutRef`. */
  netValueRef: number;
  /** Unidades que entraron (positivo). */
  unitsIn: number;
  /** Unidades que salieron (positivo). */
  unitsOut: number;
  valueInRef: number;
  /** Valor a costo de lo que salió (positivo). */
  valueOutRef: number;
};

export type StockAdjustmentReasonSummary = StockAdjustmentMeasures & { reason: string };

export type StockAdjustmentRow = {
  createdAt: string;
  date: string;
  movementId: string;
  product: InventoryReportProduct;
  /** Con su signo: negativo = salida. */
  quantityDelta: number;
  reason: string;
  type: "ajuste_entrada" | "ajuste_salida";
  unitCostRef: number;
  valueRef: number;
};

export type StockAdjustmentsReport = PaginatedList<StockAdjustmentRow> & {
  /** Un motivo por fila, de mayor a menor valor movido (entradas + salidas). */
  byReason: StockAdjustmentReasonSummary[];
  costBasis: StockAdjustmentCostBasis;
  /** Agrupación efectiva de `series`. */
  groupBy: ReportGroupBy;
  range: MoneyReportRange;
  /** Un periodo por posición, sin huecos (los periodos sin ajustes van en 0). */
  series: ReportSeriesBucket<StockAdjustmentMeasures>[];
  /** Todo el rango: no depende de la página. */
  totals: StockAdjustmentMeasures;
};

const ADJUSTMENT_MEASURES = [
  "movementsCount",
  "netUnits",
  "netValueRef",
  "unitsIn",
  "unitsOut",
  "valueInRef",
  "valueOutRef",
] as const;

function emptyAdjustmentMeasures(): StockAdjustmentMeasures {
  return {
    movementsCount: 0,
    netUnits: 0,
    netValueRef: 0,
    unitsIn: 0,
    unitsOut: 0,
    valueInRef: 0,
    valueOutRef: 0,
  };
}

function toAdjustmentMeasures(row: StockAdjustmentInput): StockAdjustmentMeasures {
  const isEntry = row.quantityDelta > 0;

  return {
    movementsCount: 1,
    netUnits: row.quantityDelta,
    netValueRef: row.valueRef,
    unitsIn: isEntry ? row.quantityDelta : 0,
    unitsOut: isEntry ? 0 : -row.quantityDelta,
    valueInRef: isEntry ? row.valueRef : 0,
    valueOutRef: isEntry ? 0 : -row.valueRef,
  };
}

function addAdjustmentMeasures(target: StockAdjustmentMeasures, source: StockAdjustmentMeasures) {
  for (const measure of ADJUSTMENT_MEASURES) {
    target[measure] += source[measure];
  }
}

function roundAdjustmentMeasures(measures: StockAdjustmentMeasures): StockAdjustmentMeasures {
  return {
    ...measures,
    netValueRef: roundMoney(measures.netValueRef),
    valueInRef: roundMoney(measures.valueInRef),
    valueOutRef: roundMoney(measures.valueOutRef),
  };
}

/**
 * `rows`: los ajustes manuales del libro (los de fuera del rango se ignoran).
 * La lista va del movimiento más reciente al más antiguo en el orden del libro
 * (`seq`).
 */
export function buildStockAdjustmentsReport(input: {
  query: StockAdjustmentsQuery;
  rows: readonly StockAdjustmentInput[];
}): StockAdjustmentsReport {
  const { query } = input;
  const range = { from: query.from, to: query.to };
  const groupBy = query.groupBy ?? resolveAutoGroupBy(inclusiveIsoDayCount(range.from, range.to));
  const rows = input.rows
    .filter((row) => row.date >= range.from && row.date <= range.to)
    .sort((first, second) => second.seq - first.seq);
  const reasons = new Map<string, StockAdjustmentMeasures>();
  const totals = emptyAdjustmentMeasures();

  for (const row of rows) {
    const measures = toAdjustmentMeasures(row);
    const reason = reasons.get(row.reason) ?? emptyAdjustmentMeasures();

    addAdjustmentMeasures(reason, measures);
    addAdjustmentMeasures(totals, measures);
    reasons.set(row.reason, reason);
  }

  const series = buildReportSeries<StockAdjustmentMeasures>({
    measures: ADJUSTMENT_MEASURES,
    primaryMeasure: "netValueRef",
    request: { groupBy, previousRange: null, range },
    rows: rows.map((row) => ({ day: row.date, values: toAdjustmentMeasures(row) })),
  });

  return {
    byReason: [...reasons.entries()]
      .map(([reason, measures]) => ({ ...roundAdjustmentMeasures(measures), reason }))
      .sort(
        (first, second) =>
          second.valueInRef + second.valueOutRef - (first.valueInRef + first.valueOutRef) ||
          second.movementsCount - first.movementsCount ||
          compareText(first.reason, second.reason),
      ),
    costBasis: "current_cost",
    groupBy,
    items: rows.slice(query.skip, query.skip + query.limit).map((row) => ({
      createdAt: row.createdAt,
      date: row.date,
      movementId: row.movementId,
      product: {
        href: inventoryProductHref(row.productId),
        id: row.productId,
        name: row.productName,
        sku: row.sku,
      },
      quantityDelta: row.quantityDelta,
      reason: row.reason,
      type: row.type,
      unitCostRef: row.unitCostRef,
      valueRef: row.valueRef,
    })),
    limit: query.limit,
    range,
    series: series.current,
    skip: query.skip,
    total: rows.length,
    totals: roundAdjustmentMeasures(totals),
  };
}
