/**
 * @jest-environment node
 */

/**
 * Paridad servidor / mock de REP-07: los mismos casos corren contra
 * `inventoryReports.server` (con un doble de PostgREST en memoria que sirve lo
 * que devolverían las vistas `report_*` del parche `20261013b`) y contra
 * `inventoryReports.mock-server`, sobre el mismo libro.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../shared/mocks/erp-data", () => {
  const actual = jest.requireActual("../../../shared/mocks/erp-data");
  const store = "00000000-0000-4000-8000-000000000001";
  const otherStore = "00000000-0000-4000-8000-000000000002";
  const drinks = "c0000000-0000-4000-8000-00000000000a";
  const snacks = "c0000000-0000-4000-8000-00000000000b";

  const product = (
    id: string,
    categoryId: string,
    currentCostRef: number,
    currentStock: number,
    isActive = true,
    storeId = store,
  ) => ({
    categoryId,
    currentCostRef,
    currentStock,
    id,
    isActive,
    minStock: 0,
    name: `Producto ${id}`,
    salePriceRef: 20,
    sku: `SKU-${id}`,
    storeId,
  });
  type Links = { purchaseId?: string; reason?: string; saleId?: string; storeId?: string };
  let counter = 0;
  const move = (createdAt: string, productId: string, type: string, quantityDelta: number, links: Links = {}) => {
    counter += 1;

    return {
      createdAt,
      id: `m${String(counter).padStart(2, "0")}`,
      productId,
      quantityDelta,
      // El mock guarda un saldo; los reportes no lo leen (se pone uno absurdo a propósito).
      stockAfter: -999,
      storeId: store,
      type,
      ...links,
    };
  };
  const line = (saleId: string, productId: string, quantity: number, unitCostRefSnapshot: number) => ({
    productId,
    quantity,
    saleId,
    subtotalRef: quantity * 20,
    subtotalVes: quantity * 1000,
    unitCostRefSnapshot,
    unitPriceRef: 20,
  });

  // El libro en orden cronológico (Caracas = UTC-4); el stock de cada producto es la suma de sus movimientos.
  const ledger = [
    move("2026-03-01T15:00:00.000Z", "p-a", "inventario_inicial", 20),
    move("2026-03-01T15:01:00.000Z", "p-b", "inventario_inicial", 10),
    move("2026-03-02T15:00:00.000Z", "p-c", "inventario_inicial", 8),
    move("2026-03-02T15:01:00.000Z", "p-d", "inventario_inicial", 5),
    move("2026-03-03T15:00:00.000Z", "p-e", "inventario_inicial", 3),
    move("2026-03-04T15:00:00.000Z", "p-x", "inventario_inicial", 50, { storeId: otherStore }),
    move("2026-04-10T15:00:00.000Z", "p-a", "venta", -5, { saleId: "s1" }),
    move("2026-04-10T15:00:01.000Z", "p-b", "venta", -2, { saleId: "s1" }),
    move("2026-04-12T15:00:00.000Z", "p-e", "venta", -3, { saleId: "s2" }),
    // Venta anulada al día siguiente: neto 0, cada movimiento en su día.
    move("2026-05-02T15:00:00.000Z", "p-a", "venta", -3, { saleId: "s3" }),
    move("2026-05-03T15:00:00.000Z", "p-a", "ajuste_entrada", 3, { reason: "Anulación", saleId: "s3" }),
    move("2026-05-05T15:00:00.000Z", "p-a", "ajuste_entrada", 2, { reason: "  Conteo   físico " }),
    move("2026-05-06T15:00:00.000Z", "p-a", "ajuste_salida", -3, { reason: "Merma" }),
    move("2026-05-07T15:00:00.000Z", "p-b", "ajuste_salida", -1),
    // Compra recibida y anulada: su ajuste_salida no es un ajuste manual.
    move("2026-05-08T15:00:00.000Z", "p-b", "compra", 5, { purchaseId: "c1" }),
    move("2026-05-09T15:00:00.000Z", "p-b", "ajuste_salida", -5, { purchaseId: "c1", reason: "Anulación de compra" }),
    // 22:30 del domingo 10 en Caracas (ya es lunes 11 en UTC); dos líneas del mismo producto a costos distintos.
    move("2026-05-11T02:30:00.000Z", "p-a", "venta", -4, { saleId: "s4" }),
    move("2026-05-12T15:00:00.000Z", "p-a", "devolucion_cliente", 1, { saleId: "s4" }),
    // Apertura de empaque: ni venta ni ajuste.
    move("2026-05-13T15:00:00.000Z", "p-c", "conversion_salida", -2),
    move("2026-05-13T15:00:01.000Z", "p-b", "conversion_entrada", 12),
    // Venta sin línea: se valora al costo vigente.
    move("2026-05-14T15:00:00.000Z", "p-b", "venta", -1, { saleId: "s-sin-linea" }),
    move("2026-05-15T15:00:00.000Z", "p-x", "ajuste_salida", -7, { reason: "Merma", storeId: otherStore }),
    move("2026-05-17T15:00:00.000Z", "p-a", "ajuste_salida", -1, { reason: "Merma" }),
  ];

  return {
    ...actual,
    mockCategories: [
      { id: drinks, isActive: true, name: "Bebidas", storeId: store, taxRate: 16 },
      { id: snacks, isActive: true, name: "Snacks", storeId: store, taxRate: 16 },
    ],
    mockProducts: [
      product("p-a", drinks, 2, 10),
      product("p-b", snacks, 3.5, 18),
      product("p-c", "", 1.25, 6),
      product("p-d", drinks, 4, 5, false),
      product("p-e", snacks, 0.5, 0),
      product("p-x", drinks, 9, 43, true, otherStore),
    ],
    mockSaleItems: [
      line("s1", "p-a", 5, 1.5),
      line("s1", "p-b", 2, 3),
      line("s2", "p-e", 3, 0.5),
      line("s3", "p-a", 3, 2),
      line("s4", "p-a", 3, 2),
      line("s4", "p-a", 1, 4),
    ],
    // Como en el mock real: los movimientos nuevos van al principio.
    mockStockMovements: [...ledger].reverse(),
  };
});

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { mockCategories, mockProducts, mockSaleItems, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { DeadStockQuery, StockAdjustmentsQuery, StockTurnoverQuery } from "./inventoryReports";
import * as mock from "./inventoryReports.mock-server";
import * as server from "./inventoryReports.server";

type Row = Record<string, unknown>;

const STORE = DEFAULT_STORE_ID;
const OTHER_STORE = "00000000-0000-4000-8000-000000000002";
const TODAY = "2026-05-18";
const DRINKS = "c0000000-0000-4000-8000-00000000000a";
const SNACKS = "c0000000-0000-4000-8000-00000000000b";
/** Tope de filas por respuesta, como PostgREST. */
const POSTGREST_MAX_ROWS = 1000;

/** Una entrada por consulta resuelta: vista, filas devueltas y columnas pedidas. */
const queryLog: { columns: string; returned: number; table: string }[] = [];

function compareValues(first: unknown, second: unknown) {
  if (typeof first === "number" && typeof second === "number") {
    return first - second;
  }

  const [left, right] = [String(first), String(second)];
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Doble en memoria de una consulta de PostgREST: filtros, orden, rango, conteo y 416. */
function createFakeQuery(table: string, rows: Row[]) {
  const filters: ((row: Row) => boolean)[] = [];
  const orders: { ascending: boolean; column: string }[] = [];
  const state: { columns: string; window: { from: number; to: number } | null } = { columns: "", window: null };

  const query = {
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return query;
    },
    gt(column: string, value: number) {
      filters.push((row) => Number(row[column]) > value);
      return query;
    },
    gte(column: string, value: string) {
      filters.push((row) => String(row[column]) >= value);
      return query;
    },
    lte(column: string, value: string) {
      filters.push((row) => String(row[column]) <= value);
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      orders.push({ ascending: options?.ascending ?? true, column });
      return query;
    },
    range(from: number, to: number) {
      state.window = { from, to };
      return query;
    },
    select(columns: string) {
      state.columns = columns;
      return query;
    },
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      const matched = rows
        .filter((row) => filters.every((matches) => matches(row)))
        .sort((first, second) => {
          for (const { ascending, column } of orders) {
            const compared = compareValues(first[column], second[column]);

            if (compared !== 0) {
              return ascending ? compared : -compared;
            }
          }

          return 0;
        });
      const from = state.window?.from ?? 0;
      const size = Math.min(state.window ? state.window.to - from + 1 : Number.POSITIVE_INFINITY, POSTGREST_MAX_ROWS);
      const data = matched.slice(from, from + size);
      const result =
        from > 0 && from >= matched.length
          ? { count: null, data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, status: 416 }
          : { count: matched.length, data, error: null, status: 200 };

      queryLog.push({ columns: state.columns, returned: result.data?.length ?? 0, table });

      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };

  return query;
}

function useTables(tables: Record<string, Row[]>) {
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: (table: string) => createFakeQuery(table, tables[table] ?? []),
  });
}

// ---------------------------------------------------------------------------
// Lo que devolverían las vistas del parche 20261013b para el libro del mock
// ---------------------------------------------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100;
const storeOf = (entity: { storeId?: string | null }) => entity.storeId ?? DEFAULT_STORE_ID;
/** Caracas es UTC-4 todo el año. */
const caracasDay = (instant: string) => new Date(Date.parse(instant) - 4 * 3_600_000).toISOString().slice(0, 10);
/** El libro del más antiguo al más reciente; `seq` es su posición. */
const ledger = () => [...mockStockMovements].reverse().map((movement, index) => ({ ...movement, seq: index + 1 }));
const isSaleMovement = (movement: { saleId?: string; type: string }) =>
  movement.type === "venta" ||
  movement.type === "devolucion_cliente" ||
  (movement.type === "ajuste_entrada" && movement.saleId !== undefined);

function productLastMovementViewRows(): Row[] {
  return mockProducts.map((product) => {
    const movements = ledger().filter((movement) => movement.productId === product.id);
    const sales = movements.filter((movement) => movement.type === "venta");
    const lastSaleAt = sales.at(-1)?.createdAt ?? null;
    const categoryId = product.categoryId === "" ? null : product.categoryId;

    return {
      category_id: categoryId,
      category_name: mockCategories.find((category) => category.id === categoryId)?.name ?? "Sin categoría",
      cost_ref: product.currentCostRef,
      first_movement_at: movements[0]?.createdAt ?? null,
      // Sin movimientos la vista cuenta desde el alta; el mock no la guarda y cuenta desde hoy.
      idle_since: caracasDay(lastSaleAt ?? movements[0]?.createdAt ?? `${TODAY}T12:00:00.000Z`),
      is_active: product.isActive,
      last_movement_at: movements.at(-1)?.createdAt ?? null,
      last_sale_at: lastSaleAt,
      name: product.name,
      product_id: product.id,
      sku: product.sku,
      stock: product.currentStock,
      stock_value_ref: round2(product.currentStock * product.currentCostRef),
      store_id: storeOf(product),
    };
  });
}

function stockDailyFlowViewRows(): Row[] {
  const groups = new Map<string, Row & { cogs_ref: number; net_delta: number; sold_units: number }>();

  for (const movement of ledger()) {
    const product = mockProducts.find((candidate) => candidate.id === movement.productId);

    if (!product) {
      continue;
    }

    const day = caracasDay(movement.createdAt);
    const key = `${storeOf(movement)}|${day}|${movement.productId}`;
    const row = groups.get(key) ?? {
      cogs_ref: 0,
      movement_date: day,
      net_delta: 0,
      product_id: movement.productId,
      sold_units: 0,
      store_id: storeOf(movement),
    };

    row.net_delta += movement.quantityDelta;

    if (isSaleMovement(movement)) {
      const lines = mockSaleItems.filter((item) => item.saleId === movement.saleId && item.productId === movement.productId);
      const units = lines.reduce((sum, item) => sum + item.quantity, 0);
      const unitCost =
        units === 0
          ? product.currentCostRef
          : lines.reduce((sum, item) => sum + item.unitCostRefSnapshot * item.quantity, 0) / units;

      row.sold_units -= movement.quantityDelta;
      row.cogs_ref += round2(-movement.quantityDelta * unitCost);
    }

    groups.set(key, row);
  }

  return [...groups.values()];
}

function stockAdjustmentsViewRows(): Row[] {
  return ledger().flatMap((movement) => {
    const product = mockProducts.find((candidate) => candidate.id === movement.productId);
    const isManual =
      (movement.type === "ajuste_entrada" || movement.type === "ajuste_salida") &&
      movement.saleId === undefined &&
      movement.purchaseId === undefined;

    if (!product || !isManual) {
      return [];
    }

    return [
      {
        cost_basis: "current_cost",
        created_at: movement.createdAt,
        movement_date: caracasDay(movement.createdAt),
        movement_id: movement.id,
        movement_type: movement.type,
        product_id: product.id,
        product_name: product.name,
        quantity_delta: movement.quantityDelta,
        reason: (movement.reason ?? "").replace(/\s+/g, " ").trim() || "Sin motivo",
        seq: movement.seq,
        sku: product.sku,
        store_id: storeOf(movement),
        unit_cost_ref: product.currentCostRef,
        value_ref: round2(movement.quantityDelta * product.currentCostRef),
      },
    ];
  });
}

function useViews() {
  useTables({
    report_product_last_movement: productLastMovementViewRows(),
    report_stock_adjustments: stockAdjustmentsViewRows(),
    report_stock_daily_flow: stockDailyFlowViewRows(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  queryLog.length = 0;
  useViews();
});

describe("productos sin movimiento: servidor = mock", () => {
  const both = async (query: DeadStockQuery, storeId = STORE) => ({
    fromMock: mock.getDeadStockReport(query, storeId, TODAY),
    fromServer: await server.getDeadStockReport(query, storeId, TODAY),
  });

  it("activos con stock y 30 días sin vender, con su valor y el resumen de todo el inventario", async () => {
    const { fromMock, fromServer } = await both({ days: 30, limit: 10, skip: 0 });

    expect(fromServer).toEqual(fromMock);
    // p-c nunca se vendió (cuenta desde su primer movimiento); p-a y p-b se vendieron hace menos de 30 días;
    // p-d está inactivo y p-e no tiene stock.
    expect(fromServer.items.map((item) => [item.product.id, item.stock, item.stockValueRef, item.daysIdle, item.lastSaleAt])).toEqual([
      ["p-c", 6, 7.5, 77, null],
    ]);
    expect(fromServer.items[0]).toEqual(
      expect.objectContaining({
        category: { id: null, name: "Sin categoría" },
        // Su último movimiento es la apertura de empaque del 13 de mayo.
        daysSinceLastMovement: 5,
        product: { href: "/products/p-c", id: "p-c", name: "Producto p-c", sku: "SKU-p-c" },
      }),
    );
    // Inventario activo con stock: p-a 20 + p-b 63 + p-c 7,50.
    expect(fromServer.summary).toEqual({ idleValuePct: 8.29, idleValueRef: 7.5, inventoryValueRef: 90.5, productsCount: 1 });
  });

  it("con menos días entran más productos, ordenados por valor; pagina igual", async () => {
    const all = await both({ days: 1, limit: 10, skip: 0 });
    const page = await both({ days: 1, limit: 10, skip: 1 });

    expect(all.fromServer).toEqual(all.fromMock);
    expect(page.fromServer).toEqual(page.fromMock);
    // La última venta de p-a es la del 10 de mayo a las 22:30 de Caracas (día 11 en UTC): 8 días, no 7.
    expect(all.fromServer.items.map((item) => [item.product.id, item.stockValueRef, item.daysIdle])).toEqual([
      ["p-b", 63, 4],
      ["p-a", 20, 8],
      ["p-c", 7.5, 77],
    ]);
    expect(page.fromServer.items.map((item) => item.product.id)).toEqual(["p-a", "p-c"]);
    expect(page.fromServer.summary).toEqual(all.fromServer.summary);
  });

  it("filtra por categoría (y el inventario es el de esa categoría)", async () => {
    const { fromMock, fromServer } = await both({ categoryId: SNACKS, days: 1, limit: 10, skip: 0 });

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.items.map((item) => item.product.id)).toEqual(["p-b"]);
    expect(fromServer.summary).toEqual({ idleValuePct: 100, idleValueRef: 63, inventoryValueRef: 63, productsCount: 1 });
  });

  it("una categoría que no es uuid responde vacío sin consultar", async () => {
    const { fromMock, fromServer } = await both({ categoryId: "no-es-uuid", days: 1, limit: 10, skip: 0 });

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.total).toBe(0);
    expect(queryLog).toEqual([]);
  });

  it("no cruza tiendas", async () => {
    const { fromMock, fromServer } = await both({ days: 1, limit: 10, skip: 0 }, OTHER_STORE);

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.items.map((item) => item.product.id)).toEqual(["p-x"]);
  });

  it("solo pide la vista de productos y nunca columnas de usuario ni stock_after", async () => {
    await server.getDeadStockReport({ categoryId: DRINKS, days: 30, limit: 10, skip: 0 }, STORE, TODAY);

    expect(queryLog.map((entry) => entry.table)).toEqual(["report_product_last_movement"]);
    expect(queryLog[0]?.columns).not.toMatch(/stock_after|created_by|user/);
  });
});

describe("rotación: servidor = mock", () => {
  const both = async (query: StockTurnoverQuery, storeId = STORE) => ({
    fromMock: mock.getStockTurnoverReport(query, storeId, TODAY),
    fromServer: await server.getStockTurnoverReport(query, storeId),
  });
  const range = { from: "2026-05-01", to: "2026-05-14" };

  it("por producto: vendido neto, costo de la línea de venta y saldos de apertura y cierre", async () => {
    const { fromMock, fromServer } = await both({ ...range, groupBy: "product", limit: 10, skip: 0 });

    expect(fromServer).toEqual(fromMock);
    expect(
      fromServer.items.map((row) => [row.key, row.openingStock, row.closingStock, row.soldUnits, row.cogsRef, row.averageStockValueRef, row.turnover, row.daysOfInventory]),
    ).toEqual([
      // p-a: anulada (−3 +3 a 2,00) + venta de 4 a 2,50 de promedio − 1 devuelta = 3 uds y 7,50; cierra en 11
      // (el −1 del día 17 es posterior al rango).
      ["p-a", 15, 11, 3, 7.5, 26, 0.29, 48.53],
      // p-b: 1 ud sin línea de venta, al costo vigente (3,50).
      ["p-b", 8, 18, 1, 3.5, 45.5, 0.08, 182],
      ["p-c", 8, 6, 0, 0, 8.75, 0, null],
      ["p-d", 5, 5, 0, 0, 20, 0, null],
    ]);
    expect(fromServer.totals).toEqual({
      averageStockValueRef: 100.25,
      closingStock: 40,
      cogsRef: 11,
      daysOfInventory: 127.59,
      openingStock: 36,
      soldUnits: 4,
      stock: 39,
      stockValueRef: 110.5,
      turnover: 0.11,
    });
    expect(fromServer.inventoryBasis).toBe("average_opening_closing");
    expect(fromServer.rangeDays).toBe(14);
  });

  it("por categoría: mismos totales", async () => {
    const byProduct = await both({ ...range, groupBy: "product", limit: 10, skip: 0 });
    const { fromMock, fromServer } = await both({ ...range, groupBy: "category", limit: 10, skip: 0 });

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.items.map((row) => [row.key, row.category.name, row.productsCount, row.soldUnits, row.cogsRef])).toEqual([
      [DRINKS, "Bebidas", 2, 3, 7.5],
      [SNACKS, "Snacks", 1, 1, 3.5],
      ["", "Sin categoría", 1, 0, 0],
    ]);
    expect(fromServer.totals).toEqual(byProduct.fromServer.totals);
  });

  it("un rango antiguo reconstruye los saldos restando el libro posterior", async () => {
    const { fromMock, fromServer } = await both({ from: "2026-04-01", groupBy: "product", limit: 10, skip: 0, to: "2026-04-30" });

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.items.map((row) => [row.key, row.openingStock, row.closingStock, row.soldUnits, row.cogsRef])).toEqual([
      ["p-e", 3, 0, 3, 1.5],
      ["p-a", 20, 15, 5, 7.5],
      ["p-b", 10, 8, 2, 6],
      ["p-c", 8, 8, 0, 0],
      ["p-d", 5, 5, 0, 0],
    ]);
  });

  it("pagina igual y no cruza tiendas", async () => {
    const page = await both({ ...range, groupBy: "product", limit: 10, skip: 3 });
    const other = await both({ ...range, groupBy: "product", limit: 10, skip: 0 }, OTHER_STORE);

    expect(page.fromServer).toEqual(page.fromMock);
    expect(page.fromServer.items.map((row) => row.key)).toEqual(["p-d"]);
    expect(page.fromServer.total).toBe(4);
    expect(other.fromServer).toEqual(other.fromMock);
    expect(other.fromServer.items.map((row) => row.key)).toEqual(["p-x"]);
  });

  it("lee el libro por páginas por encima del tope de PostgREST", async () => {
    const days = Array.from({ length: 1200 }, (_value, index) =>
      new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
    );

    useTables({
      report_product_last_movement: productLastMovementViewRows().filter((row) => row.product_id === "p-a"),
      report_stock_daily_flow: days.map((day) => ({
        cogs_ref: 1.5,
        movement_date: day,
        net_delta: -1,
        product_id: "p-a",
        sold_units: 1,
        store_id: STORE,
      })),
    });

    const report = await server.getStockTurnoverReport(
      { from: days[0]!, groupBy: "product", limit: 10, skip: 0, to: days.at(-1)! },
      STORE,
    );

    expect(report.totals).toEqual(expect.objectContaining({ closingStock: 10, cogsRef: 1800, openingStock: 1210, soldUnits: 1200 }));
    expect(queryLog.filter((entry) => entry.table === "report_stock_daily_flow").map((entry) => entry.returned)).toEqual([1000, 200]);
  });
});

describe("ajustes y mermas: servidor = mock", () => {
  const both = async (query: StockAdjustmentsQuery, storeId = STORE) => ({
    fromMock: mock.getStockAdjustmentsReport(query, storeId),
    fromServer: await server.getStockAdjustmentsReport(query, storeId),
  });
  const range = { from: "2026-05-01", to: "2026-05-17" };

  it("solo los ajustes manuales, con motivo normalizado y valor al costo vigente", async () => {
    const { fromMock, fromServer } = await both({ ...range, groupBy: "week", limit: 10, skip: 0 });

    expect(fromServer).toEqual(fromMock);
    // Quedan fuera la reversión de venta, la compra anulada, la apertura de empaque y el inventario inicial.
    expect(fromServer.items.map((item) => [item.date, item.product.id, item.type, item.quantityDelta, item.reason, item.valueRef])).toEqual([
      ["2026-05-17", "p-a", "ajuste_salida", -1, "Merma", -2],
      ["2026-05-07", "p-b", "ajuste_salida", -1, "Sin motivo", -3.5],
      ["2026-05-06", "p-a", "ajuste_salida", -3, "Merma", -6],
      ["2026-05-05", "p-a", "ajuste_entrada", 2, "Conteo físico", 4],
    ]);
    expect(fromServer.byReason.map((reason) => [reason.reason, reason.movementsCount, reason.unitsIn, reason.unitsOut, reason.netValueRef])).toEqual([
      ["Merma", 2, 0, 4, -8],
      ["Conteo físico", 1, 2, 0, 4],
      ["Sin motivo", 1, 0, 1, -3.5],
    ]);
    expect(fromServer.totals).toEqual({
      movementsCount: 4,
      netUnits: -3,
      netValueRef: -7.5,
      unitsIn: 2,
      unitsOut: 5,
      valueInRef: 4,
      valueOutRef: 11.5,
    });
    expect(fromServer.costBasis).toBe("current_cost");
    expect(fromServer.groupBy).toBe("week");
    expect(fromServer.series.reduce((sum, bucket) => sum + bucket.movementsCount, 0)).toBe(4);
    expect(fromServer.items[0]?.product.href).toBe("/products/p-a");
  });

  it("recorta al rango, pagina igual y agrupa en automático", async () => {
    const { fromMock, fromServer } = await both({ from: "2026-05-06", groupBy: null, limit: 10, skip: 1, to: "2026-05-07" });

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.groupBy).toBe("day");
    expect(fromServer.total).toBe(2);
    expect(fromServer.items.map((item) => item.date)).toEqual(["2026-05-06"]);
    expect(fromServer.series.map((bucket) => [bucket.key, bucket.unitsOut])).toEqual([
      ["2026-05-06", 3],
      ["2026-05-07", 1],
    ]);
  });

  it("no cruza tiendas", async () => {
    const { fromMock, fromServer } = await both({ ...range, groupBy: "day", limit: 10, skip: 0 }, OTHER_STORE);

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.items.map((item) => [item.product.id, item.quantityDelta, item.valueRef])).toEqual([["p-x", -7, -63]]);
  });

  it("lee los ajustes por páginas por encima del tope de PostgREST", async () => {
    useTables({
      report_stock_adjustments: Array.from({ length: 1200 }, (_value, index) => ({
        cost_basis: "current_cost",
        created_at: "2026-05-06T15:00:00.000Z",
        movement_date: "2026-05-06",
        movement_id: `bulk-${index}`,
        movement_type: "ajuste_salida",
        product_id: "p-a",
        product_name: "Producto p-a",
        quantity_delta: -1,
        reason: "Merma",
        seq: index + 1,
        sku: "SKU-p-a",
        store_id: STORE,
        unit_cost_ref: 2,
        value_ref: -2,
      })),
    });

    const report = await server.getStockAdjustmentsReport({ ...range, groupBy: "month", limit: 10, skip: 0 }, STORE);

    expect(report.total).toBe(1200);
    expect(report.totals).toEqual(expect.objectContaining({ movementsCount: 1200, unitsOut: 1200, valueOutRef: 2400 }));
    expect(report.items[0]?.movementId).toBe("bulk-1199");
    expect(queryLog.map((entry) => entry.returned)).toEqual([1000, 200]);
  });

  it("un error de la base sale como error de la API", async () => {
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: () => {
        const failing = {
          eq: () => failing,
          gte: () => failing,
          lte: () => failing,
          order: () => failing,
          range: () => Promise.resolve({ count: null, data: null, error: { code: "42P01", message: "relation does not exist" }, status: 404 }),
          select: () => failing,
        };

        return failing;
      },
    });

    await expect(server.getStockAdjustmentsReport({ ...range, groupBy: "day", limit: 10, skip: 0 }, STORE)).rejects.toThrow();
  });
});
