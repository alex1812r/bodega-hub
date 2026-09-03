/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
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
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };

  return builder;
}

function mockAdminStoreLookup(storeId = DEFAULT_STORE_ID) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: { store_id: storeId },
    error: null,
  });

  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle,
        }),
      }),
    }),
  });
}

describe("payments.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminStoreLookup();
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

  describe("errores de negocio de los RPC", () => {
    /**
     * Cada caso llega como error de `register_payment` / `cancel_payment`. Los
     * SQLSTATE `PT4xx` los emite supabase/patches/20260904-payment-guards.sql.
     */
    function mockRpcError(rpcError: { code?: string; message: string }) {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn().mockReturnValue(createQueryBuilder({ data: null, error: null })),
        rpc: jest.fn().mockResolvedValue({ data: null, error: rpcError }),
      });
    }

    async function expectCreateError(
      rpcError: { code?: string; message: string },
      expected: { code: string; status: number },
    ) {
      mockRpcError(rpcError);

      await expect(
        createPayment(
          { amount: 1000, method: "efectivo_ves", saleId: paymentRow.sale_id! },
          DEFAULT_STORE_ID,
        ),
      ).rejects.toMatchObject({
        code: expected.code,
        message: rpcError.message,
        status: expected.status,
      });
    }

    it.each([
      ["PT400", 400, "BAD_REQUEST"],
      ["PT402", 400, "INSUFFICIENT_VAULT_BALANCE"],
      ["PT403", 403, "FORBIDDEN"],
      ["PT404", 404, "NOT_FOUND"],
      ["PT409", 409, "CONFLICT"],
    ])("mapea el SQLSTATE %s a %s", async (sqlState, status, code) => {
      await expectCreateError(
        { code: sqlState as string, message: "Mensaje del RPC" },
        { code: code as string, status: status as number },
      );
    });

    it.each([
      "El vuelto (Bs 7210,00) no puede superar el monto recibido en esta línea (Bs 8011,75)",
      "No hay suficiente efectivo en la caja para entregar el vuelto. Disponible: Bs 500,00, vuelto: Bs 7210,00",
      "El pago excede el saldo pendiente de la venta. Saldo pendiente: Bs 0,00, neto del pago: Bs 801,18",
      "El pago excede el saldo pendiente de la compra. Saldo pendiente: Bs 1602,00, monto del pago: Bs 50000,00",
      "El desglose de billetes recibidos viene en VES pero el monto es en USD",
      "No se puede anular un pago de una venta cancelada o devuelta",
      "El pago ya fue anulado",
      "Contacto no pertenece a tu tienda",
      "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo",
    ])("no deja escapar como 500 el mensaje %s", async (message) => {
      mockRpcError({ code: "P0001", message });

      await expect(
        createPayment(
          { amount: 1000, method: "efectivo_ves", saleId: paymentRow.sale_id! },
          DEFAULT_STORE_ID,
        ),
      ).rejects.toMatchObject({ message, status: 400 });
    });

    it("sigue reconociendo el saldo insuficiente del baul sin SQLSTATE propio", async () => {
      await expectCreateError(
        { code: "P0001", message: "Saldo insuficiente en el baul (cuenta). Faltante VES: 500" },
        { code: "INSUFFICIENT_VAULT_BALANCE", status: 400 },
      );
    });

    it("sigue reconociendo la sesión de caja cerrada aunque venga sin acentos", async () => {
      await expectCreateError(
        { code: "P0001", message: "No puede registrar un pago en efectivo: no tiene una sesion de caja abierta" },
        { code: "BAD_REQUEST", status: 400 },
      );
    });

    it("mantiene el 404 de venta no encontrada", async () => {
      await expectCreateError(
        { code: "P0001", message: "Venta no encontrada" },
        { code: "NOT_FOUND", status: 404 },
      );
    });

    it("mantiene el 403 de permisos", async () => {
      await expectCreateError(
        { code: "P0001", message: "No autorizado para registrar pagos de ventas" },
        { code: "FORBIDDEN", status: 403 },
      );
    });

    it("deja en 500 lo que de verdad es un fallo inesperado", async () => {
      await expectCreateError(
        { code: "XX000", message: "connection reset by peer" },
        { code: "INTERNAL_ERROR", status: 500 },
      );
    });

    it("mapea el SQLSTATE también al anular un pago", async () => {
      mockRpcError({
        code: "PT409",
        message:
          "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo",
      });

      await expect(cancelPayment(paymentRow.id, DEFAULT_STORE_ID)).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
      });
    });
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
