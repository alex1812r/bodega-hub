import { getCaracasIsoDate } from "@bodega/core/dates";

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  buildDeadStockReport,
  buildStockAdjustmentsReport,
  buildStockTurnoverReport,
  type DeadStockQuery,
  type DeadStockReport,
  type ProductLedgerRow,
  type StockAdjustmentInput,
  type StockAdjustmentsQuery,
  type StockAdjustmentsReport,
  type StockFlowRow,
  type StockTurnoverQuery,
  type StockTurnoverReport,
} from "./inventoryReports";
import { fetchAllRows } from "./reportPagination";

/**
 * Reportes de inventario (REP-07) sobre las vistas `report_*` del parche
 * `20261013b`, que calculan sobre el libro `stock_movements`. Solo lectura,
 * con la sesión del usuario: las vistas son `security_invoker`, así que mandan
 * las RLS de las tablas base. `storeId` llega siempre del servidor (contexto de
 * autenticación de la ruta).
 *
 * Cada reporte lee su conjunto completo (por páginas de PostgREST) porque el
 * resumen, los totales y el orden se calculan sobre todas las filas; la página
 * que se responde se corta después.
 */

type Numeric = number | string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Productos con su saldo y sus fechas del libro
// ---------------------------------------------------------------------------

const PRODUCT_LEDGER_COLUMNS =
  "product_id, sku, name, is_active, category_id, category_name, stock, cost_ref, stock_value_ref, last_sale_at, last_movement_at, idle_since";

type DbProductLedgerRow = {
  category_id: string | null;
  category_name: string;
  cost_ref: Numeric;
  idle_since: string;
  is_active: boolean;
  last_movement_at: string | null;
  last_sale_at: string | null;
  name: string;
  product_id: string;
  sku: string;
  stock: Numeric;
  stock_value_ref: Numeric;
};

/** Productos de la tienda; con `inventory`, solo los activos con stock (y de esa categoría). */
async function readProductLedger(
  storeId: string,
  inventory?: { categoryId?: string },
): Promise<ProductLedgerRow[]> {
  const supabase = await createRouteSupabaseClient();
  const rows = await fetchAllRows<DbProductLedgerRow>(
    async (from, to) => {
      let products = supabase
        .from("report_product_last_movement")
        .select(PRODUCT_LEDGER_COLUMNS, { count: "exact" })
        .eq("store_id", storeId);

      if (inventory) {
        products = products.eq("is_active", true).gt("stock", 0);
      }

      if (inventory?.categoryId) {
        products = products.eq("category_id", inventory.categoryId);
      }

      const { count, data, error, status } = await products
        .order("product_id", { ascending: true })
        .range(from, to);

      return { count, data: data as unknown as DbProductLedgerRow[] | null, error, status };
    },
    { getKey: (row) => row.product_id },
  );

  return rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    costRef: Number(row.cost_ref),
    idleSince: row.idle_since,
    isActive: row.is_active,
    lastMovementAt: row.last_movement_at,
    lastSaleAt: row.last_sale_at,
    name: row.name,
    productId: row.product_id,
    sku: row.sku,
    stock: Number(row.stock),
    stockValueRef: Number(row.stock_value_ref),
  }));
}

// ---------------------------------------------------------------------------
// 1. Productos sin movimiento
// ---------------------------------------------------------------------------

/** `today`: día operativo Caracas desde el que se cuentan los días. */
export async function getDeadStockReport(
  query: DeadStockQuery,
  storeId: string,
  today: string = getCaracasIsoDate(),
): Promise<DeadStockReport> {
  // `category_id` es uuid: un id que no lo es no puede tener productos.
  const rows =
    query.categoryId !== undefined && !UUID.test(query.categoryId)
      ? []
      : await readProductLedger(storeId, { categoryId: query.categoryId });

  return buildDeadStockReport({ query, rows, today });
}

// ---------------------------------------------------------------------------
// 2. Rotación
// ---------------------------------------------------------------------------

type DbStockFlowRow = {
  cogs_ref: Numeric;
  movement_date: string;
  net_delta: Numeric;
  product_id: string;
  sold_units: Numeric;
};

/**
 * Lee el libro por día desde `query.from` hasta hoy: los días del rango dan lo
 * vendido y los posteriores permiten reconstruir el saldo de cierre restando
 * del saldo vigente.
 */
export async function getStockTurnoverReport(
  query: StockTurnoverQuery,
  storeId: string,
): Promise<StockTurnoverReport> {
  const supabase = await createRouteSupabaseClient();
  const [products, flow] = await Promise.all([
    readProductLedger(storeId),
    // (movement_date, product_id) es único por tienda: orden estable entre páginas.
    fetchAllRows<DbStockFlowRow>(
      async (from, to) => {
        const { count, data, error, status } = await supabase
          .from("report_stock_daily_flow")
          .select("movement_date, product_id, net_delta, sold_units, cogs_ref", { count: "exact" })
          .eq("store_id", storeId)
          .gte("movement_date", query.from)
          .order("movement_date", { ascending: true })
          .order("product_id", { ascending: true })
          .range(from, to);

        return { count, data: data as unknown as DbStockFlowRow[] | null, error, status };
      },
      { getKey: (row) => `${row.movement_date}|${row.product_id}` },
    ),
  ]);

  return buildStockTurnoverReport({
    flow: flow.map(
      (row): StockFlowRow => ({
        cogsRef: Number(row.cogs_ref),
        day: row.movement_date,
        netDelta: Number(row.net_delta),
        productId: row.product_id,
        soldUnits: Number(row.sold_units),
      }),
    ),
    products,
    query,
  });
}

// ---------------------------------------------------------------------------
// 3. Ajustes y mermas
// ---------------------------------------------------------------------------

type DbStockAdjustmentRow = {
  created_at: string;
  movement_date: string;
  movement_id: string;
  movement_type: StockAdjustmentInput["type"];
  product_id: string;
  product_name: string;
  quantity_delta: Numeric;
  reason: string;
  seq: Numeric;
  sku: string;
  unit_cost_ref: Numeric;
  value_ref: Numeric;
};

export async function getStockAdjustmentsReport(
  query: StockAdjustmentsQuery,
  storeId: string,
): Promise<StockAdjustmentsReport> {
  const supabase = await createRouteSupabaseClient();
  // `seq` es único en el libro: orden estable entre páginas.
  const rows = await fetchAllRows<DbStockAdjustmentRow>(
    async (from, to) => {
      const { count, data, error, status } = await supabase
        .from("report_stock_adjustments")
        .select(
          "movement_id, seq, created_at, movement_date, product_id, sku, product_name, movement_type, quantity_delta, reason, unit_cost_ref, value_ref",
          { count: "exact" },
        )
        .eq("store_id", storeId)
        .gte("movement_date", query.from)
        .lte("movement_date", query.to)
        .order("seq", { ascending: false })
        .range(from, to);

      return { count, data: data as unknown as DbStockAdjustmentRow[] | null, error, status };
    },
    { getKey: (row) => row.movement_id },
  );

  return buildStockAdjustmentsReport({
    query,
    rows: rows.map((row) => ({
      createdAt: row.created_at,
      date: row.movement_date,
      movementId: row.movement_id,
      productId: row.product_id,
      productName: row.product_name,
      quantityDelta: Number(row.quantity_delta),
      reason: row.reason,
      seq: Number(row.seq),
      sku: row.sku,
      type: row.movement_type,
      unitCostRef: Number(row.unit_cost_ref),
      valueRef: Number(row.value_ref),
    })),
  });
}
