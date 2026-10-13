/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { OpenDocumentsQuery } from "./openDocuments.mock-server";
import {
  listOpenDocuments,
  OPEN_DOCUMENTS_SCAN_PAGE_SIZE,
  OPEN_SALES_SCAN_LIMIT,
} from "./openDocuments.server";

const STORE_ID = "44444444-4444-4444-4444-444444444444";
// 2026-06-20 10:00 en Caracas.
const NOW = new Date("2026-06-20T14:00:00.000Z");

type PageResult = { data: unknown[] | null; error: unknown };

function createQueryBuilder(resolvePage: (from: number, to: number) => PageResult) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn((from: number, to: number) => Promise.resolve(resolvePage(from, to))),
    select: jest.fn().mockReturnThis(),
  };

  return builder;
}

function mockTables(pages: {
  purchases?: (from: number, to: number) => PageResult;
  sales?: (from: number, to: number) => PageResult;
}) {
  const empty = () => ({ data: [], error: null });
  const builders = {
    purchases: createQueryBuilder(pages.purchases ?? empty),
    sales: createQueryBuilder(pages.sales ?? empty),
  };
  const from = jest.fn((table: "purchases" | "sales") => builders[table]);

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  return { ...builders, from };
}

function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-06-10T15:00:00.000Z",
    customer: { id: "contact-1", name: "Panadería Ávila", tax_id: "J-11111111-1" },
    id: "sale-1",
    invoice_number: "V-000010",
    paid_ves: "400.40",
    ref_rate_ves: "100.0000",
    status: "pendiente_pago",
    total_ref: "10.00",
    total_ves: "1000.50",
    ...overrides,
  };
}

function purchaseRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-06-05T15:00:00.000Z",
    id: "purchase-1",
    paid_ref: "5.00",
    paid_ves: "500.00",
    purchase_number: "C-000020",
    ref_rate_ves: "100.0000",
    status: "recibido",
    supplier: [{ id: "contact-2", name: "Distribuidora Norte", tax_id: null }],
    total_ref: "20.00",
    total_ves: "2000.00",
    ...overrides,
  };
}

function query(overrides: Partial<OpenDocumentsQuery> = {}): OpenDocumentsQuery {
  return { limit: 100, skip: 0, types: ["sale", "purchase"], ...overrides };
}

describe("openDocuments.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reads pending sales and open purchases of the store and maps them oldest first", async () => {
    const tables = mockTables({
      purchases: () => ({ data: [purchaseRow()], error: null }),
      sales: () => ({ data: [saleRow()], error: null }),
    });

    const result = await listOpenDocuments(query(), STORE_ID, NOW);

    expect(tables.sales.eq).toHaveBeenCalledWith("store_id", STORE_ID);
    expect(tables.sales.eq).toHaveBeenCalledWith("status", "pendiente_pago");
    expect(tables.sales.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(tables.sales.select).toHaveBeenCalledWith(
      expect.stringContaining("customer:contacts!sales_customer_id_fkey(id, name, tax_id)"),
    );
    expect(tables.purchases.eq).toHaveBeenCalledWith("store_id", STORE_ID);
    expect(tables.purchases.in).toHaveBeenCalledWith("status", ["pedido", "recibido"]);
    expect(tables.purchases.order).toHaveBeenCalledWith("created_at", { ascending: false });

    expect(result.items).toEqual([
      {
        contact: { id: "contact-2", name: "Distribuidora Norte" },
        createdAt: "2026-06-05T15:00:00.000Z",
        id: "purchase-1",
        number: "C-000020",
        paidRef: 5,
        paidVes: 500,
        pendingRef: 15,
        pendingVes: 1500,
        refRateVes: 100,
        status: "recibido",
        totalRef: 20,
        totalVes: 2000,
        type: "purchase",
      },
      {
        contact: { id: "contact-1", name: "Panadería Ávila", taxId: "J-11111111-1" },
        createdAt: "2026-06-10T15:00:00.000Z",
        id: "sale-1",
        number: "V-000010",
        paidVes: 400.4,
        pendingRef: 6,
        pendingVes: 600.1,
        refRateVes: 100,
        status: "pendiente_pago",
        totalRef: 10,
        totalVes: 1000.5,
        type: "sale",
      },
    ]);
    expect(result.totals).toEqual({
      count: 2,
      pendingRef: 21,
      pendingVes: 2100.1,
      truncated: false,
    });
    expect(result).toMatchObject({ limit: 100, skip: 0, total: 2 });
  });

  it("only queries the requested type", async () => {
    const tables = mockTables({ sales: () => ({ data: [saleRow()], error: null }) });

    const result = await listOpenDocuments(query({ types: ["sale"] }), STORE_ID, NOW);

    expect(tables.from).toHaveBeenCalledTimes(1);
    expect(tables.from).toHaveBeenCalledWith("sales");
    expect(result.items.map((item) => item.type)).toEqual(["sale"]);
  });

  it("drops documents without balance after reading them", async () => {
    mockTables({
      purchases: () => ({
        data: [
          purchaseRow({ id: "purchase-paid", paid_ves: "2000.00" }),
          purchaseRow({ id: "purchase-open" }),
        ],
        error: null,
      }),
      sales: () => ({ data: [saleRow({ id: "sale-settled", paid_ves: "1000.50" })], error: null }),
    });

    const result = await listOpenDocuments(query(), STORE_ID, NOW);

    expect(result.items.map((item) => item.id)).toEqual(["purchase-open"]);
    expect(result.totals.count).toBe(1);
  });

  it("pushes contact and Caracas date filters to the database", async () => {
    const tables = mockTables({});

    await listOpenDocuments(
      query({ contactId: "contact-9", from: "2026-06-01", to: "2026-06-10" }),
      STORE_ID,
      NOW,
    );

    expect(tables.sales.eq).toHaveBeenCalledWith("customer_id", "contact-9");
    expect(tables.purchases.eq).toHaveBeenCalledWith("supplier_id", "contact-9");
    [tables.sales, tables.purchases].forEach((builder) => {
      expect(builder.gte).toHaveBeenCalledWith("created_at", "2026-06-01T04:00:00.000Z");
      expect(builder.lt).toHaveBeenCalledWith("created_at", "2026-06-11T04:00:00.000Z");
    });
  });

  it("turns olderThanDays into an upper Caracas date bound", async () => {
    const tables = mockTables({});

    await listOpenDocuments(query({ olderThanDays: 10, types: ["sale"] }), STORE_ID, NOW);

    // Hoy 2026-06-20: entran los documentos hasta el 2026-06-10 inclusive.
    expect(tables.sales.lt).toHaveBeenCalledWith("created_at", "2026-06-11T04:00:00.000Z");
    expect(tables.sales.gte).not.toHaveBeenCalled();
  });

  it("searches by number and contact after reading, and paginates the result", async () => {
    mockTables({
      sales: () => ({
        data: [
          saleRow({ created_at: "2026-06-01T15:00:00.000Z", id: "sale-a", invoice_number: "V-000001" }),
          saleRow({ created_at: "2026-06-02T15:00:00.000Z", id: "sale-b", invoice_number: "V-000002" }),
          saleRow({
            created_at: "2026-06-03T15:00:00.000Z",
            customer: { id: "contact-3", name: "Otro Cliente", tax_id: "V-9" },
            id: "sale-c",
            invoice_number: "V-000003",
          }),
        ],
        error: null,
      }),
    });

    const byContact = await listOpenDocuments(
      query({ limit: 10, search: "avila", skip: 1, types: ["sale"] }),
      STORE_ID,
      NOW,
    );
    expect(byContact.items.map((item) => item.id)).toEqual(["sale-b"]);
    expect(byContact.total).toBe(2);
    expect(byContact.totals.count).toBe(2);

    const byNumber = await listOpenDocuments(
      query({ search: "000003", types: ["sale"] }),
      STORE_ID,
      NOW,
    );
    expect(byNumber.items.map((item) => item.id)).toEqual(["sale-c"]);
  });

  it("reads in blocks until a short block arrives", async () => {
    const fullPage = Array.from({ length: OPEN_DOCUMENTS_SCAN_PAGE_SIZE }, (_, index) =>
      saleRow({ id: `sale-${String(index).padStart(5, "0")}` }),
    );
    const tables = mockTables({
      sales: (from) =>
        from === 0
          ? { data: fullPage, error: null }
          : { data: [saleRow({ id: "sale-last" })], error: null },
    });

    const result = await listOpenDocuments(query({ types: ["sale"] }), STORE_ID, NOW);

    expect(tables.sales.range).toHaveBeenNthCalledWith(1, 0, OPEN_DOCUMENTS_SCAN_PAGE_SIZE - 1);
    expect(tables.sales.range).toHaveBeenNthCalledWith(
      2,
      OPEN_DOCUMENTS_SCAN_PAGE_SIZE,
      OPEN_DOCUMENTS_SCAN_PAGE_SIZE * 2 - 1,
    );
    expect(tables.sales.range).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(OPEN_DOCUMENTS_SCAN_PAGE_SIZE + 1);
    expect(result.totals.truncated).toBe(false);
  });

  it("stops at the scan limit and flags the totals as truncated", async () => {
    const tables = mockTables({
      sales: (from, to) => ({
        data: Array.from({ length: to - from + 1 }, (_, index) =>
          saleRow({ id: `sale-${String(from + index).padStart(5, "0")}` }),
        ),
        error: null,
      }),
    });

    const result = await listOpenDocuments(query({ types: ["sale"] }), STORE_ID, NOW);

    expect(tables.sales.range).toHaveBeenCalledTimes(
      OPEN_SALES_SCAN_LIMIT / OPEN_DOCUMENTS_SCAN_PAGE_SIZE,
    );
    expect(result.total).toBe(OPEN_SALES_SCAN_LIMIT);
    expect(result.totals.truncated).toBe(true);
  });

  it("propagates a database error", async () => {
    mockTables({ sales: () => ({ data: null, error: { code: "42501", message: "denied" } }) });

    await expect(listOpenDocuments(query({ types: ["sale"] }), STORE_ID, NOW)).rejects.toBeTruthy();
  });
});
