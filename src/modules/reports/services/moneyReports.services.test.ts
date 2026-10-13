/**
 * @jest-environment node
 */

/**
 * Paridad servidor / mock de REP-06: los mismos casos corren contra
 * `moneyReports.server` (con un doble de PostgREST en memoria que sirve lo que
 * devolverían las vistas `report_*` del parche `20261013a`) y contra
 * `moneyReports.mock-server`, sobre los mismos datos.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../cash/services/cash.registers.mock-server", () => ({ listCashRegisters: jest.fn() }));
jest.mock("../../cash/services/cash.session.mock-server", () => ({ listRegisterSessions: jest.fn() }));
jest.mock("../../../shared/mocks/erp-data", () => {
  const actual = jest.requireActual("../../../shared/mocks/erp-data");
  const store = "00000000-0000-4000-8000-000000000001";
  const otherStore = "00000000-0000-4000-8000-000000000002";

  const sale = (
    id: string,
    createdAt: string,
    totalRef: number,
    status: string,
    paidVes: number,
    customerId = "10000000-0000-4000-8000-00000000000a",
    storeId = store,
  ) => ({
    createdAt,
    customerId,
    discountRef: 0,
    id,
    invoiceNumber: `F-${id}`,
    paidVes,
    refRateVes: 50,
    status,
    storeId,
    subtotalRef: totalRef,
    taxRef: 0,
    totalRef,
    totalVes: totalRef * 50,
    userId: "user-admin",
  });
  const purchase = (
    id: string,
    createdAt: string,
    totalRef: number,
    status: string,
    paidVes: number,
    paidRef: number,
    supplierId = "20000000-0000-4000-8000-00000000000a",
    storeId = store,
  ) => ({
    createdAt,
    discountRef: 0,
    id,
    paidRef,
    paidVes,
    purchaseNumber: `OC-${id}`,
    refRateVes: 50,
    status,
    storeId,
    subtotalRef: totalRef,
    supplierId,
    taxRef: 0,
    totalRef,
    totalVes: totalRef * 50,
    userId: "user-admin",
  });
  const contact = (id: string, name: string, type: string) => ({
    address: "",
    email: "",
    id,
    isActive: true,
    name,
    phone: "",
    storeId: store,
    taxId: "",
    type,
  });
  const product = (id: string, categoryId: string) => ({
    categoryId,
    currentCostRef: 1,
    currentStock: 1,
    id,
    isActive: true,
    minStock: 0,
    name: id,
    salePriceRef: 1,
    sku: id,
    storeId: store,
  });

  const mockSales = [
    // Lunes 4-may 11:00 y 11:40 en Caracas.
    sale("s1", "2026-05-04T15:00:00.000Z", 10, "pagada", 500),
    sale("s2", "2026-05-04T15:40:00.000Z", 5.55, "pagada", 277.5),
    sale("s3", "2026-05-06T15:00:00.000Z", 20, "pendiente_pago", 0),
    // 22:30 del domingo 10 en Caracas (ya es lunes 11 en UTC).
    sale("s4", "2026-05-11T02:30:00.000Z", 7, "pendiente_pago", 100, "10000000-0000-4000-8000-00000000000b"),
    sale("s5", "2026-05-12T15:00:00.000Z", 30, "pagada", 1500),
    sale("s6", "2026-05-12T15:00:00.000Z", 99, "cancelada", 0),
    sale("s7", "2026-05-13T15:00:00.000Z", 88, "devuelta", 0),
    sale("s8", "2026-04-01T15:00:00.000Z", 8, "pendiente_pago", 33.33),
    // Pendiente de pago pero ya cobrada del todo: no es un documento abierto.
    sale("s9", "2026-05-15T15:00:00.000Z", 12, "pendiente_pago", 600),
    sale("s10", "2026-05-05T15:00:00.000Z", 1000, "pendiente_pago", 0, "10000000-0000-4000-8000-00000000000a", otherStore),
  ];
  const products = ["p-soda", "p-chips", "p-suelto"];

  return {
    ...actual,
    mockCategories: [
      { id: "cat-bebidas", isActive: true, name: "Bebidas", storeId: store, taxRate: 16 },
      { id: "cat-snacks", isActive: true, name: "Snacks", storeId: store, taxRate: 16 },
    ],
    mockContacts: [
      contact("10000000-0000-4000-8000-00000000000a", "Cliente A", "cliente"),
      contact("10000000-0000-4000-8000-00000000000b", "Cliente B", "cliente"),
      contact("20000000-0000-4000-8000-00000000000a", "Proveedor A", "proveedor"),
      contact("20000000-0000-4000-8000-00000000000b", "Proveedor B", "proveedor"),
    ],
    mockProducts: [product("p-soda", "cat-bebidas"), product("p-chips", "cat-snacks"), product("p-suelto", "")],
    mockPurchases: [
      purchase("p1", "2026-05-05T15:00:00.000Z", 40, "recibido", 0, 0),
      purchase("p2", "2026-05-16T16:00:00.000Z", 10, "pedido", 250, 5, "20000000-0000-4000-8000-00000000000b"),
      purchase("p3", "2026-05-07T15:00:00.000Z", 500, "cancelado", 0, 0),
      purchase("p4", "2026-04-01T15:00:00.000Z", 25, "recibido", 1250, 25),
      purchase("p5", "2026-04-02T15:00:00.000Z", 25, "recibido", 1000, 21.5),
      purchase("p6", "2026-05-05T15:00:00.000Z", 900, "recibido", 0, 0, "20000000-0000-4000-8000-00000000000a", otherStore),
    ],
    mockSaleItems: mockSales.flatMap((item, index) => [
      {
        productId: products[index % 3],
        quantity: 2,
        saleId: item.id,
        subtotalRef: item.totalRef * 0.6,
        subtotalVes: item.totalRef * 30,
        unitCostRefSnapshot: item.totalRef * 0.1,
        unitPriceRef: item.totalRef * 0.3,
      },
      {
        productId: products[(index + 1) % 3],
        quantity: 1,
        saleId: item.id,
        subtotalRef: item.totalRef * 0.4,
        subtotalVes: item.totalRef * 20,
        unitCostRefSnapshot: item.totalRef * 0.3,
        unitPriceRef: item.totalRef * 0.4,
      },
    ]),
    mockSales,
  };
});

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { listCashRegisters } from "@/modules/cash/services/cash.registers.mock-server";
import { listRegisterSessions } from "@/modules/cash/services/cash.session.mock-server";
import type { CashRegister, CashSession } from "@/modules/cash/types";
import {
  mockCategories,
  mockContacts,
  mockProducts,
  mockPurchases,
  mockSaleItems,
  mockSales,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import type { AgingQuery, CashCloseDifferencesQuery } from "./moneyReports";
import * as mock from "./moneyReports.mock-server";
import * as server from "./moneyReports.server";
import { getGrossProfitReport as getGrossProfitReportMock } from "./reports.mock-server";

type Row = Record<string, unknown>;

const STORE = DEFAULT_STORE_ID;
const TODAY = "2026-05-18";
const CUSTOMER_A = "10000000-0000-4000-8000-00000000000a";
const CUSTOMER_B = "10000000-0000-4000-8000-00000000000b";
const SUPPLIER_B = "20000000-0000-4000-8000-00000000000b";
/** Tope de filas por respuesta, como PostgREST. */
const POSTGREST_MAX_ROWS = 1000;

/** Una entrada por consulta resuelta: tabla, filas devueltas y rango pedido. */
const queryLog: { range: { from: number; to: number } | null; returned: number; table: string }[] = [];

function compareValues(first: unknown, second: unknown) {
  if (typeof first === "number" && typeof second === "number") {
    return first - second;
  }

  const [left, right] = [String(first), String(second)];
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Doble en memoria de una consulta de PostgREST: filtros, orden, rango, límite, conteo y 416. */
function createFakeQuery(table: string, rows: Row[]) {
  const filters: ((row: Row) => boolean)[] = [];
  const orders: { ascending: boolean; column: string; nullsFirst: boolean }[] = [];
  const state: { head: boolean; limit: number | null; window: { from: number; to: number } | null } = {
    head: false,
    limit: null,
    window: null,
  };

  const query = {
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return query;
    },
    gte(column: string, value: string) {
      filters.push((row) => String(row[column]) >= value);
      return query;
    },
    is(column: string, value: null) {
      filters.push((row) => (row[column] ?? null) === value);
      return query;
    },
    limit(count: number) {
      state.limit = count;
      return query;
    },
    lt(column: string, value: string) {
      filters.push((row) => String(row[column]) < value);
      return query;
    },
    lte(column: string, value: string) {
      filters.push((row) => String(row[column]) <= value);
      return query;
    },
    order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
      const ascending = options?.ascending ?? true;
      // Como Postgres: los null van al final en ascendente y al principio en descendente.
      orders.push({ ascending, column, nullsFirst: options?.nullsFirst ?? !ascending });
      return query;
    },
    range(from: number, to: number) {
      state.window = { from, to };
      return query;
    },
    select(_columns: string, options?: { head?: boolean }) {
      state.head = options?.head ?? false;
      return query;
    },
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      const matched = rows
        .filter((row) => filters.every((matches) => matches(row)))
        .sort((first, second) => {
          for (const { ascending, column, nullsFirst } of orders) {
            const [left, right] = [first[column] ?? null, second[column] ?? null];

            if (left === null || right === null) {
              if (left !== right) {
                return (left === null) === nullsFirst ? -1 : 1;
              }
              continue;
            }

            const compared = compareValues(left, right);

            if (compared !== 0) {
              return ascending ? compared : -compared;
            }
          }

          return 0;
        });
      const from = state.window?.from ?? 0;
      const size = Math.min(
        state.window ? state.window.to - from + 1 : Number.POSITIVE_INFINITY,
        state.limit ?? Number.POSITIVE_INFINITY,
        POSTGREST_MAX_ROWS,
      );
      const data = matched.slice(from, from + size);

      const result = state.head
        ? { count: matched.length, data: null, error: null, status: 200 }
        : from > 0 && from >= matched.length
          ? {
              count: null,
              data: null,
              error: { code: "PGRST103", message: "Requested range not satisfiable" },
              status: 416,
            }
          : { count: matched.length, data, error: null, status: 200 };

      queryLog.push({ range: state.window, returned: result.data?.length ?? 0, table });

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
// Lo que devolverían las vistas del parche 20261013a para los datos del mock
// ---------------------------------------------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100;
const storeOf = (entity: { storeId?: string | null }) => entity.storeId ?? DEFAULT_STORE_ID;
const countedSales = () => mockSales.filter((sale) => !["cancelada", "devuelta"].includes(sale.status));

function upsert<T extends Row>(groups: Map<string, T>, key: string, initial: T) {
  const existing = groups.get(key);

  if (existing) {
    return existing;
  }

  groups.set(key, initial);
  return initial;
}

function salesByHourViewRows(): Row[] {
  const groups = new Map<string, Row & { sales_count: number; total_ref: number; total_ves: number }>();

  for (const sale of countedSales()) {
    // Caracas es UTC-4 todo el año.
    const local = new Date(Date.parse(sale.createdAt) - 4 * 3_600_000);
    const saleDate = local.toISOString().slice(0, 10);
    const hour = local.getUTCHours();
    const row = upsert(groups, `${storeOf(sale)}|${saleDate}|${hour}`, {
      dow: local.getUTCDay() === 0 ? 7 : local.getUTCDay(),
      hour,
      sale_date: saleDate,
      sales_count: 0,
      store_id: storeOf(sale),
      total_ref: 0,
      total_ves: 0,
    });

    row.sales_count += 1;
    row.total_ref += sale.totalRef;
    row.total_ves += sale.totalVes;
  }

  return [...groups.values()];
}

function salesByCategoryViewRows(): Row[] {
  const groups = new Map<
    string,
    Row & { cost_ref: number; gross_profit_ref: number; revenue_ref: number; units: number }
  >();

  for (const sale of countedSales()) {
    for (const item of mockSaleItems.filter((saleItem) => saleItem.saleId === sale.id)) {
      const categoryId = mockProducts.find((product) => product.id === item.productId)?.categoryId || null;
      const saleDate = toCaracasDateKey(sale.createdAt);
      const cost = item.unitCostRefSnapshot * item.quantity;
      const row = upsert(groups, `${storeOf(sale)}|${saleDate}|${categoryId}`, {
        category_id: categoryId,
        category_name: mockCategories.find((category) => category.id === categoryId)?.name ?? "Sin categoría",
        cost_ref: 0,
        gross_profit_ref: 0,
        revenue_ref: 0,
        sale_date: saleDate,
        store_id: storeOf(sale),
        units: 0,
      });

      row.cost_ref += cost;
      row.gross_profit_ref += item.subtotalRef - cost;
      row.revenue_ref += item.subtotalRef;
      row.units += item.quantity;
    }
  }

  return [...groups.values()];
}

function daysSince(createdAt: string) {
  return Math.max(0, Math.round((Date.parse(TODAY) - Date.parse(toCaracasDateKey(createdAt))) / 86_400_000));
}

function agingViewRows(): Row[] {
  const contactName = (id: string) => mockContacts.find((contact) => contact.id === id)?.name ?? null;
  const base = (createdAt: string) => {
    const days = daysSince(createdAt);

    return {
      bucket: days <= 7 ? "0-7" : days <= 30 ? "8-30" : "30+",
      created_at: createdAt,
      days,
      document_date: toCaracasDateKey(createdAt),
    };
  };

  return [
    ...mockSales
      .filter((sale) => sale.status === "pendiente_pago" && round2(sale.totalVes - sale.paidVes) > 0)
      .map((sale) => {
        const pendingVes = round2(sale.totalVes - sale.paidVes);
        const pendingRef = round2(pendingVes / sale.refRateVes);

        return {
          ...base(sale.createdAt),
          contact_id: sale.customerId,
          contact_name: contactName(sale.customerId),
          doc_type: "sale",
          document_id: sale.id,
          document_number: sale.invoiceNumber,
          paid_ref: Math.max(round2(sale.totalRef - pendingRef), 0),
          paid_ves: sale.paidVes,
          pending_ref: pendingRef,
          pending_ves: pendingVes,
          ref_rate_ves: sale.refRateVes,
          store_id: storeOf(sale),
          total_ref: sale.totalRef,
          total_ves: sale.totalVes,
        };
      }),
    ...mockPurchases
      .filter(
        (purchase) =>
          ["pedido", "recibido"].includes(purchase.status) && round2(purchase.totalVes - purchase.paidVes) > 0,
      )
      .map((purchase) => ({
        ...base(purchase.createdAt),
        contact_id: purchase.supplierId,
        contact_name: contactName(purchase.supplierId),
        doc_type: "purchase",
        document_id: purchase.id,
        document_number: purchase.purchaseNumber,
        paid_ref: purchase.paidRef ?? 0,
        paid_ves: purchase.paidVes,
        pending_ref: Math.max(round2(purchase.totalRef - (purchase.paidRef ?? 0)), 0),
        pending_ves: round2(purchase.totalVes - purchase.paidVes),
        ref_rate_ves: purchase.refRateVes,
        store_id: storeOf(purchase),
        total_ref: purchase.totalRef,
        total_ves: purchase.totalVes,
      })),
  ];
}

/** `group by grouping sets ((tienda, tipo, tramo), (tienda, tipo, tramo, contacto))`. */
function agingSummaryViewRows(documents: Row[]): Row[] {
  const groups = new Map<string, Row & { documents_count: number; pending_ref: number; pending_ves: number }>();

  for (const document of documents) {
    for (const contactId of [null, document.contact_id as string]) {
      const row = upsert(groups, `${document.store_id}|${document.doc_type}|${document.bucket}|${contactId}`, {
        bucket: document.bucket,
        contact_id: contactId,
        doc_type: document.doc_type,
        documents_count: 0,
        pending_ref: 0,
        pending_ves: 0,
        store_id: document.store_id,
      });

      row.documents_count += 1;
      row.pending_ref = round2(row.pending_ref + (document.pending_ref as number));
      row.pending_ves = round2(row.pending_ves + (document.pending_ves as number));
    }
  }

  return [...groups.values()];
}

const register = (id: string, name: string): CashRegister => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  isActive: true,
  name,
  storeId: STORE,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const REGISTERS = [register("r1", "Caja 1"), register("r2", "Caja 2")];

function session(
  id: string,
  registerIndex: number,
  closedAt: string | null,
  expected: [ves: number, ref: number] | null,
  counted: [ves: number, ref: number] | null,
  closedReason: CashSession["closedReason"] = "manual",
): CashSession {
  return {
    closedAt,
    closedReason: closedAt ? closedReason : null,
    closingRef: counted?.[1] ?? null,
    closingVes: counted?.[0] ?? null,
    id,
    openedAt: "2026-05-01T12:00:00.000Z",
    openingRef: 0,
    openingVes: 0,
    register: REGISTERS[registerIndex]!,
    registerId: REGISTERS[registerIndex]!.id,
    status: closedAt ? "closed" : "open",
    theoreticalClosingRef: expected?.[1] ?? null,
    theoreticalClosingVes: expected?.[0] ?? null,
  };
}

const SESSIONS = [
  // 03:30 UTC del 2-may = 23:30 del 1-may en Caracas.
  session("cs1", 0, "2026-05-02T03:30:00.000Z", [1000.5, 20], [900, 20]),
  session("cs2", 1, "2026-05-10T22:00:00.000Z", [200, 5.5], [250.25, 7]),
  session("cs3", 0, "2026-05-11T04:00:00.000Z", [-35.1, 0], [0, 0], "end_of_day"),
  // Cierre sin teórico guardado: no entra al reporte.
  session("cs4", 0, "2026-05-15T22:00:00.000Z", null, [80, 1]),
  session("cs5", 0, null, null, null),
];

function cashCloseViewRows(): Row[] {
  const rows: Row[] = [];

  for (const currency of ["ves", "ref"] as const) {
    const running = { counted: 0, difference: 0, expected: 0 };
    const index = currency === "ves" ? 0 : 1;

    for (const item of SESSIONS.filter((candidate) => candidate.status === "closed")) {
      const expected = index === 0 ? item.theoreticalClosingVes : item.theoreticalClosingRef;
      const counted = index === 0 ? item.closingVes : item.closingRef;

      if (expected == null || counted == null) {
        continue;
      }

      running.counted = round2(running.counted + counted);
      running.expected = round2(running.expected + expected);
      running.difference = round2(running.difference + counted - expected);
      rows.push({
        cash_session_id: item.id,
        close_date: toCaracasDateKey(item.closedAt!),
        closed_at: item.closedAt,
        closed_reason: item.closedReason,
        counted,
        currency,
        difference: round2(counted - expected),
        expected,
        register_id: item.registerId,
        register_name: item.register.name,
        running_counted: running.counted,
        running_difference: running.difference,
        running_expected: running.expected,
        store_id: STORE,
      });
    }
  }

  return rows;
}

function viewTables(): Record<string, Row[]> {
  const aging = agingViewRows();

  return {
    report_cash_close_differences: cashCloseViewRows(),
    report_open_documents_aging: aging,
    report_open_documents_aging_summary: agingSummaryViewRows(aging),
    report_sales_by_category: salesByCategoryViewRows(),
    report_sales_by_hour: salesByHourViewRows(),
  };
}

beforeEach(() => {
  queryLog.length = 0;
  (createRouteSupabaseClient as jest.Mock).mockReset();
  (listCashRegisters as jest.Mock).mockImplementation((storeId: string) =>
    REGISTERS.filter((item) => item.storeId === storeId),
  );
  (listRegisterSessions as jest.Mock).mockImplementation((registerId: string) =>
    SESSIONS.filter((item) => item.registerId === registerId),
  );
  useTables(viewTables());
});

const MAY = { from: "2026-05-01", to: "2026-05-31" };

describe("ventas por hora: servidor y mock", () => {
  it("devuelven la misma matriz 7×24 con ceros y los mismos totales", async () => {
    const fromServer = await server.getSalesByHourReport(MAY, STORE);
    const fromMock = mock.getSalesByHourReport(MAY, STORE);

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.matrix).toHaveLength(7);
    expect(fromServer.matrix.every((hours) => hours.length === 24)).toBe(true);
    // s1 y s2: lunes a las 11. s4: domingo a las 22 (día Caracas, no UTC).
    expect(fromServer.matrix[0]![11]).toEqual({ salesCount: 2, totalRef: 15.55, totalVes: 777.5 });
    expect(fromServer.matrix[6]![22]).toEqual({ salesCount: 1, totalRef: 7, totalVes: 350 });
    expect(fromServer.matrix[0]![22]).toEqual({ salesCount: 0, totalRef: 0, totalVes: 0 });
    expect(fromServer.byHour[11]).toEqual({ hour: 11, salesCount: 5, totalRef: 77.55, totalVes: 3877.5 });
    expect(fromServer.byWeekday[6]).toEqual({ dow: 7, salesCount: 1, totalRef: 7, totalVes: 350 });
    // Sin canceladas, devueltas, otra tienda ni la venta de abril.
    expect(fromServer.totals).toEqual({ salesCount: 6, totalRef: 84.55, totalVes: 4227.5 });
  });

  it("el rango recorta por día de Caracas en los dos", async () => {
    const range = { from: "2026-05-10", to: "2026-05-10" };
    const fromServer = await server.getSalesByHourReport(range, STORE);

    expect(fromServer).toEqual(mock.getSalesByHourReport(range, STORE));
    expect(fromServer.totals).toEqual({ salesCount: 1, totalRef: 7, totalVes: 350 });
  });
});

describe("ventas por categoría: servidor y mock", () => {
  it("devuelven las mismas filas, ordenadas por ingreso, con margen y markup", async () => {
    const fromServer = await server.getSalesByCategoryReport(MAY, STORE);
    const fromMock = mock.getSalesByCategoryReport(MAY, STORE);

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.items.map((row) => row.categoryName)).toEqual(
      [...fromServer.items].sort((first, second) => second.revenueRef - first.revenueRef).map((row) => row.categoryName),
    );
    expect(fromServer.items.map((row) => row.categoryId).sort()).toEqual(["cat-bebidas", "cat-snacks", null]);
    expect(fromServer.items.find((row) => row.categoryId === null)?.categoryName).toBe("Sin categoría");

    for (const row of [...fromServer.items, fromServer.totals]) {
      expect(row.marginPct).toBe(Math.round((row.grossProfitRef / row.revenueRef) * 10_000) / 100);
      expect(row.markupPct).toBe(Math.round((row.grossProfitRef / row.costRef) * 10_000) / 100);
    }
  });

  it("el total general cuadra con Ganancia bruta del mismo rango", async () => {
    const fromServer = await server.getSalesByCategoryReport(MAY, STORE);
    const grossProfit = getGrossProfitReportMock(
      new URLSearchParams({ ...MAY, groupBy: "month" }),
      STORE,
    ).series!.totals.current;

    expect(fromServer.totals.revenueRef).toBe(grossProfit.revenueRef);
    expect(fromServer.totals.costRef).toBe(grossProfit.costRef);
    expect(fromServer.totals.grossProfitRef).toBe(grossProfit.grossProfitRef);
    expect(fromServer.totals.revenueRef).toBe(84.55);
    expect(
      Math.round(fromServer.items.reduce((sum, row) => sum + row.revenueRef, 0) * 100) / 100,
    ).toBe(fromServer.totals.revenueRef);
  });

  it("sin ventas en el rango: lista vacía y porcentajes null", async () => {
    const range = { from: "2025-01-01", to: "2025-01-31" };
    const fromServer = await server.getSalesByCategoryReport(range, STORE);

    expect(fromServer).toEqual(mock.getSalesByCategoryReport(range, STORE));
    expect(fromServer).toEqual({
      items: [],
      range,
      totals: { costRef: 0, grossProfitRef: 0, marginPct: null, markupPct: null, revenueRef: 0, units: 0 },
    });
  });
});

describe("cuentas por cobrar / por pagar: servidor y mock", () => {
  const cases: Array<[label: string, query: AgingQuery]> = [
    ["sin filtros", { limit: 10, skip: 0 }],
    ["segunda página", { limit: 2, skip: 2 }],
    ["más allá del total", { limit: 10, skip: 50 }],
    ["tramo 8-30", { bucket: "8-30", limit: 10, skip: 0 }],
    ["tramo 30+", { bucket: "30+", limit: 10, skip: 0 }],
    ["un contacto", { contactId: CUSTOMER_B, limit: 10, skip: 0 }],
    ["un proveedor", { contactId: SUPPLIER_B, limit: 10, skip: 0 }],
    ["contacto y tramo sin documentos", { bucket: "0-7", contactId: CUSTOMER_A, limit: 10, skip: 0 }],
    ["contacto que no es un uuid", { contactId: "cont-walk-in", limit: 10, skip: 0 }],
  ];

  it.each(cases)("por cobrar, %s: misma respuesta", async (_label, query) => {
    expect(await server.getReceivablesAgingReport(query, STORE)).toEqual(
      mock.getReceivablesAgingReport(query, STORE, TODAY),
    );
  });

  it.each(cases)("por pagar, %s: misma respuesta", async (_label, query) => {
    expect(await server.getPayablesAgingReport(query, STORE)).toEqual(
      mock.getPayablesAgingReport(query, STORE, TODAY),
    );
  });

  it("por cobrar: solo ventas pendientes con saldo, de la más antigua a la más nueva, con días, tramo y enlaces", async () => {
    const report = await server.getReceivablesAgingReport({ limit: 10, skip: 0 }, STORE);

    expect(report.total).toBe(3);
    expect(report.items.map((row) => [row.document.id, row.date, row.days, row.bucket])).toEqual([
      ["s8", "2026-04-01", 47, "30+"],
      ["s3", "2026-05-06", 12, "8-30"],
      // 22:30 del 10-may en Caracas: 8 días, no 7.
      ["s4", "2026-05-10", 8, "8-30"],
    ]);
    expect(report.items[0]).toEqual({
      bucket: "30+",
      contact: { id: CUSTOMER_A, name: "Cliente A" },
      createdAt: "2026-04-01T15:00:00.000Z",
      date: "2026-04-01",
      days: 47,
      document: { href: "/sales/s8", id: "s8", number: "F-s8", type: "sale" },
      paidRef: 0.67,
      paidVes: 33.33,
      pendingRef: 7.33,
      pendingVes: 366.67,
      refRateVes: 50,
      totalRef: 8,
      totalVes: 400,
    });
    expect(report.summary).toEqual({
      buckets: [
        { bucket: "0-7", documentsCount: 0, pendingRef: 0, pendingVes: 0 },
        { bucket: "8-30", documentsCount: 2, pendingRef: 25, pendingVes: 1250 },
        { bucket: "30+", documentsCount: 1, pendingRef: 7.33, pendingVes: 366.67 },
      ],
      totals: { documentsCount: 3, pendingRef: 32.33, pendingVes: 1616.67 },
    });
  });

  it("por pagar: compras pedido / recibido con saldo; el pendiente REF sale de lo pagado en REF", async () => {
    const report = await server.getPayablesAgingReport({ limit: 10, skip: 0 }, STORE);

    expect(report.items.map((row) => [row.document.href, row.days, row.bucket, row.pendingVes, row.pendingRef, row.paidRef])).toEqual([
      ["/purchases/p5", 46, "30+", 250, 3.5, 21.5],
      ["/purchases/p1", 13, "8-30", 2000, 40, 0],
      ["/purchases/p2", 2, "0-7", 250, 5, 5],
    ]);
    expect(report.summary.totals).toEqual({ documentsCount: 3, pendingRef: 48.5, pendingVes: 2500 });
  });

  it("el filtro de tramo cambia la lista y el total, no el resumen", async () => {
    const all = await server.getReceivablesAgingReport({ limit: 10, skip: 0 }, STORE);
    const old = await server.getReceivablesAgingReport({ bucket: "30+", limit: 10, skip: 0 }, STORE);

    expect(old.total).toBe(1);
    expect(old.items.map((row) => row.document.id)).toEqual(["s8"]);
    expect(old.summary).toEqual(all.summary);
  });

  it("no mezcla documentos de otra tienda", async () => {
    const report = await server.getReceivablesAgingReport({ limit: 100, skip: 0 }, STORE);

    expect(report.items.some((row) => row.document.id === "s10")).toBe(false);
  });
});

describe("cuentas por cobrar con 10.000 documentos abiertos", () => {
  const TOTAL = 10_000;
  const PAGE = 100;

  function bulkTables() {
    const documents: Row[] = Array.from({ length: TOTAL }, (_unused, index) => {
      const days = index % 60;

      return {
        bucket: days <= 7 ? "0-7" : days <= 30 ? "8-30" : "30+",
        contact_id: CUSTOMER_A,
        contact_name: "Cliente A",
        // Varios documentos comparten instante: el desempate es `document_id`.
        created_at: new Date(Date.UTC(2026, 4, 18, 12) - days * 86_400_000 - (index % 7) * 1000).toISOString(),
        days,
        doc_type: "sale",
        document_date: "2026-05-18",
        document_id: `doc-${String((index * 7919) % TOTAL).padStart(5, "0")}`,
        document_number: `F-${index}`,
        paid_ref: 0,
        paid_ves: 0,
        pending_ref: 1 + (index % 13),
        pending_ves: (1 + (index % 13)) * 50,
        ref_rate_ves: 50,
        store_id: STORE,
        total_ref: 1 + (index % 13),
        total_ves: (1 + (index % 13)) * 50,
      };
    });

    return {
      documents,
      tables: {
        report_open_documents_aging: documents,
        report_open_documents_aging_summary: agingSummaryViewRows(documents),
      },
    };
  }

  it("pagina el conjunto completo sin duplicados ni huecos, sin leer más de una página por consulta", async () => {
    const { documents, tables } = bulkTables();
    useTables(tables);

    const ids: string[] = [];
    const sortKeys: string[] = [];

    for (let skip = 0; skip < TOTAL; skip += PAGE) {
      const page = await server.getReceivablesAgingReport({ limit: PAGE, skip }, STORE);

      expect(page.total).toBe(TOTAL);
      expect(page.items).toHaveLength(PAGE);
      ids.push(...page.items.map((row) => row.document.id));
      sortKeys.push(...page.items.map((row) => `${row.createdAt}|${row.document.id}`));
    }

    expect(new Set(ids).size).toBe(TOTAL);
    expect([...ids].sort()).toEqual(documents.map((row) => String(row.document_id)).sort());
    expect(sortKeys).toEqual([...sortKeys].sort());

    // Ninguna consulta trajo más de una página de documentos ni más de tres filas de resumen.
    const documentQueries = queryLog.filter((entry) => entry.table === "report_open_documents_aging");
    const summaryQueries = queryLog.filter((entry) => entry.table === "report_open_documents_aging_summary");
    expect(documentQueries).toHaveLength(TOTAL / PAGE);
    expect(documentQueries.every((entry) => entry.returned === PAGE && entry.range!.to - entry.range!.from + 1 === PAGE)).toBe(true);
    expect(summaryQueries).toHaveLength(TOTAL / PAGE);
    expect(Math.max(...summaryQueries.map((entry) => entry.returned))).toBe(3);
  });

  it("el resumen por tramo cubre los 10.000 documentos aunque la página tenga 10", async () => {
    const { documents, tables } = bulkTables();
    useTables(tables);

    const report = await server.getReceivablesAgingReport({ limit: 10, skip: 0 }, STORE);
    const expected = (bucket: string) => {
      const rows = documents.filter((row) => row.bucket === bucket);

      return {
        bucket,
        documentsCount: rows.length,
        pendingRef: rows.reduce((sum, row) => sum + (row.pending_ref as number), 0),
        pendingVes: rows.reduce((sum, row) => sum + (row.pending_ves as number), 0),
      };
    };

    expect(report.items).toHaveLength(10);
    expect(report.summary.buckets).toEqual(["0-7", "8-30", "30+"].map(expected));
    expect(report.summary.totals.documentsCount).toBe(TOTAL);

    const bucket = await server.getReceivablesAgingReport({ bucket: "8-30", limit: 10, skip: 0 }, STORE);
    expect(bucket.total).toBe(expected("8-30").documentsCount);
  });
});

describe("diferencias de cierre de caja: servidor y mock", () => {
  const cases: Array<[label: string, query: CashCloseDifferencesQuery]> = [
    ["sin rango", { from: null, limit: 10, skip: 0, to: null }],
    ["rango con cierres anteriores", { from: "2026-05-10", limit: 10, skip: 0, to: "2026-05-31" }],
    ["solo hasta", { from: null, limit: 10, skip: 0, to: "2026-05-05" }],
    ["una moneda", { currency: "ves", from: "2026-05-01", limit: 10, skip: 0, to: "2026-05-31" }],
    ["segunda página", { from: null, limit: 2, skip: 2, to: null }],
    ["más allá del total", { from: null, limit: 10, skip: 40, to: null }],
    ["rango sin cierres", { from: "2025-01-01", limit: 10, skip: 0, to: "2025-01-31" }],
  ];

  it.each(cases)("%s: misma respuesta", async (_label, query) => {
    expect(await server.getCashCloseDifferencesReport(query, STORE)).toEqual(
      mock.getCashCloseDifferencesReport(query, STORE),
    );
  });

  it("contado − teórico por sesión y moneda, del cierre más reciente al más antiguo, con acumulado del rango", async () => {
    const report = await server.getCashCloseDifferencesReport(
      { from: "2026-05-10", limit: 10, skip: 0, to: "2026-05-31" },
      STORE,
    );

    expect(report.total).toBe(4);
    expect(
      report.items.map((row) => [row.cashSessionId, row.currency, row.expected, row.counted, row.difference, row.runningDifference]),
    ).toEqual([
      ["cs3", "ref", 0, 0, 0, 1.5],
      ["cs3", "ves", -35.1, 0, 35.1, 85.35],
      ["cs2", "ref", 5.5, 7, 1.5, 1.5],
      // El faltante de cs1 (−100,50) es anterior al rango: no entra al acumulado.
      ["cs2", "ves", 200, 250.25, 50.25, 50.25],
    ]);
    expect(report.items[1]).toMatchObject({
      closeDate: "2026-05-11",
      closedReason: "end_of_day",
      registerId: "r1",
      registerName: "Caja 1",
    });
    expect(report.totals).toEqual([
      { counted: 250.25, currency: "ves", difference: 85.35, expected: 164.9, sessionsCount: 2 },
      { counted: 7, currency: "ref", difference: 1.5, expected: 5.5, sessionsCount: 2 },
    ]);
    expect(report.range).toEqual({ from: "2026-05-10", to: "2026-05-31" });
  });

  it("el cierre de las 23:30 de Caracas cuenta en su día y los cierres sin teórico o abiertos no aparecen", async () => {
    const report = await server.getCashCloseDifferencesReport({ from: null, limit: 20, skip: 0, to: null }, STORE);

    expect(report.items.find((row) => row.cashSessionId === "cs1")?.closeDate).toBe("2026-05-01");
    expect(new Set(report.items.map((row) => row.cashSessionId))).toEqual(new Set(["cs1", "cs2", "cs3"]));
    expect(report.totals[0]).toEqual({
      counted: 1150.25,
      currency: "ves",
      difference: -15.15,
      expected: 1165.4,
      sessionsCount: 3,
    });
  });

  it("los totales no dependen de la página ni del filtro de moneda de la lista", async () => {
    const all = await server.getCashCloseDifferencesReport({ from: null, limit: 10, skip: 0, to: null }, STORE);
    const paged = await server.getCashCloseDifferencesReport(
      { currency: "ref", from: null, limit: 1, skip: 1, to: null },
      STORE,
    );

    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
    expect(paged.totals).toEqual(all.totals);
    // Por moneda se lee una fila del rango, no el rango entero.
    expect(
      queryLog.filter((entry) => entry.table === "report_cash_close_differences").every((entry) => entry.returned <= 10),
    ).toBe(true);
  });
});
