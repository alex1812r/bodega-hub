/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";

import { getPurchaseImpact, loadPurchaseImpactInputs } from "./purchaseImpact.server";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const PURCHASE_ID = "22222222-2222-4222-8222-222222222222";
const PACK_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const PAYMENT_ID = "66666666-6666-4666-8666-666666666666";

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

const purchaseRow = {
  id: PURCHASE_ID,
  purchase_items: [
    {
      disassemble_on_receive: true,
      disassembled_conversion_id: null,
      id: ITEM_ID,
      product_id: PACK_ID,
      quantity: 2,
      tax_rate: "16.00",
      unit_cost_ref: "10.00",
    },
  ],
  purchase_number: "C-20261001-000001",
  status: "pedido",
  supplier: { name: "Distribuidora Demo" },
};

const productRows = [
  { current_cost_ref: "9.00", current_stock: 3, id: PACK_ID, is_active: true, name: "Caja x10", sku: "caj-10" },
  { current_cost_ref: null, current_stock: 20, id: UNIT_ID, is_active: false, name: "Unidad", sku: null },
];

const recipeRows = [
  {
    components: [{ cost_weight: "1", unit_product_id: UNIT_ID, units_per_pack: 10 }],
    id: "rec-1",
    pack_product_id: PACK_ID,
    total_units: 10,
  },
];

const paymentRows = [
  {
    amount: "500.00",
    amount_ref: "1.00",
    amount_ves: "500.00",
    created_at: "2026-10-01T10:00:00+00:00",
    currency: "VES",
    id: PAYMENT_ID,
    method: "transferencia",
    status: "activo",
  },
];

function userResults(overrides: Record<string, Result> = {}): Record<string, Result> {
  return {
    product_pack_conversions: { data: recipeRows, error: null },
    products: { data: productRows, error: null },
    purchases: { data: purchaseRow, error: null },
    stock_movements: { data: [{ product_id: PACK_ID, quantity_delta: -1 }], error: null },
    ...overrides,
  };
}

const receivedRow = { ...purchaseRow, status: "recibido" };

describe("loadPurchaseImpactInputs", () => {
  it("recibir: lee compra, recetas activas y productos (líneas + componentes) sin tocar pagos", async () => {
    const user = readClient(userResults());
    const privileged = jest.fn();

    const inputs = await loadPurchaseImpactInputs(
      { privileged, user: user.client as never },
      PURCHASE_ID,
      "receive",
      STORE_ID,
      { canViewPayments: true },
    );

    expect(inputs).toEqual({
      action: "receive",
      canViewPayments: true,
      disassemble: null,
      items: [
        {
          disassembled: false,
          disassembleOnReceive: true,
          id: ITEM_ID,
          productId: PACK_ID,
          quantity: 2,
          taxRate: 16,
          unitCostRef: 10,
        },
      ],
      payments: [],
      products: [
        { currentCostRef: 9, currentStock: 3, id: PACK_ID, isActive: true, name: "Caja x10", sku: "caj-10" },
        { currentCostRef: null, currentStock: 20, id: UNIT_ID, isActive: false, name: "Unidad", sku: null },
      ],
      purchase: {
        id: PURCHASE_ID,
        purchaseNumber: "C-20261001-000001",
        status: "pedido",
        supplierName: "Distribuidora Demo",
      },
      recipes: [
        {
          components: [{ costWeight: 1, unitProductId: UNIT_ID, unitsPerPack: 10 }],
          conversionId: "rec-1",
          packProductId: PACK_ID,
          totalUnits: 10,
        },
      ],
      returnedByProduct: {},
    });

    expect(privileged).not.toHaveBeenCalled();
    expect(user.from.mock.calls.map(([table]) => table).sort()).toEqual([
      "product_pack_conversions",
      "products",
      "purchases",
    ]);
    // La compra se busca con la tienda del servidor: una ajena no aparece.
    expect(user.calls).toEqual(
      expect.arrayContaining([
        { args: ["id", PURCHASE_ID], method: "eq", table: "purchases" },
        { args: ["store_id", STORE_ID], method: "eq", table: "purchases" },
        { args: ["store_id", STORE_ID], method: "eq", table: "product_pack_conversions" },
        { args: ["is_active", true], method: "eq", table: "product_pack_conversions" },
        { args: ["store_id", STORE_ID], method: "eq", table: "products" },
        { args: ["id", [PACK_ID, UNIT_ID]], method: "in", table: "products" },
      ]),
    );
  });

  it("recibir una compra que no es pedido: no consulta recetas", async () => {
    const user = readClient(userResults({ purchases: { data: receivedRow, error: null } }));

    const inputs = await loadPurchaseImpactInputs(
      { privileged: jest.fn(), user: user.client as never },
      PURCHASE_ID,
      "receive",
      STORE_ID,
    );

    expect(inputs.recipes).toEqual([]);
    expect(user.from.mock.calls.map(([table]) => table)).not.toContain("product_pack_conversions");
  });

  it.each(["cancel", "return"] as const)(
    "%s: lee lo ya devuelto y, con el cliente privilegiado, SOLO los pagos de esa compra y tienda",
    async (action) => {
      const user = readClient(userResults({ purchases: { data: receivedRow, error: null } }));
      const privileged = readClient({ payments: { data: paymentRows, error: null } });

      const inputs = await loadPurchaseImpactInputs(
        { privileged: () => privileged.client as never, user: user.client as never },
        PURCHASE_ID,
        action,
        STORE_ID,
        { canViewPayments: false, disassemble: [{ purchaseItemId: ITEM_ID }] },
      );

      expect(inputs).toMatchObject({
        action,
        canViewPayments: false,
        // La lista solo aplica a recibir.
        disassemble: null,
        payments: [
          {
            amount: 500,
            amountRef: 1,
            amountVes: 500,
            createdAt: "2026-10-01T10:00:00+00:00",
            currency: "VES",
            id: PAYMENT_ID,
            method: "transferencia",
            status: "activo",
          },
        ],
        recipes: [],
        // −Σ quantity_delta de `devolucion_proveedor`.
        returnedByProduct: { [PACK_ID]: 1 },
      });
      expect(privileged.from.mock.calls).toEqual([["payments"]]);
      expect(privileged.calls).toEqual(
        expect.arrayContaining([
          { args: ["store_id", STORE_ID], method: "eq", table: "payments" },
          { args: ["purchase_id", PURCHASE_ID], method: "eq", table: "payments" },
        ]),
      );
      expect(user.calls).toEqual(
        expect.arrayContaining([
          { args: ["purchase_id", PURCHASE_ID], method: "eq", table: "stock_movements" },
          { args: ["type", "devolucion_proveedor"], method: "eq", table: "stock_movements" },
        ]),
      );
      expect(user.from.mock.calls.map(([table]) => table)).not.toContain("payments");
    },
  );

  it("404 si la compra no existe o es de otra tienda, sin leer nada más", async () => {
    const user = readClient(userResults({ purchases: { data: null, error: null } }));
    const privileged = jest.fn();

    await expect(
      loadPurchaseImpactInputs({ privileged, user: user.client as never }, PURCHASE_ID, "cancel", STORE_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Compra no encontrada.", status: 404 });
    expect(user.from.mock.calls).toEqual([["purchases"]]);
    expect(privileged).not.toHaveBeenCalled();
  });

  it("400 con un id mal formado o una lista con ids que no son uuid, sin consultar", async () => {
    const user = readClient(userResults());
    const clients = { privileged: jest.fn(), user: user.client as never };

    await expect(loadPurchaseImpactInputs(clients, "purchase-1", "cancel", STORE_ID)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
    await expect(
      loadPurchaseImpactInputs(clients, `${PURCHASE_ID}\u0000`, "receive", STORE_ID),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      loadPurchaseImpactInputs(clients, PURCHASE_ID, "receive", STORE_ID, {
        disassemble: [{ purchaseItemId: "linea-1" }],
      }),
    ).rejects.toMatchObject({ message: "Cada linea a desarmar requiere purchase_item_id", status: 400 });
    await expect(
      loadPurchaseImpactInputs(clients, PURCHASE_ID, "receive", STORE_ID, {
        disassemble: [{ distribution: [{ unitProductId: "u", units: 1 }], purchaseItemId: ITEM_ID }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(user.from).not.toHaveBeenCalled();
  });

  it("propaga un error de lectura en vez de devolver un efecto incompleto", async () => {
    const user = readClient(userResults({ purchases: { data: receivedRow, error: null } }));
    const privileged = readClient({
      payments: { data: null, error: { code: "XX000", message: "boom" } },
    });

    await expect(
      loadPurchaseImpactInputs(
        { privileged: () => privileged.client as never, user: user.client as never },
        PURCHASE_ID,
        "cancel",
        STORE_ID,
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("getPurchaseImpact", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("recibir con desarme: calcula el efecto con el cliente de la sesión", async () => {
    const user = readClient(userResults());
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(user.client);

    const impact = await getPurchaseImpact(PURCHASE_ID, "receive", STORE_ID);

    expect(impact).toMatchObject({
      allowed: true,
      document: { status: "pedido", statusAfter: "recibido" },
    });
    expect(impact.stock).toEqual([
      expect.objectContaining({ productId: PACK_ID, quantityDelta: 0, stockAfter: 3, stockBefore: 3 }),
      expect.objectContaining({ isActive: false, productId: UNIT_ID, quantityDelta: 20, stockAfter: 40 }),
    ]);
    // Empaque 10 × 1.16 = 11.60; unidad (20 × 0 + 23.20) / 40 = 0.58.
    expect(impact.costs.map((line) => [line.productId, line.costRefBefore, line.costRefAfter])).toEqual([
      [PACK_ID, 9, 11.6],
      [UNIT_ID, null, 0.58],
    ]);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("cancelar con un pago activo: rechaza como la RPC aunque el rol no vea los pagos", async () => {
    const user = readClient(userResults({ purchases: { data: receivedRow, error: null } }));
    const privileged = readClient({ payments: { data: paymentRows, error: null } });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(user.client);
    (createAdminSupabaseClient as jest.Mock).mockReturnValue(privileged.client);

    const impact = await getPurchaseImpact(PURCHASE_ID, "cancel", STORE_ID, { canViewPayments: false });

    expect(impact).toMatchObject({
      allowed: false,
      payments: [],
      paymentsRestricted: true,
      reason:
        "La compra C-20261001-000001 tiene 1 pago(s) activo(s) por Bs 500.00. Anula primero los pagos y luego cancela la compra.",
      reasonCode: "CONFLICT",
    });
  });

  it("id mal formado: 400 antes de crear ningún cliente", async () => {
    await expect(getPurchaseImpact("nope", "cancel", STORE_ID)).rejects.toMatchObject({ status: 400 });
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });
});

/**
 * AUD-01: las líneas de pago de una compra solo viajan a quien puede ver pagos
 * de compras (`payments.view` + `purchases.view`). Cerrado por defecto: quien
 * llame sin decir qué puede ver el rol no recibe pagos.
 */
describe("acceso por rol a los pagos de la compra (AUD-01)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function clientsWithActivePayment() {
    const user = readClient(userResults({ purchases: { data: receivedRow, error: null } }));
    const privileged = readClient({ payments: { data: paymentRows, error: null } });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(user.client);
    (createAdminSupabaseClient as jest.Mock).mockReturnValue(privileged.client);

    return { privileged, user };
  }

  it("sin opciones no se ven pagos: el valor por defecto es cerrado", async () => {
    const { privileged, user } = clientsWithActivePayment();

    const inputs = await loadPurchaseImpactInputs(
      { privileged: () => privileged.client as never, user: user.client as never },
      PURCHASE_ID,
      "cancel",
      STORE_ID,
    );
    const impact = await getPurchaseImpact(PURCHASE_ID, "cancel", STORE_ID);

    expect(inputs.canViewPayments).toBe(false);
    expect(impact).toMatchObject({ allowed: false, payments: [], paymentsRestricted: true });
    expect(JSON.stringify(impact)).not.toContain(PAYMENT_ID);
  });

  it.each(["admin", "contador"] as const)("%s: recibe las líneas de pago de la compra", async (role) => {
    clientsWithActivePayment();

    const impact = await getPurchaseImpact(PURCHASE_ID, "cancel", STORE_ID, {
      canViewPayments: canViewPurchasePayments(role),
    });

    expect(impact.paymentsRestricted).toBe(false);
    expect(impact.payments).toEqual([
      expect.objectContaining({ amountVes: 500, outcome: "blocks_action", paymentId: PAYMENT_ID }),
    ]);
  });

  it.each(["almacen", "vendedor"] as const)(
    "%s: mismo veredicto que la RPC, sin líneas de pago",
    async (role) => {
      clientsWithActivePayment();

      const impact = await getPurchaseImpact(PURCHASE_ID, "cancel", STORE_ID, {
        canViewPayments: canViewPurchasePayments(role),
      });

      expect(impact).toMatchObject({
        allowed: false,
        payments: [],
        paymentsRestricted: true,
        reasonCode: "CONFLICT",
      });
      expect(JSON.stringify(impact)).not.toContain(PAYMENT_ID);
    },
  );
});
