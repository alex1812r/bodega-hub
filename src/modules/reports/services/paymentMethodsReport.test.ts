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
