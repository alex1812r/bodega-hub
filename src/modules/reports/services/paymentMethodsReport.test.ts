/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { PAYMENT_METHODS } from "@/shared/payments/paymentMethods";

import { computePaymentMethodsReport } from "./paymentMethodsReport";
import { getPaymentMethodsReport } from "./paymentMethodsReport.server";

function createPaymentsQueryBuilder(result: { data?: unknown; error?: null }) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    then: (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  return builder;
}

describe("computePaymentMethodsReport", () => {
  it("groups active sale payments by method in catalog order", () => {
    const result = computePaymentMethodsReport({
      payments: [
        {
          amountRef: 10,
          amountVes: 5000,
          method: "efectivo_ves",
          saleId: "sale-1",
          status: "activo",
        },
        {
          amountRef: 4.5,
          amountVes: 2250,
          method: "efectivo_ves",
          saleId: "sale-2",
          status: "activo",
        },
        {
          amountRef: 8,
          amountVes: 4000,
          method: "pago_movil",
          saleId: "sale-1",
          status: "activo",
        },
      ],
    });

    expect(result.items.map((row) => row.method)).toEqual([...PAYMENT_METHODS]);
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toEqual({
      amountRef: 14.5,
      amountVes: 7250,
      method: "efectivo_ves",
      paymentCount: 2,
    });
    expect(result.items[2]).toEqual({
      amountRef: 8,
      amountVes: 4000,
      method: "pago_movil",
      paymentCount: 1,
    });
    expect(result.summary).toEqual({
      paymentCount: 3,
      totalRef: 22.5,
      totalVes: 11250,
    });
  });

  it("returns zeros for unused methods", () => {
    const result = computePaymentMethodsReport({
      payments: [
        {
          amountRef: 7,
          amountVes: 3486,
          method: "efectivo_usd",
          saleId: "sale-5",
          status: "activo",
        },
      ],
    });

    expect(result.items).toEqual([
      { amountRef: 0, amountVes: 0, method: "efectivo_ves", paymentCount: 0 },
      { amountRef: 7, amountVes: 3486, method: "efectivo_usd", paymentCount: 1 },
      { amountRef: 0, amountVes: 0, method: "pago_movil", paymentCount: 0 },
      { amountRef: 0, amountVes: 0, method: "punto_venta", paymentCount: 0 },
      { amountRef: 0, amountVes: 0, method: "transferencia", paymentCount: 0 },
    ]);
  });

  it("excludes cancelled payments and purchase payments without sale_id", () => {
    const result = computePaymentMethodsReport({
      payments: [
        {
          amountRef: 15,
          amountVes: 7650,
          method: "punto_venta",
          saleId: "sale-1",
          status: "activo",
        },
        {
          amountRef: 99,
          amountVes: 50000,
          method: "punto_venta",
          saleId: "sale-1",
          status: "anulado",
        },
        {
          amountRef: 20,
          amountVes: 10200,
          method: "transferencia",
          saleId: null,
          status: "activo",
        },
        {
          amountRef: 5,
          amountVes: 2500,
          method: "efectivo_ves",
          status: "activo",
        },
      ],
    });

    expect(result.items.find((row) => row.method === "punto_venta")).toEqual({
      amountRef: 15,
      amountVes: 7650,
      method: "punto_venta",
      paymentCount: 1,
    });
    expect(result.items.find((row) => row.method === "transferencia")?.paymentCount).toBe(0);
    expect(result.items.find((row) => row.method === "efectivo_ves")?.paymentCount).toBe(0);
    expect(result.summary.paymentCount).toBe(1);
  });
});

describe("getPaymentMethodsReport server", () => {
  const mockFrom = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: mockFrom,
    });
  });

  it("applies Caracas from/to as created_at gte/lt bounds", async () => {
    const builder = createPaymentsQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    await getPaymentMethodsReport(
      new URLSearchParams("from=2026-05-18&to=2026-05-18"),
      DEFAULT_STORE_ID,
    );

    expect(mockFrom).toHaveBeenCalledWith("payments");
    expect(builder.eq).toHaveBeenCalledWith("status", "activo");
    expect(builder.not).toHaveBeenCalledWith("sale_id", "is", null);
    expect(builder.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    expect(builder.gte).toHaveBeenCalledWith("created_at", "2026-05-18T04:00:00.000Z");
    expect(builder.lt).toHaveBeenCalledWith("created_at", "2026-05-19T04:00:00.000Z");
  });
});

/** Doble de PostgREST: nunca devuelve más de 1.000 filas por consulta. */
const POSTGREST_MAX_ROWS = 1000;

type FakePaymentRow = {
  amount: number;
  amount_ref: number;
  amount_ves: number;
  contact_id: string;
  created_at: string;
  direction: string;
  id: string;
  method: string;
  sale_id: string;
  status: string;
  store_id: string;
};

function buildPaymentRows(count: number, createdAt = "2026-05-18T15:00:00.000Z"): FakePaymentRow[] {
  return Array.from({ length: count }, (_, index) => ({
    amount: 1,
    amount_ref: 1,
    amount_ves: 500,
    contact_id: "cont-1",
    created_at: createdAt,
    direction: "entrada",
    id: `pay-${createdAt}-${String(index).padStart(5, "0")}`,
    method: index % 2 === 0 ? "efectivo_ves" : "pago_movil",
    sale_id: `sale-${index}`,
    status: "activo",
    store_id: DEFAULT_STORE_ID,
  }));
}

function createCappedPaymentsBuilder(rows: FakePaymentRow[]) {
  const state: { window: { from: number; to: number } | null } = { window: null };
  const ordered = [...rows].sort((first, second) => first.id.localeCompare(second.id));

  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn(function (this: unknown, from: number, to: number) {
      state.window = { from, to };
      return this;
    }),
    select: jest.fn().mockReturnThis(),
    then: (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      const from = state.window?.from ?? 0;
      const to = Math.min(
        state.window?.to ?? Number.POSITIVE_INFINITY,
        from + POSTGREST_MAX_ROWS - 1,
      );
      state.window = null;

      return Promise.resolve({
        count: ordered.length,
        data: ordered.slice(from, to + 1),
        error: null,
      }).then(onFulfilled, onRejected);
    },
  };

  return builder;
}

describe("getPaymentMethodsReport server: más de 1.000 pagos (D24)", () => {
  const mockFrom = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: mockFrom });
  });

  it("suma todos los pagos aunque PostgREST corte cada respuesta en 1.000 filas", async () => {
    const builder = createCappedPaymentsBuilder(buildPaymentRows(2500));
    mockFrom.mockReturnValue(builder);

    const result = await getPaymentMethodsReport(
      new URLSearchParams("from=2026-05-18&to=2026-05-18"),
      DEFAULT_STORE_ID,
    );

    expect(result.summary).toEqual({ paymentCount: 2500, totalRef: 2500, totalVes: 1_250_000 });
    expect(result.items.find((row) => row.method === "efectivo_ves")).toEqual({
      amountRef: 1250,
      amountVes: 625_000,
      method: "efectivo_ves",
      paymentCount: 1250,
    });
    expect(result.items.find((row) => row.method === "pago_movil")?.paymentCount).toBe(1250);
  });

  it("lee en páginas con orden estable por id", async () => {
    const builder = createCappedPaymentsBuilder(buildPaymentRows(2500));
    mockFrom.mockReturnValue(builder);

    await getPaymentMethodsReport(new URLSearchParams("from=2026-05-18&to=2026-05-18"), DEFAULT_STORE_ID);

    expect(builder.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(builder.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it.each([1, 999, 1000])("no cambia los totales con %i pagos", async (count) => {
    mockFrom.mockReturnValue(createCappedPaymentsBuilder(buildPaymentRows(count)));

    const result = await getPaymentMethodsReport(
      new URLSearchParams("from=2026-05-18&to=2026-05-18"),
      DEFAULT_STORE_ID,
    );

    expect(result.summary).toEqual({ paymentCount: count, totalRef: count, totalVes: count * 500 });
  });
});
