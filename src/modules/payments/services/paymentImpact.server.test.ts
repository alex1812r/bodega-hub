/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  getEffectivePermissions,
  type Permission,
  type StoreUserRole,
} from "@/shared/auth/permissions";
import { FULL_IMPACT_LEDGER_ACCESS, impactLedgerAccess } from "@/shared/impact/impactAccess";

import { getPaymentImpact, loadPaymentImpactInputs } from "./paymentImpact.server";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const SALE_ID = "22222222-2222-4222-8222-222222222222";
const PURCHASE_ID = "55555555-5555-4555-8555-555555555555";

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

const salePaymentRow = {
  amount: 1000,
  amount_ref: 2,
  amount_ves: "1000.00",
  change_method: "pago_movil",
  change_ref: "0.40",
  change_ves: "200.00",
  contact: { name: "Cliente Demo" },
  currency: "VES",
  id: PAYMENT_ID,
  method: "efectivo_ves",
  purchase: null,
  purchase_id: null,
  sale: {
    id: SALE_ID,
    invoice_number: "V-20261001-000001",
    paid_ves: "800.00",
    status: "pagada",
    total_ves: "800.00",
  },
  sale_id: SALE_ID,
  status: null,
};

const purchasePaymentRow = {
  ...salePaymentRow,
  change_method: null,
  change_ref: null,
  change_ves: null,
  contact: { name: "Proveedor Demo" },
  currency: "USD",
  method: "efectivo_usd",
  purchase: {
    id: PURCHASE_ID,
    paid_ref: null,
    paid_ves: "1000.00",
    purchase_number: "C-000009",
    status: "recibido",
    total_ref: "4.00",
    total_ves: "2000.00",
  },
  purchase_id: PURCHASE_ID,
  sale: null,
  sale_id: null,
};

function userResults(overrides: Record<string, Result> = {}) {
  return {
    payments: { data: salePaymentRow, error: null },
    store_vaults: {
      data: { balance_efectivo_ves: "800.00", balance_ref: "10.00", balance_ves: "5000.00", id: "vault-1" },
      error: null,
    },
    vault_movements: {
      data: [{ amount_ref: 0, amount_ves: "200.00", id: "vm-w", type: "withdrawal", vault_id: "vault-1" }],
      error: null,
    },
    ...overrides,
  };
}

const cashRows = {
  cash_movements: {
    data: [
      {
        amount_ref: 0,
        amount_ves: 1000,
        session: { register: { name: "Caja 1" }, status: "open", vault_transferred_at: null },
        type: "sale_in",
      },
      { amount_ref: 0, amount_ves: 200, session: null, type: "account_out" },
    ],
    error: null,
  },
};

describe("loadPaymentImpactInputs", () => {
  it("cobro de venta: lee el pago por id y tienda, su venta y sus asientos", async () => {
    const user = readClient(userResults());
    const privileged = readClient(cashRows);

    const inputs = await loadPaymentImpactInputs(
      { privileged: () => privileged.client as never, user: user.client as never },
      PAYMENT_ID,
      "cancel",
      STORE_ID,
      "admin",
      FULL_IMPACT_LEDGER_ACCESS,
    );

    expect(inputs).toEqual({
      action: "cancel",
      canCancelPayments: true,
      document: {
        contactName: "Cliente Demo",
        id: SALE_ID,
        kind: "sale",
        number: "V-20261001-000001",
        paidVes: 800,
        status: "pagada",
        totalVes: 800,
      },
      ledger: {
        cashMovements: [
          {
            amountRef: 0,
            amountVes: 1000,
            registerName: "Caja 1",
            sessionStatus: "open",
            type: "sale_in",
            vaultTransferredAt: null,
          },
          {
            amountRef: 0,
            amountVes: 200,
            registerName: null,
            sessionStatus: "open",
            type: "account_out",
            vaultTransferredAt: null,
          },
        ],
        kind: "full",
        vault: { balanceEfectivoVes: 800, balanceRef: 10, balanceVes: 5000, id: "vault-1" },
        vaultMovements: [
          { amountRef: 0, amountVes: 200, id: "vm-w", type: "withdrawal", vaultId: "vault-1" },
        ],
      },
      payment: {
        amount: 1000,
        amountRef: 2,
        amountVes: 1000,
        changeMethod: "pago_movil",
        changeRef: 0.4,
        changeVes: 200,
        currency: "VES",
        id: PAYMENT_ID,
        method: "efectivo_ves",
        status: "activo",
      },
    });

    // El pago se busca con la tienda del servidor: uno ajeno no aparece.
    expect(user.calls).toEqual(
      expect.arrayContaining([
        { args: ["id", PAYMENT_ID], method: "eq", table: "payments" },
        { args: ["store_id", STORE_ID], method: "eq", table: "payments" },
        { args: ["store_id", STORE_ID], method: "eq", table: "vault_movements" },
        { args: ["payment_id", PAYMENT_ID], method: "eq", table: "vault_movements" },
        { args: ["store_id", STORE_ID], method: "eq", table: "store_vaults" },
      ]),
    );
    // El cliente privilegiado solo lee los asientos de caja, acotado a tienda y pago.
    expect(privileged.from.mock.calls).toEqual([["cash_movements"]]);
    expect(privileged.calls).toEqual(
      expect.arrayContaining([
        { args: ["store_id", STORE_ID], method: "eq", table: "cash_movements" },
        { args: ["payment_id", PAYMENT_ID], method: "eq", table: "cash_movements" },
      ]),
    );
  });

  it("pago a proveedor: documento de compra con Bs y REF (paid_ref nulo = 0)", async () => {
    const user = readClient(
      userResults({
        payments: { data: purchasePaymentRow, error: null },
        vault_movements: {
          data: [{ amount_ref: "2.00", amount_ves: 0, id: "vm-p", type: "purchase_out", vault_id: "vault-1" }],
          error: null,
        },
      }),
    );
    const privileged = readClient({});

    const inputs = await loadPaymentImpactInputs(
      { privileged: () => privileged.client as never, user: user.client as never },
      PAYMENT_ID,
      "cancel",
      STORE_ID,
      "contador",
      FULL_IMPACT_LEDGER_ACCESS,
    );

    expect(inputs.document).toEqual({
      contactName: "Proveedor Demo",
      id: PURCHASE_ID,
      kind: "purchase",
      number: "C-000009",
      paidRef: 0,
      paidVes: 1000,
      status: "recibido",
      totalRef: 4,
      totalVes: 2000,
    });
    expect(inputs.payment).toMatchObject({ changeMethod: null, changeVes: 0, currency: "USD" });
    expect(inputs.ledger).toMatchObject({
      cashMovements: [],
      vaultMovements: [{ amountRef: 2, amountVes: 0, id: "vm-p", type: "purchase_out", vaultId: "vault-1" }],
    });
  });

  it("pago ya anulado: no lee caja ni baúl ni usa el cliente privilegiado", async () => {
    const user = readClient(
      userResults({ payments: { data: { ...salePaymentRow, status: "anulado" }, error: null } }),
    );
    const privileged = jest.fn();

    const inputs = await loadPaymentImpactInputs(
      { privileged, user: user.client as never },
      PAYMENT_ID,
      "cancel",
      STORE_ID,
      "admin",
      FULL_IMPACT_LEDGER_ACCESS,
    );

    expect(inputs.payment.status).toBe("anulado");
    expect(inputs.ledger).toEqual({ cashMovements: [], kind: "full", vault: null, vaultMovements: [] });
    expect(privileged).not.toHaveBeenCalled();
    expect(user.from.mock.calls).toEqual([["payments"]]);
  });

  it("rol al que la RPC no deja anular: lo marca para el veredicto", async () => {
    const user = readClient(userResults());
    const privileged = readClient(cashRows);

    const inputs = await loadPaymentImpactInputs(
      { privileged: () => privileged.client as never, user: user.client as never },
      PAYMENT_ID,
      "cancel",
      STORE_ID,
      "vendedor",
      FULL_IMPACT_LEDGER_ACCESS,
    );

    expect(inputs.canCancelPayments).toBe(false);
  });

  it("403 para un rol que no opera pagos de compras, sin leer asientos", async () => {
    const user = readClient(userResults({ payments: { data: purchasePaymentRow, error: null } }));
    const privileged = jest.fn();

    await expect(
      loadPaymentImpactInputs({ privileged, user: user.client as never }, PAYMENT_ID, "cancel", STORE_ID, "vendedor", FULL_IMPACT_LEDGER_ACCESS),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(privileged).not.toHaveBeenCalled();
    expect(user.from.mock.calls).toEqual([["payments"]]);
  });

  it("404 si el pago no existe o es de otra tienda", async () => {
    const user = readClient(userResults({ payments: { data: null, error: null } }));

    await expect(
      loadPaymentImpactInputs({ privileged: jest.fn(), user: user.client as never }, PAYMENT_ID, "cancel", STORE_ID, "admin", FULL_IMPACT_LEDGER_ACCESS),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Pago no encontrado.", status: 404 });
    expect(user.from.mock.calls).toEqual([["payments"]]);
  });

  it("404 si el documento del pago no se puede leer", async () => {
    const withoutSale = readClient(
      userResults({ payments: { data: { ...salePaymentRow, sale: null }, error: null } }),
    );
    const withoutPurchase = readClient(
      userResults({ payments: { data: { ...purchasePaymentRow, purchase: null }, error: null } }),
    );

    await expect(
      loadPaymentImpactInputs({ privileged: jest.fn(), user: withoutSale.client as never }, PAYMENT_ID, "cancel", STORE_ID, "admin", FULL_IMPACT_LEDGER_ACCESS),
    ).rejects.toMatchObject({ message: "Venta no encontrada.", status: 404 });
    await expect(
      loadPaymentImpactInputs({ privileged: jest.fn(), user: withoutPurchase.client as never }, PAYMENT_ID, "cancel", STORE_ID, "admin", FULL_IMPACT_LEDGER_ACCESS),
    ).rejects.toMatchObject({ message: "Compra no encontrada.", status: 404 });
  });

  it("400 con un id mal formado, sin consultar", async () => {
    const user = readClient(userResults());

    await expect(
      loadPaymentImpactInputs({ privileged: jest.fn(), user: user.client as never }, "pay-1", "cancel", STORE_ID, "admin", FULL_IMPACT_LEDGER_ACCESS),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    await expect(
      loadPaymentImpactInputs(
        { privileged: jest.fn(), user: user.client as never },
        `${PAYMENT_ID}\u0000`,
        "cancel",
        STORE_ID,
        "admin",
        FULL_IMPACT_LEDGER_ACCESS,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(user.from).not.toHaveBeenCalled();
  });

  it("propaga un error de lectura en vez de devolver un efecto incompleto", async () => {
    const privileged = readClient(cashRows);

    for (const table of ["vault_movements", "store_vaults"]) {
      const user = readClient(
        userResults({ [table]: { data: null, error: { code: "XX000", message: "boom" } } }),
      );

      await expect(
        loadPaymentImpactInputs(
          { privileged: () => privileged.client as never, user: user.client as never },
          PAYMENT_ID,
          "cancel",
          STORE_ID,
          "admin",
          FULL_IMPACT_LEDGER_ACCESS,
        ),
      ).rejects.toBeInstanceOf(Error);
    }
  });
});

describe("getPaymentImpact", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calcula el efecto con el cliente de la sesión y el privilegiado", async () => {
    const user = readClient(userResults());
    const privileged = readClient(cashRows);
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(user.client);
    (createAdminSupabaseClient as jest.Mock).mockReturnValue(privileged.client);

    const impact = await getPaymentImpact(PAYMENT_ID, "cancel", STORE_ID, "admin", FULL_IMPACT_LEDGER_ACCESS);

    expect(impact).toMatchObject({
      allowed: true,
      document: { paidVes: 800, paidVesAfter: 0, status: "pagada", statusAfter: "pendiente_pago" },
      inexact: null,
      payment: { netVes: 800, statusAfter: "anulado" },
    });
    expect(impact.effects.map((effect) => [effect.target, effect.delta, effect.targetName])).toEqual([
      ["baul_cuenta", 200, null],
      ["caja", -1000, "Caja 1"],
      ["caja", 200, null],
    ]);
    expect(impact.effects[0]).toMatchObject({ balanceAfter: 5200, balanceBefore: 5000 });
  });

  it("id mal formado: 400 antes de crear ningún cliente", async () => {
    await expect(getPaymentImpact("nope", "cancel", STORE_ID, "admin", FULL_IMPACT_LEDGER_ACCESS)).rejects.toMatchObject({ status: 400 });
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });
});

/**
 * AUD-01: cada dato del impact va cubierto por un permiso del llamante. Los
 * saldos del baúl exigen `vault.view`; el detalle de la caja, `cash.view`.
 */
describe("acceso por rol al libro de caja y baúl (AUD-01)", () => {
  const bankPayment = {
    ...salePaymentRow,
    change_method: null,
    change_ref: null,
    change_ves: null,
    method: "pago_movil",
    sale: { ...salePaymentRow.sale, paid_ves: "1000.00", total_ves: "1000.00" },
  };

  async function impactFor(role: StoreUserRole, deniedPermissions: Permission[] = []) {
    const user = readClient(
      userResults({
        payments: { data: bankPayment, error: null },
        store_vaults: {
          data: {
            balance_efectivo_ves: "61234.50",
            balance_ref: "7123.45",
            balance_ves: "54321.98",
            id: "vault-1",
          },
          error: null,
        },
        vault_movements: {
          data: [{ amount_ref: 0, amount_ves: "1000.00", id: "vm-s", type: "sale_in", vault_id: "vault-1" }],
          error: null,
        },
      }),
    );
    const privileged = readClient({
      cash_movements: {
        data: [{ ...cashRows.cash_movements.data[0], type: "account_in" }],
        error: null,
      },
    });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(user.client);
    (createAdminSupabaseClient as jest.Mock).mockReturnValue(privileged.client);

    const impact = await getPaymentImpact(
      PAYMENT_ID,
      "cancel",
      STORE_ID,
      role,
      impactLedgerAccess(getEffectivePermissions({ deniedPermissions, role })),
    );

    return { impact, tables: user.from.mock.calls.map(([table]) => table), text: JSON.stringify(impact) };
  }

  it.each(["admin", "contador"] as const)(
    "%s (payments.manage + vault.view + cash.view): saldos del baúl y nombre de la caja",
    async (role) => {
      const { impact, tables } = await impactFor(role);

      expect(tables).toContain("store_vaults");
      expect(impact.allowed).toBe(true);
      expect(impact.effects).toEqual([
        expect.objectContaining({ delta: -1000, target: "caja", targetName: "Caja 1" }),
        expect.objectContaining({
          balanceAfter: 53321.98,
          balanceBefore: 54321.98,
          delta: -1000,
          target: "baul_cuenta",
        }),
      ]);
    },
  );

  it("contador con vault.view denegado: no lee store_vaults; el asiento de baúl va sin saldos y no es inexacto", async () => {
    const { impact, tables, text } = await impactFor("contador", ["vault.view"]);

    expect(tables).not.toContain("store_vaults");
    expect(text).not.toMatch(/54321|61234|7123/);
    expect(impact.allowed).toBe(true);
    expect(impact.inexact).toBeNull();
    expect(impact.effects[1]).toEqual({
      balanceAfter: null,
      balanceBefore: null,
      currency: "VES",
      delta: -1000,
      note: null,
      physical: true,
      restricted: true,
      target: "baul_cuenta",
      targetName: null,
    });
    expect(impact.description).toContain("salen Bs. 1.000,00 del baúl (cuenta)");
  });

  it("contador con cash.view denegado: el asiento de caja va sin nombre de caja", async () => {
    const { impact, text } = await impactFor("contador", ["cash.view"]);

    expect(text).not.toContain("Caja 1");
    expect(impact.effects[0]).toMatchObject({
      delta: -1000,
      note: null,
      restricted: true,
      target: "caja",
      targetName: null,
    });
    expect(impact.description).toContain("del turno de la caja;");
    // El baúl sí lo puede ver.
    expect(impact.effects[1]).toMatchObject({ balanceAfter: 53321.98, balanceBefore: 54321.98 });
  });

  it.each(["vendedor", "almacen"] as const)(
    "%s (sin vault.view; la ruta ya le da 403): el cargador tampoco lee store_vaults ni devuelve saldos",
    async (role) => {
      const { impact, tables, text } = await impactFor(role);

      expect(tables).not.toContain("store_vaults");
      expect(text).not.toMatch(/54321|61234|7123/);
      expect(impact).toMatchObject({ allowed: false, effects: [], reasonCode: "FORBIDDEN" });
    },
  );
});
