/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  cancelSale,
  createSale,
  getSaleByClientRequestId,
  getSaleById,
  listSales,
  mapSaleRow,
  returnSale,
} from "./sales.server";

const saleRow = {
  created_at: "2026-05-18T14:30:00.000Z",
  customer_id: "11111111-1111-1111-1111-111111111111",
  discount_ref: 0,
  exchange_rate_id: null,
  id: "22222222-2222-2222-2222-222222222222",
  invoice_number: "V-000001",
  notes: null,
  paid_ves: 7650,
  ref_rate_ves: 510,
  status: "pagada" as const,
  subtotal_ref: 15,
  tax_ref: 0,
  total_ref: 15,
  total_ves: 7650,
  updated_at: "2026-05-18T14:30:00.000Z",
  user_id: "33333333-3333-3333-3333-333333333333",
};

function createQueryBuilder(result: { count?: number; data?: unknown; error?: unknown }) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };

  return builder;
}

function mockAdminStoreLookup(found = true) {
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: found ? { store_id: DEFAULT_STORE_ID } : null,
            error: null,
          }),
        })),
      })),
    })),
  });
}

describe("sales.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminStoreLookup(true);
  });

  it("maps sale rows to camelCase", () => {
    expect(mapSaleRow(saleRow)).toEqual({
      createdAt: saleRow.created_at,
      customerId: saleRow.customer_id,
      discountRef: 0,
      id: saleRow.id,
      invoiceNumber: "V-000001",
      paidVes: 7650,
      refRateVes: 510,
      status: "pagada",
      subtotalRef: 15,
      taxRef: 0,
      totalRef: 15,
      totalVes: 7650,
      updatedAt: saleRow.updated_at,
      userId: saleRow.user_id,
    });
  });

  it("lists sales with pagination", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [
        {
          ...saleRow,
          customer: {
            address: null,
            email: "cliente@example.com",
            id: saleRow.customer_id,
            name: "Cliente Demo",
            phone: null,
            type: "cliente",
          },
          sale_items: [{ count: 2 }],
        },
      ],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    const result = await listSales(
      new URLSearchParams("status=pagada&skip=0&limit=10"),
      DEFAULT_STORE_ID,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        customer: expect.objectContaining({ name: "Cliente Demo" }),
        invoiceNumber: "V-000001",
        itemsCount: 2,
      }),
    );
  });

  it("creates a sale without payments through the atomic RPC with an empty payment list", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: saleRow, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    const result = await createSale(
      {
        clientRequestId: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
        customerId: saleRow.customer_id,
        items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
        refRateVes: 510,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_sale_with_payments", {
      p_client_request_id: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
      p_customer_id: saleRow.customer_id,
      p_discount_ref: 0,
      p_exchange_rate_id: null,
      p_invoice_number: null,
      p_items: [{ product_id: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
      p_notes: null,
      p_payments: [],
      p_ref_rate_ves: 510,
      p_tax_ref: 0,
    });
    expect(result.invoiceNumber).toBe("V-000001");
  });

  it("creates sale and payments atomically through create_sale_with_payments", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...saleRow, paid_ves: 7650, status: "pagada" },
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    const result = await createSale(
      {
        clientRequestId: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
        customerId: saleRow.customer_id,
        items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
        payments: [
          {
            amount: 20,
            change: { amount: 5, method: "efectivo_usd" },
            changeDenominations: { USD: { "5": 1 } },
            currency: "USD",
            method: "efectivo_usd",
            receivedDenominations: { USD: { "20": 1 } },
          },
          {
            amount: 100,
            bankName: "Banesco",
            method: "pago_movil",
            phone: "04125551234",
            referenceCode: "1234",
          },
        ],
        refRateVes: 510,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_sale_with_payments", {
      p_client_request_id: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
      p_customer_id: saleRow.customer_id,
      p_discount_ref: 0,
      p_exchange_rate_id: null,
      p_invoice_number: null,
      p_items: [{ product_id: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
      p_notes: null,
      p_payments: [
        {
          amount: 20,
          bank_name: null,
          change_amount: 5,
          change_denominations: { USD: { "5": 1 } },
          change_method: "efectivo_usd",
          method: "efectivo_usd",
          notes: null,
          phone: null,
          received_denominations: { USD: { "20": 1 } },
          reference_code: null,
        },
        {
          amount: 100,
          bank_name: "Banesco",
          change_amount: 0,
          change_denominations: null,
          change_method: null,
          method: "pago_movil",
          notes: null,
          phone: "04125551234",
          received_denominations: null,
          reference_code: "1234",
        },
      ],
      p_ref_rate_ves: 510,
      p_tax_ref: 0,
    });
    expect(result.status).toBe("pagada");
  });

  it("falls back to create_sale + register_payment when the atomic RPC is missing", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.create_sale_with_payments(p_client_request_id, ...) in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: saleRow, error: null })
      .mockResolvedValueOnce({ data: { id: "pay-1", sale_id: saleRow.id }, error: null });
    // Busqueda previa por clave: nadie la guardo todavia. Refresco por id: la venta cobrada.
    const from = jest.fn(() => {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => ({
          data: filters.client_request_id === undefined ? { ...saleRow, status: "pagada" } : null,
          error: null,
        }),
        select: () => chain,
      };

      return chain;
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

    const result = await createSale(
      {
        clientRequestId: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
        customerId: saleRow.customer_id,
        items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
        payments: [{ amount: 15, currency: "USD", method: "efectivo_usd" }],
        refRateVes: 510,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "create_sale_with_payments",
      "create_sale",
      "register_payment",
    ]);
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_client_request_id: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
    });
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_sale_id: saleRow.id, p_amount: 15 });
    expect(result.status).toBe("pagada");
  });

  it("cancels the sale when a fallback payment fails", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42883", message: "function public.create_sale_with_payments does not exist" },
      })
      .mockResolvedValueOnce({ data: saleRow, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PT400", message: "El pago excede el saldo pendiente de la venta" },
      })
      .mockResolvedValueOnce({ data: { ...saleRow, status: "cancelada" }, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createSale(
        {
          customerId: saleRow.customer_id,
          items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
          payments: [{ amount: 999, currency: "USD", method: "efectivo_usd" }],
          refRateVes: 510,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "create_sale_with_payments",
      "create_sale",
      "register_payment",
      "cancel_sale",
    ]);
  });

  it("never uses plain create_sale while the atomic RPC exists, even without payments", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: saleRow, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await createSale(
      {
        customerId: saleRow.customer_id,
        items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
        payments: [],
        refRateVes: 510,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["create_sale_with_payments"]);
  });

  describe("production without patch 20260909 nor the idempotency patches", () => {
    const KEY = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
    const missingRpc = (signature: string) => ({
      data: null,
      error: {
        code: "PGRST202",
        message: `Could not find the function public.${signature} in the schema cache`,
      },
    });
    const input = {
      clientRequestId: KEY,
      customerId: saleRow.customer_id,
      items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
      refRateVes: 510,
    };

    function mountSalesTable(lookupByKey: { data: unknown; error: unknown }) {
      return jest.fn(() => {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          maybeSingle: async () =>
            filters.client_request_id === undefined ? { data: saleRow, error: null } : lookupByKey,
          select: () => chain,
        };

        return chain;
      });
    }

    it("creates the sale without idempotency (and logs it) when neither the column nor the new signature exist", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const rpc = jest
        .fn()
        .mockResolvedValueOnce(missingRpc("create_sale_with_payments(p_client_request_id, ...)"))
        .mockResolvedValueOnce(missingRpc("create_sale(p_client_request_id, p_customer_id, ...)"))
        .mockResolvedValueOnce({ data: saleRow, error: null });
      const from = mountSalesTable({
        data: null,
        error: { code: "42703", message: "column sales.client_request_id does not exist" },
      });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

      const result = await createSale(input, DEFAULT_STORE_ID);

      expect(result.id).toBe(saleRow.id);
      expect(rpc.mock.calls.map((call) => call[0])).toEqual([
        "create_sale_with_payments",
        "create_sale",
        "create_sale",
      ]);
      expect(rpc.mock.calls[1][1]).toHaveProperty("p_client_request_id", KEY);
      expect(rpc.mock.calls[2][1]).not.toHaveProperty("p_client_request_id");
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain("client_request_id");

      warn.mockRestore();
    });

    it("returns the sale already stored under the key instead of creating another", async () => {
      const rpc = jest
        .fn()
        .mockResolvedValueOnce(missingRpc("create_sale_with_payments(p_client_request_id, ...)"));
      const from = mountSalesTable({ data: saleRow, error: null });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

      const result = await createSale(input, DEFAULT_STORE_ID, { userId: saleRow.user_id });

      expect(result.id).toBe(saleRow.id);
      expect(rpc.mock.calls.map((call) => call[0])).toEqual(["create_sale_with_payments"]);
    });

    it.each([
      ["a cancelled sale", { ...saleRow, status: "cancelada" }, { userId: saleRow.user_id }],
      ["a sale of another user", saleRow, { userId: "99999999-9999-4999-8999-999999999999" }],
      ["a sale of another customer", { ...saleRow, customer_id: "another-customer" }, { userId: saleRow.user_id }],
    ])("answers 409 when the key belongs to %s", async (_case, stored, viewer) => {
      const rpc = jest
        .fn()
        .mockResolvedValueOnce(missingRpc("create_sale_with_payments(p_client_request_id, ...)"));
      const from = mountSalesTable({ data: stored, error: null });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

      await expect(createSale(input, DEFAULT_STORE_ID, viewer)).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  });

  it("maps a reused idempotency key (PT409) from the RPC to 409", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: "PT409", message: "La clave de idempotencia ya se usó en otra venta" },
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createSale(
        {
          clientRequestId: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
          customerId: saleRow.customer_id,
          items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
          refRateVes: 510,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "La clave de idempotencia ya se usó en otra venta",
      status: 409,
    });
  });

  describe("getSaleByClientRequestId", () => {
    const KEY = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
    const detailRow = { ...saleRow, customer: null, payments: [], sale_items: [] };

    function mountLookup(lookupByKey: { data: unknown; error: unknown }) {
      const from = jest.fn(() => {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          maybeSingle: async () =>
            filters.client_request_id === undefined ? { data: detailRow, error: null } : lookupByKey,
          select: () => chain,
        };

        return chain;
      });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });
    }

    it("returns the sale in the detail shape for its own user", async () => {
      mountLookup({ data: saleRow, error: null });

      const sale = await getSaleByClientRequestId(KEY, DEFAULT_STORE_ID, {
        role: "vendedor",
        userId: saleRow.user_id,
      });

      expect(sale).toEqual(expect.objectContaining({ id: saleRow.id, items: [], payments: [] }));
    });

    it("lets an admin read the sale of another user", async () => {
      mountLookup({ data: saleRow, error: null });

      await expect(
        getSaleByClientRequestId(KEY, DEFAULT_STORE_ID, { role: "admin", userId: "another-user" }),
      ).resolves.toEqual(expect.objectContaining({ id: saleRow.id }));
    });

    it.each([
      ["no sale has that key", { data: null, error: null }, saleRow.user_id],
      [
        "the column does not exist yet",
        { data: null, error: { code: "42703", message: "column sales.client_request_id does not exist" } },
        saleRow.user_id,
      ],
      ["the sale belongs to another seller", { data: saleRow, error: null }, "another-user"],
    ])("answers 404 when %s", async (_case, lookup, userId) => {
      mountLookup(lookup);

      await expect(
        getSaleByClientRequestId(KEY, DEFAULT_STORE_ID, { role: "vendedor", userId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });

  it("maps a payment rule raised inside create_sale_with_payments to 400", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PT400",
        message: "La venta no tiene saldo pendiente: ya está cobrada (saldo pendiente: Bs 0)",
      },
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createSale(
        {
          customerId: saleRow.customer_id,
          items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
          payments: [{ amount: 10, currency: "USD", method: "efectivo_usd" }],
          refRateVes: 510,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("maps an accented cash-session rule without SQLSTATE to 400", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message:
          "No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada",
      },
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createSale(
        {
          customerId: saleRow.customer_id,
          items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
          payments: [{ amount: 10, method: "efectivo_ves" }],
          refRateVes: 510,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("maps an out-of-band exchange rate from create_sale to 400", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        message:
          "Tasa ref/VES fuera de rango: se envio 1.0000 Bs/REF y la tasa vigente de la tienda es 801.1752 Bs/REF (tolerancia +-5%). Actualiza la tasa y vuelve a intentar.",
      },
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createSale(
        {
          customerId: saleRow.customer_id,
          items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
          refRateVes: 1,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("maps a zero unit price rejection from create_sale to 400", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        message:
          "Precio unitario en cero no permitido para el producto SKU-1 (precio de lista: 2.46 REF)",
      },
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createSale(
        {
          customerId: saleRow.customer_id,
          items: [
            {
              productId: "44444444-4444-4444-4444-444444444444",
              quantity: 1,
              unitPriceRef: 0,
            },
          ],
          refRateVes: 801.1752,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("maps cancel_sale rejection for active payments to 400", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        message:
          "La venta V-000001 tiene 1 pago(s) activo(s) por Bs 4005.88. Anula primero los pagos y luego cancela la venta.",
      },
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(createQueryBuilder({ data: null, error: null })),
      rpc,
    });

    await expect(cancelSale(saleRow.id, DEFAULT_STORE_ID)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });

  it("returns not found when sale detail is missing", async () => {
    mockAdminStoreLookup(false);
    const builder = createQueryBuilder({ data: null, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    await expect(getSaleById("missing", DEFAULT_STORE_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("cancels a sale through cancel_sale RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...saleRow, status: "cancelada" },
      error: null,
    });
    const detailBuilder = createQueryBuilder({
      data: {
        ...saleRow,
        customer: null,
        payments: [],
        sale_items: [],
        status: "cancelada",
      },
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(detailBuilder),
      rpc,
    });

    const result = await cancelSale(saleRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("cancel_sale", { p_sale_id: saleRow.id });
    expect(result.status).toBe("cancelada");
  });

  it("returns stock movements after return_sale RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...saleRow, status: "devuelta" },
      error: null,
    });
    const detailBuilder = createQueryBuilder({
      data: {
        ...saleRow,
        customer: null,
        payments: [],
        sale_items: [],
        status: "devuelta",
      },
      error: null,
    });
    const movementsBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            created_at: "2026-05-18T16:00:00.000Z",
            id: "55555555-5555-5555-5555-555555555555",
            product_id: "44444444-4444-4444-4444-444444444444",
            quantity_delta: 1,
            reason: "Devolucion V-000001",
            sale_id: saleRow.id,
            type: "devolucion_cliente",
          },
        ],
        error: null,
      }),
      select: jest.fn().mockReturnThis(),
    };

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === "stock_movements") {
          return movementsBuilder;
        }

        return detailBuilder;
      }),
      rpc,
    });

    const result = await returnSale(saleRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("return_sale", { p_sale_id: saleRow.id });
    expect(result.sale.status).toBe("devuelta");
    expect(result.stockMovements[0].type).toBe("devolucion_cliente");
  });
});
