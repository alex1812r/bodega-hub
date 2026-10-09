/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { getSaleImpact, loadSaleImpactInputs } from "./saleImpact.server";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const SALE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";

type Result = { data: unknown; error: unknown };
type Call = { args: unknown[]; method: string; table: string };

/**
 * Cliente falso de solo lectura: registra cada llamada y responde por tabla.
 * No expone `insert` / `update` / `delete` / `upsert` / `rpc`: cualquier
 * escritura del cargador rompería el test con un TypeError.
 */
function readClient(results: Record<string, Result>) {
  const calls: Call[] = [];

  const from = jest.fn((table: string) => {
    const result = results[table] ?? { data: [], error: null };
    const builder = {
      eq: (...args: unknown[]) => track("eq", args),
      in: (...args: unknown[]) => track("in", args),
      maybeSingle: () => Promise.resolve(result),
      returns: () => Promise.resolve(result),
      select: (...args: unknown[]) => track("select", args),
    };

    function track(method: string, args: unknown[]) {
      calls.push({ args, method, table });
      return builder;
    }

    return builder;
  });

  return { calls, client: { from }, from };
}

const saleRow = {
  customer: { name: "Cliente Demo" },
  id: SALE_ID,
  invoice_number: "V-20261001-000001",
  paid_ves: "1000.00",
  payments: [
    {
      amount: 1000,
      amount_ref: 2,
      amount_ves: 1000,
      change_method: null,
      change_ref: null,
      change_ves: null,
      created_at: "2026-10-01T10:00:00+00:00",
      currency: "VES",
      id: PAYMENT_ID,
      method: "efectivo_ves",
      status: null,
    },
  ],
  sale_items: [{ product_id: PRODUCT_ID, quantity: 2 }],
  status: "pagada",
};

function userResults(overrides: Record<string, Result> = {}) {
  return {
    products: {
      data: [{ current_stock: 5, id: PRODUCT_ID, is_active: true, name: "Harina", sku: "har-1" }],
      error: null,
    },
    sales: { data: saleRow, error: null },
    stock_movements: { data: [{ product_id: PRODUCT_ID, quantity_delta: 1 }], error: null },
    store_vaults: { data: { balance_ves: "5000.00", id: "vault-1" }, error: null },
    vault_movements: { data: [], error: null },
    ...overrides,
  };
}

const cashRows = {
  cash_movements: {
    data: [
      {
        amount_ref: 0,
        amount_ves: 1000,
        payment_id: PAYMENT_ID,
        session: { register: { name: "Caja 1" }, status: "open", vault_transferred_at: null },
        session_id: "session-1",
        type: "sale_in",
      },
    ],
    error: null,
  },
};

describe("loadSaleImpactInputs", () => {
  it("devolver: lee la venta por id y tienda, y los asientos de sus pagos activos", async () => {
    const user = readClient(userResults());
    const privileged = readClient(cashRows);

    const inputs = await loadSaleImpactInputs(
      { privileged: () => privileged.client as never, user: user.client as never },
      SALE_ID,
      "return",
      STORE_ID,
    );

    expect(inputs).toEqual({
      action: "return",
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      ledger: {
        cashMovements: [
          {
            amountRef: 0,
            amountVes: 1000,
            paymentId: PAYMENT_ID,
            registerName: "Caja 1",
            sessionId: "session-1",
            sessionStatus: "open",
            type: "sale_in",
            vaultTransferredAt: null,
          },
        ],
        kind: "full",
        vault: { balanceVes: 5000, id: "vault-1" },
        vaultMovements: [],
      },
      payments: [
        {
          amount: 1000,
          amountRef: 2,
          amountVes: 1000,
          changeMethod: null,
          changeRef: 0,
          changeVes: 0,
          createdAt: "2026-10-01T10:00:00+00:00",
          currency: "VES",
          id: PAYMENT_ID,
          method: "efectivo_ves",
          status: "activo",
        },
      ],
      products: [{ currentStock: 5, id: PRODUCT_ID, isActive: true, name: "Harina", sku: "har-1" }],
      returnedByProduct: { [PRODUCT_ID]: 1 },
      sale: {
        customerName: "Cliente Demo",
        id: SALE_ID,
        invoiceNumber: "V-20261001-000001",
        paidVes: 1000,
        status: "pagada",
      },
    });

    // La venta se busca con la tienda del servidor: una ajena no aparece.
    expect(user.calls).toEqual(
      expect.arrayContaining([
        { args: ["id", SALE_ID], method: "eq", table: "sales" },
        { args: ["store_id", STORE_ID], method: "eq", table: "sales" },
        { args: ["store_id", STORE_ID], method: "eq", table: "products" },
        { args: ["store_id", STORE_ID], method: "eq", table: "vault_movements" },
        { args: ["store_id", STORE_ID], method: "eq", table: "store_vaults" },
      ]),
    );
    // El cliente privilegiado solo lee los asientos de caja, acotado a tienda y pagos.
    expect(privileged.from.mock.calls).toEqual([["cash_movements"]]);
    expect(privileged.calls).toEqual(
      expect.arrayContaining([
        { args: ["store_id", STORE_ID], method: "eq", table: "cash_movements" },
        { args: ["payment_id", [PAYMENT_ID]], method: "in", table: "cash_movements" },
      ]),
    );
  });

  it("anular: no lee caja ni baúl ni usa el cliente privilegiado", async () => {
    const user = readClient(userResults());
    const privileged = jest.fn();

    const inputs = await loadSaleImpactInputs(
      { privileged, user: user.client as never },
      SALE_ID,
      "cancel",
      STORE_ID,
    );

    expect(inputs.ledger).toEqual({
      cashMovements: [],
      kind: "full",
      vault: null,
      vaultMovements: [],
    });
    expect(privileged).not.toHaveBeenCalled();
    expect(user.from.mock.calls.map(([table]) => table).sort()).toEqual([
      "products",
      "sales",
      "stock_movements",
    ]);
  });

  it("devolver sin pagos activos: tampoco lee asientos", async () => {
    const user = readClient(
      userResults({
        sales: {
          data: { ...saleRow, payments: [{ ...saleRow.payments[0], status: "anulado" }] },
          error: null,
        },
      }),
    );
    const privileged = jest.fn();

    await loadSaleImpactInputs({ privileged, user: user.client as never }, SALE_ID, "return", STORE_ID);

    expect(privileged).not.toHaveBeenCalled();
    expect(user.from.mock.calls.map(([table]) => table)).not.toContain("vault_movements");
  });

  it("404 si la venta no existe o es de otra tienda", async () => {
    const user = readClient(userResults({ sales: { data: null, error: null } }));

    await expect(
      loadSaleImpactInputs({ privileged: jest.fn(), user: user.client as never }, SALE_ID, "cancel", STORE_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Venta no encontrada.", status: 404 });
    expect(user.from.mock.calls).toEqual([["sales"]]);
  });

  it("400 con un id mal formado, sin consultar", async () => {
    const user = readClient(userResults());

    await expect(
      loadSaleImpactInputs({ privileged: jest.fn(), user: user.client as never }, "sale-1", "cancel", STORE_ID),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    await expect(
      loadSaleImpactInputs(
        { privileged: jest.fn(), user: user.client as never },
        `${SALE_ID}\u0000`,
        "cancel",
        STORE_ID,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(user.from).not.toHaveBeenCalled();
  });

  it("propaga un error de lectura en vez de devolver un efecto incompleto", async () => {
    const user = readClient(userResults());
    const privileged = readClient({
      cash_movements: { data: null, error: { code: "XX000", message: "boom" } },
    });

    await expect(
      loadSaleImpactInputs(
        { privileged: () => privileged.client as never, user: user.client as never },
        SALE_ID,
        "return",
        STORE_ID,
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("getSaleImpact", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calcula el efecto con el cliente de la sesión y el privilegiado", async () => {
    const user = readClient(userResults());
    const privileged = readClient(cashRows);
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(user.client);
    (createAdminSupabaseClient as jest.Mock).mockReturnValue(privileged.client);

    const impact = await getSaleImpact(SALE_ID, "return", STORE_ID);

    expect(impact).toMatchObject({
      allowed: true,
      document: { status: "pagada", statusAfter: "devuelta" },
      paidVes: 1000,
      paidVesAfter: 0,
    });
    // Vendido 2, ya devuelto 1.
    expect(impact.stock).toEqual([
      expect.objectContaining({ quantityDelta: 1, stockAfter: 6, stockBefore: 5 }),
    ]);
    expect(impact.payments[0].effects).toEqual([
      expect.objectContaining({ delta: -1000, target: "caja", targetName: "Caja 1" }),
    ]);
  });

  it("id mal formado: 400 antes de crear ningún cliente", async () => {
    await expect(getSaleImpact("nope", "cancel", STORE_ID)).rejects.toMatchObject({ status: 400 });
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });
});
