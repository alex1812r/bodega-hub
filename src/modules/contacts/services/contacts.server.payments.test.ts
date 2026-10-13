/**
 * @jest-environment node
 *
 * GQ-05 · los pagos del contacto traen el número de su venta o compra (la
 * pestaña «Pagos» lo nombraba solo como «Compra»/«Venta»).
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getContactPayments } from "./contacts.server";

const CONTACT_ROW = {
  created_at: "2026-10-01T00:00:00.000Z",
  id: "cont-1",
  is_active: true,
  name: "Distribuidora Lab",
  store_id: DEFAULT_STORE_ID,
  type: "ambos",
  updated_at: "2026-10-01T00:00:00.000Z",
};

function paymentRow(overrides: Record<string, unknown>) {
  return {
    amount_ref: 10,
    amount_ves: 5100,
    contact_id: "cont-1",
    created_at: "2026-10-09T14:00:00.000Z",
    direction: "salida",
    id: "pay-1",
    method: "efectivo_ves",
    ref_rate_ves: 510,
    status: "confirmado",
    store_id: DEFAULT_STORE_ID,
    ...overrides,
  };
}

function createMockSupabase(payments: unknown[]) {
  const selects: string[] = [];
  const filters: Array<[string, string, unknown]> = [];

  function chainFor(table: string) {
    const chain: Record<string, jest.Mock> = {};
    const pass = (name: string) => (column: string, value: unknown) => {
      filters.push([table, `${name}:${column}`, value]);

      return chain;
    };

    chain.select = jest.fn((columns: string) => {
      if (table === "payments") {
        selects.push(columns);
      }

      return chain;
    });
    chain.eq = jest.fn(pass("eq"));
    chain.is = jest.fn(pass("is"));
    chain.order = jest.fn(() => chain);
    chain.range = jest.fn().mockResolvedValue({ count: payments.length, data: payments, error: null });
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: CONTACT_ROW, error: null });
    chain.single = jest.fn().mockResolvedValue({ data: CONTACT_ROW, error: null });

    return chain;
  }

  return { filters, from: jest.fn((table: string) => chainFor(table)), rpc: jest.fn(), selects };
}

describe("contacts.server · pagos del contacto (GQ-05)", () => {
  it("lee el número de la venta o compra de cada pago y lo devuelve como relatedDocument", async () => {
    const supabase = createMockSupabase([
      paymentRow({
        id: "pay-c",
        purchase: { id: "pur-1", purchase_number: "C-20261009-000007" },
        purchase_id: "pur-1",
      }),
      paymentRow({
        direction: "entrada",
        id: "pay-v",
        sale: { id: "sale-9", invoice_number: "V-20261008-000031" },
        sale_id: "sale-9",
      }),
      // Documento que la RLS no deja leer: sin número, la pantalla lo nombra por su tipo.
      paymentRow({ direction: "entrada", id: "pay-x", sale: null, sale_id: "sale-oculta" }),
    ]);

    jest.mocked(createRouteSupabaseClient).mockResolvedValue(supabase as never);
    // La pertenencia del contacto a la tienda se comprueba con el cliente de servicio.
    jest.mocked(createAdminSupabaseClient).mockReturnValue(supabase as never);

    const page = await getContactPayments("cont-1", new URLSearchParams(), DEFAULT_STORE_ID);

    expect(supabase.selects[0]).toContain("sale:sales(id, invoice_number)");
    expect(supabase.selects[0]).toContain("purchase:purchases(id, purchase_number)");
    expect(page.items.map((item) => [item.id, item.relatedDocument])).toEqual([
      ["pay-c", { href: "/purchases/pur-1", label: "#C-20261009-000007" }],
      ["pay-v", { href: "/sales/sale-9", label: "V-20261008-000031" }],
      ["pay-x", undefined],
    ]);
    expect(page.items[0]).toMatchObject({ amountVes: 5100, purchaseId: "pur-1" });
    expect(supabase.filters).toEqual(
      expect.arrayContaining([
        ["payments", "eq:contact_id", "cont-1"],
        ["payments", "eq:store_id", DEFAULT_STORE_ID],
      ]),
    );
  });

  it("solo cobros de venta para quien no ve pagos de compras", async () => {
    const supabase = createMockSupabase([]);

    jest.mocked(createRouteSupabaseClient).mockResolvedValue(supabase as never);
    // La pertenencia del contacto a la tienda se comprueba con el cliente de servicio.
    jest.mocked(createAdminSupabaseClient).mockReturnValue(supabase as never);

    await getContactPayments("cont-1", new URLSearchParams(), DEFAULT_STORE_ID, {
      salePaymentsOnly: true,
    });

    expect(supabase.filters).toContainEqual(["payments", "is:purchase_id", null]);
  });
});
