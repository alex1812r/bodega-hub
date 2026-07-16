/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createPayment, getPaymentById, listPayments, updatePayment, cancelPayment } from "./payments.server";

const paymentRow = {
  amount: 1000,
  amount_ref: 1.96,
  amount_ves: 1000,
  bank_name: null,
  contact_id: "11111111-1111-1111-1111-111111111111",
  created_at: "2026-05-18T14:35:00.000Z",
  currency: "VES",
  direction: "entrada",
  id: "22222222-2222-2222-2222-222222222222",
  method: "punto_venta",
  notes: null,
  phone: null,
  purchase_id: null,
  reference_code: "778899",
  ref_rate_ves: 510,
  sale_id: "33333333-3333-3333-3333-333333333333",
};

function createQueryBuilder(result: { count?: number; data?: unknown; error?: unknown }) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };

  return builder;
}

describe("payments.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists payments with filters and contact embed", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [
        {
          ...paymentRow,
          contact: {
            address: null,
            email: "cliente@example.com",
            id: paymentRow.contact_id,
            is_active: true,
            name: "Cliente Demo",
            phone: null,
            tax_id: "J-123",
            type: "cliente",
          },
        },
      ],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    const result = await listPayments(
      new URLSearchParams("saleId=33333333-3333-3333-3333-333333333333&skip=0&limit=10"),
      DEFAULT_STORE_ID,
    );

    expect(builder.eq).toHaveBeenCalledWith("sale_id", "33333333-3333-3333-3333-333333333333");
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        contact: expect.objectContaining({ name: "Cliente Demo" }),
        id: paymentRow.id,
        saleId: paymentRow.sale_id,
      }),
    );
  });

  it("registers a payment through register_payment RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: paymentRow, error: null });
    const saleBuilder = createQueryBuilder({
      data: {
        id: paymentRow.sale_id,
        invoice_number: "VEN-0128",
        paid_ves: 7650,
        total_ves: 7650,
      },
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(saleBuilder),
      rpc,
    });

    const result = await createPayment(
      {
        amount: 1000,
        method: "punto_venta",
        saleId: paymentRow.sale_id!,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc).toHaveBeenCalledWith(
      "register_payment",
      expect.objectContaining({
        p_amount: 1000,
        p_method: "punto_venta",
        p_sale_id: paymentRow.sale_id,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: paymentRow.id,
        pendingBalanceVes: 0,
      }),
    );
  });

  it("returns payment detail with pending balance", async () => {
    const paymentBuilder = createQueryBuilder({
      data: {
        ...paymentRow,
        contact: {
          address: null,
          email: "cliente@example.com",
          id: paymentRow.contact_id,
          is_active: true,
          name: "Cliente Demo",
          phone: null,
          tax_id: "J-123",
          type: "cliente",
        },
      },
      error: null,
    });
    const saleBuilder = createQueryBuilder({
      data: {
        id: paymentRow.sale_id,
        invoice_number: "VEN-0128",
        paid_ves: 3000,
        total_ves: 8475,
      },
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === "payments") {
          return paymentBuilder;
        }

        return saleBuilder;
      }),
    });

    const result = await getPaymentById(paymentRow.id, DEFAULT_STORE_ID);

    expect(result.pendingBalanceVes).toBe(5475);
    expect(result.documentBalance).toEqual(
      expect.objectContaining({
        href: `/sales/${paymentRow.sale_id}`,
        label: "VEN-0128",
        paidVes: 3000,
        pendingVes: 5475,
        totalVes: 8475,
      }),
    );
    expect(result.contact).toEqual(expect.objectContaining({ name: "Cliente Demo" }));
  });

  it("updates payment metadata", async () => {
    const paymentBuilder = createQueryBuilder({
      data: {
        ...paymentRow,
        notes: "Comprobante corregido",
      },
      error: null,
    });
    const saleBuilder = createQueryBuilder({
      data: { paid_ves: 7650, total_ves: 7650 },
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === "payments") {
          return paymentBuilder;
        }

        return saleBuilder;
      }),
    });

    const result = await updatePayment(
      paymentRow.id,
      {
        notes: "Comprobante corregido",
      },
      DEFAULT_STORE_ID,
    );

    expect(paymentBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Comprobante corregido" }),
    );
    expect(result.notes).toBe("Comprobante corregido");
  });

  it("cancels a payment through cancel_payment RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...paymentRow, status: "anulado" },
      error: null,
    });
    const saleBuilder = createQueryBuilder({
      data: {
        id: paymentRow.sale_id,
        invoice_number: "V-000001",
        paid_ves: 6650,
        total_ves: 7650,
      },
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(saleBuilder),
      rpc,
    });

    const result = await cancelPayment(paymentRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("cancel_payment", { p_payment_id: paymentRow.id });
    expect(result.status).toBe("anulado");
  });
});
