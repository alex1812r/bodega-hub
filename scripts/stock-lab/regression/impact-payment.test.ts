/**
 * CNF-14 · El impact de un pago predice lo que `cancel_payment` aplica.
 *
 * Por cada caso: se crea el documento y su pago por las RPC reales (supabase-js
 * + sesión de un usuario lab), se calcula el impact con el MISMO código del BFF
 * (`loadPaymentImpactInputs` + `computePaymentImpact`), se comprueba que
 * calcularlo no escribió nada, se ejecuta `cancel_payment` y se compara lo
 * aplicado con lo predicho: estado del pago, pagado y estado del documento,
 * asientos de caja borrados y saldo de las tres cubetas del baúl. En los
 * rechazos, el mensaje y el código de la RPC son los de `reason` / `reasonCode`
 * y no cambia nada.
 *
 * Corre contra la base lab local (`npm run stock-lab:test`). `pg` (rol postgres)
 * solo prepara datos y lee el resultado. Datos propios con prefijo `RIMPP-<nonce>`;
 * se borran en `afterAll`, que además devuelve el baúl a sus saldos iniciales.
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { computePaymentImpact, type PaymentImpact } from "../../../src/modules/payments/services/paymentImpact";
import { loadPaymentImpactInputs } from "../../../src/modules/payments/services/paymentImpact.server";
import type { UserRole } from "../../../src/shared/auth/permissions";
import { FULL_IMPACT_LEDGER_ACCESS } from "../../../src/shared/impact/impactAccess";
import type { LabRoleKey } from "../agents/base";
import { Lab } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type Seller = "vendedor1" | "vendedor2";
type VaultBalances = { baul_cuenta: number; baul_efectivo_ves: number; baul_ref: number };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `RIMPP-${NONCE}`;
const REJECTION_CODES: Record<string, string> = {
  PT400: "BAD_REQUEST",
  PT403: "FORBIDDEN",
  PT404: "NOT_FOUND",
  PT409: "CONFLICT",
};
/** Rol de la app (el que recibe el BFF en `auth.role`) de cada usuario lab. */
const APP_ROLES: Record<LabRoleKey, UserRole> = {
  admin: "admin",
  almacen: "almacen",
  contador: "contador",
  vendedor1: "vendedor",
  vendedor2: "vendedor",
};

let lab: Lab;
let seq = 0;
let vaultAtStart: VaultBalances | null = null;
const productIds: string[] = [];
const purchaseIds: string[] = [];
const registerIds: string[] = [];
const foreignPaymentIds: string[] = [];
const foreignSaleIds: string[] = [];
const foreignContactIds: string[] = [];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

async function setup<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`SETUP ${what}: ${messageOf(error)}`);
  }
}

async function rpcAs(role: LabRoleKey, fn: string, args: Row): Promise<RpcResult> {
  const client: SupabaseClient = await setup(`sesión de ${role}`, () => lab.supa(role));
  const { data, error } = await client.rpc(fn, args);
  return { data, error };
}

async function rpcOk(role: LabRoleKey, fn: string, args: Row): Promise<Row> {
  const res = await rpcAs(role, fn, args);
  if (res.error) throw new Error(`SETUP ${fn} como ${role}: ${res.error.code ?? ""} ${res.error.message}`);
  return (res.data ?? {}) as Row;
}

async function one(text: string, params: unknown[]): Promise<Row> {
  const rows = await lab.rows(text, params);
  if (!rows[0]) throw new Error(`SETUP sin filas: ${text}`);
  return rows[0];
}

async function rate(): Promise<number> {
  const row = await one(
    "select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  return Number(row.rate_ves);
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

async function mkProduct(key: string, stock: number): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${key}-${seq}`;
  const row = await one(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, 1, 0.5, 0, 0, true) returning id`,
    [lab.storeId, sku, `Producto ${sku}`],
  );
  const id = String(row.id);
  productIds.push(id);
  if (stock > 0) {
    await rpcOk("admin", "adjust_stock", {
      p_product_id: id,
      p_quantity_delta: stock,
      p_reason: `${TAG} inventario inicial`,
      p_type: "inventario_inicial",
    });
  }
  return id;
}

/** Venta de 3 unidades a REF 1, sin cobrar. */
async function mkSale(role: LabRoleKey, key: string): Promise<Row> {
  const productId = await mkProduct(key, 10);
  seq += 1;
  return rpcOk(role, "create_sale", {
    p_customer_id: lab.customerId,
    p_items: [{ product_id: productId, quantity: 3, unit_price_ref: 1 }],
    p_exchange_rate_id: null,
    p_ref_rate_ves: await rate(),
    p_invoice_number: `${TAG}-V${seq}`,
  });
}

async function ensureCashSession(role: Seller): Promise<void> {
  const open = () =>
    lab.rows(
      `select s.id from public.cash_sessions s join public.cash_registers r on r.id = s.register_id
       where r.assigned_user_id = $1 and r.is_active and s.status = 'open'`,
      [lab.uids[role]],
    );
  if ((await open()).length > 0) return;
  const register = await one(
    "select id from public.cash_registers where store_id = $1 and assigned_user_id = $2 and is_active limit 1",
    [lab.storeId, lab.uids[role]],
  );
  const res = await rpcAs(role, "open_cash_session", { p_register_id: register.id, p_opening_ves: 0, p_opening_ref: 0 });
  if ((await open()).length === 0) throw new Error(`SETUP caja de ${role}: ${res.error?.message ?? "sin sesión abierta"}`);
}

/** Venta cobrada por `role` en su caja con un solo pago; devuelve el id del pago. */
async function salePayment(role: Seller, key: string, payment: (sale: Row, rateVes: number) => Row): Promise<string> {
  await ensureCashSession(role);
  const sale = await mkSale(role, key);
  const paid = await rpcOk(role, "register_payment", { p_sale_id: sale.id, ...payment(sale, await rate()) });
  return String(paid.id);
}

/** Deja saldo en la cubeta "cuenta" del baúl con un cobro real por transferencia (queda activo). */
async function fundAccount(key: string): Promise<void> {
  await salePayment("vendedor1", `fondo-${key}`, (sale) => ({
    p_method: "transferencia",
    p_amount: Number(sale.total_ves),
    p_bank_name: `Banco ${TAG}`,
    p_reference_code: "009911",
  }));
}

/** Compra recibida de 4 unidades a REF 1 con un pago parcial; devuelve el id del pago. */
async function purchasePayment(key: string, payment: (rateVes: number) => Row): Promise<string> {
  const rateVes = await rate();
  const productId = await mkProduct(key, 0);
  seq += 1;
  const purchase = await rpcOk("almacen", "create_purchase", {
    p_supplier_id: lab.supplierId,
    p_items: [
      {
        product_id: productId,
        entry_mode: "unit",
        quantity: 4,
        cost_currency: "ref",
        unit_cost_ref: 1,
        unit_cost_ves: rateVes,
        subtotal_ref: 4,
        subtotal_ves: money(4 * rateVes),
        tax_rate: 0,
        tax_ref: 0,
        tax_ves: 0,
      },
    ],
    p_ref_rate_ves: rateVes,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_purchase_number: `${TAG}-C${seq}`,
    p_status: "recibido",
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: money(4 * rateVes),
    p_subtotal_ref: 4,
  });
  purchaseIds.push(String(purchase.id));
  const paid = await rpcOk("admin", "register_payment", { p_purchase_id: purchase.id, ...payment(rateVes) });
  return String(paid.id);
}

async function vaultBalances(): Promise<VaultBalances | null> {
  const rows = await lab.rows<VaultBalances>(
    `select balance_ves::float8 as baul_cuenta, balance_efectivo_ves::float8 as baul_efectivo_ves,
            balance_ref::float8 as baul_ref
     from public.store_vaults where store_id = $1`,
    [lab.storeId],
  );
  return rows[0] ?? null;
}

type CashRow = { amount_ref: number; amount_ves: number; register: string | null; type: string };

type Snapshot = {
  cashMovements: CashRow[];
  document: { paidRef: number | null; paidVes: number; status: string };
  payment: string;
  vault: VaultBalances | null;
  vaultMovements: number;
};

/** Todo lo que la anulación puede tocar, leído por `pg`. */
async function snapshot(paymentId: string): Promise<Snapshot> {
  const payment = await one(
    "select status::text as status, sale_id, purchase_id from public.payments where id = $1",
    [paymentId],
  );
  const document = payment.sale_id
    ? await one(
        "select status::text as status, paid_ves::float8 as paid_ves, null::float8 as paid_ref from public.sales where id = $1",
        [payment.sale_id],
      )
    : await one(
        `select status::text as status, paid_ves::float8 as paid_ves, coalesce(paid_ref, 0)::float8 as paid_ref
         from public.purchases where id = $1`,
        [payment.purchase_id],
      );
  const cashMovements = await lab.rows<CashRow>(
    `select m.type::text as type, m.amount_ves::float8 as amount_ves, m.amount_ref::float8 as amount_ref, r.name as register
     from public.cash_movements m
     join public.cash_sessions s on s.id = m.session_id
     join public.cash_registers r on r.id = s.register_id
     where m.payment_id = $1 order by m.type, m.id`,
    [paymentId],
  );
  const vaultMovements = await one(
    "select count(*)::int as total from public.vault_movements where payment_id = $1",
    [paymentId],
  );
  return {
    cashMovements,
    document: {
      paidRef: document.paid_ref === null ? null : Number(document.paid_ref),
      paidVes: Number(document.paid_ves),
      status: String(document.status),
    },
    payment: String(payment.status),
    vault: await vaultBalances(),
    vaultMovements: Number(vaultMovements.total),
  };
}

/**
 * El impact tal como lo calcula el BFF: lecturas del usuario + asientos de caja con service role.
 * Con el libro completo a la vista (`cash.view` + `vault.view`): aquí se comprueban los saldos
 * previstos contra los que deja la RPC.
 */
async function impactOf(role: LabRoleKey, paymentId: string, storeId = lab.storeId): Promise<PaymentImpact> {
  const user = await lab.supa(role);
  return computePaymentImpact(
    await loadPaymentImpactInputs({ privileged: () => lab.service(), user }, paymentId, "cancel", storeId, APP_ROLES[role], FULL_IMPACT_LEDGER_ACCESS),
  );
}

type CashAmount = { amount: number; currency: string; register: string | null };

function byCashAmount(left: CashAmount, right: CashAmount): number {
  return `${left.currency}${left.amount}`.localeCompare(`${right.currency}${right.amount}`);
}

/**
 * Pide el impact, comprueba que no escribió, ejecuta `cancel_payment` y compara.
 * Devuelve el impact para las aserciones propias de cada caso.
 */
async function predictAndApply(role: LabRoleKey, paymentId: string): Promise<PaymentImpact> {
  const before = await snapshot(paymentId);
  const impact = await impactOf(role, paymentId);

  // Solo lectura: nada cambió por calcularlo.
  expect(await snapshot(paymentId)).toEqual(before);
  // El "antes" del impact es el de la base.
  expect(impact.payment.status).toBe(before.payment);
  expect({ paidRef: impact.document.paidRef, paidVes: impact.document.paidVes, status: impact.document.status }).toEqual(
    before.document,
  );

  const applied = await rpcAs(role, "cancel_payment", { p_payment_id: paymentId });
  const after = await snapshot(paymentId);

  if (!impact.allowed) {
    expect(applied.error?.message).toBe(impact.reason);
    expect(REJECTION_CODES[applied.error?.code ?? ""]).toBe(impact.reasonCode);
    expect(after).toEqual(before);
    expect(impact.effects).toEqual([]);
    return impact;
  }

  expect(applied.error).toBeNull();
  expect(impact.inexact).toBeNull();
  expect(after.payment).toBe(impact.payment.statusAfter);
  expect(after.document).toEqual({
    paidRef: impact.document.paidRefAfter,
    paidVes: impact.document.paidVesAfter,
    status: impact.document.statusAfter,
  });

  // Asientos de caja: los que predice el impact son exactamente los que había, y ya no están.
  const predictedCash = impact.effects
    .filter((effect) => effect.target === "caja")
    .map((effect) => ({ amount: Math.abs(effect.delta), currency: effect.currency, register: effect.targetName }));
  const realCash = before.cashMovements.flatMap((row) => [
    ...(row.amount_ves > 0 ? [{ amount: row.amount_ves, currency: "VES", register: row.register }] : []),
    ...(row.amount_ref > 0 ? [{ amount: row.amount_ref, currency: "USD", register: row.register }] : []),
  ]);
  expect([...predictedCash].sort(byCashAmount)).toEqual([...realCash].sort(byCashAmount));
  expect(after.cashMovements).toEqual(impact.document.kind === "sale" ? [] : before.cashMovements);
  // Los asientos de baúl del pago desaparecen.
  expect(after.vaultMovements).toBe(0);

  // Baúl: cada asiento parte del saldo real y el último saldo predicho es el real.
  const expectedVault = before.vault ? { ...before.vault } : null;
  for (const effect of impact.effects) {
    if (effect.target === "caja") continue;
    expect(expectedVault).not.toBeNull();
    if (!expectedVault) continue;
    expect(effect.balanceBefore).toBe(expectedVault[effect.target]);
    expect(effect.balanceAfter).toEqual(expect.any(Number));
    expectedVault[effect.target] = effect.balanceAfter ?? Number.NaN;
  }
  expect(after.vault).toEqual(expectedVault);

  return impact;
}

async function cleanup(): Promise<void> {
  try {
    await lab.db.query("begin");
    await lab.db.query("delete from public.payments where id = any($1::uuid[])", [foreignPaymentIds]);
    await lab.db.query("delete from public.sales where id = any($1::uuid[])", [foreignSaleIds]);
    await lab.db.query("delete from public.contacts where id = any($1::uuid[])", [foreignContactIds]);
    const sessions = (await lab.rows("select id from public.cash_sessions where register_id = any($1::uuid[])", [registerIds])).map((r) => r.id);
    const sales = (await lab.rows("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
    const payments = (
      await lab.rows("select id from public.payments where sale_id = any($1::uuid[]) or purchase_id = any($2::uuid[])", [sales, purchaseIds])
    ).map((r) => r.id);
    await lab.db.query("delete from public.cash_movements where payment_id = any($1::uuid[]) or session_id = any($2::uuid[])", [payments, sessions]);
    await lab.db.query(
      "delete from public.vault_movements where payment_id = any($1::uuid[]) or from_session_id = any($2::uuid[]) or (store_id = $3 and notes like $4)",
      [payments, sessions, lab.storeId, `${TAG}%`],
    );
    await lab.db.query("delete from public.payments where id = any($1::uuid[])", [payments]);
    await lab.db.query("delete from public.cash_sessions where id = any($1::uuid[])", [sessions]);
    await lab.db.query("delete from public.cash_registers where id = any($1::uuid[])", [registerIds]);
    await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
    await lab.db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
    await lab.db.query("delete from public.purchase_items where purchase_id = any($1::uuid[])", [purchaseIds]);
    await lab.db.query("delete from public.purchases where id = any($1::uuid[])", [purchaseIds]);
    await lab.db.query("delete from public.supplier_products where product_id = any($1::uuid[])", [productIds]);
    await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
    // Los asientos de baúl de este archivo ya no existen: el saldo vuelve al de partida.
    if (vaultAtStart) {
      await lab.db.query(
        "update public.store_vaults set balance_ves = $2, balance_efectivo_ves = $3, balance_ref = $4 where store_id = $1",
        [lab.storeId, vaultAtStart.baul_cuenta, vaultAtStart.baul_efectivo_ves, vaultAtStart.baul_ref],
      );
    }
    await lab.db.query("commit");
  } catch {
    await lab.db.query("rollback").catch(() => undefined);
    await lab.db.query("update public.products set is_active = false where id = any($1::uuid[])", [productIds]).catch(() => undefined);
  }
}

beforeAll(async () => {
  lab = await setup("abrir el laboratorio", () => Lab.open("rimpp"));
  vaultAtStart = await setup("saldos iniciales del baúl", () => vaultBalances());
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

describe("CNF-14 · impact de anular un cobro de venta = lo que aplica cancel_payment", () => {
  it("efectivo Bs con caja abierta: sale de esa caja y la venta vuelve a pendiente de pago", async () => {
    const paymentId = await setup("cobro en Bs", () =>
      salePayment("vendedor1", "ves", (sale) => ({ p_method: "efectivo_ves", p_amount: Number(sale.total_ves) })),
    );

    const impact = await predictAndApply("admin", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.payment).toMatchObject({ direction: "entrada", method: "efectivo_ves", statusAfter: "anulado" });
    expect(impact.document).toMatchObject({ kind: "sale", paidVesAfter: 0, status: "pagada", statusAfter: "pendiente_pago" });
    expect(impact.document.pendingVesAfter).toBe(impact.document.totalVes);
    expect(impact.effects).toEqual([
      expect.objectContaining({ currency: "VES", delta: -impact.payment.amountVes, physical: true, target: "caja" }),
    ]);
    expect(impact.effects[0].targetName).toEqual(expect.any(String));
  });

  it("pago móvil: quita el asiento informativo de la caja y saca el cobro del baúl (cuenta)", async () => {
    const paymentId = await setup("cobro por pago móvil", () =>
      salePayment("vendedor1", "pm", (sale) => ({
        p_method: "pago_movil",
        p_amount: Number(sale.total_ves),
        p_bank_name: `Banco ${TAG}`,
        p_phone: "04140000000",
        p_reference_code: "4455",
      })),
    );

    const impact = await predictAndApply("contador", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.effects.map((effect) => [effect.target, effect.physical])).toEqual([
      ["caja", false],
      ["baul_cuenta", true],
    ]);
    expect(impact.effects[1]).toMatchObject({ delta: -impact.payment.amountVes, note: null });
  });

  it("efectivo USD: el asiento de caja que se revierte está en REF", async () => {
    const paymentId = await setup("cobro en REF", () =>
      salePayment("vendedor1", "usd", (sale) => ({ p_method: "efectivo_usd", p_amount: Number(sale.total_ref) })),
    );

    const impact = await predictAndApply("admin", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.payment).toMatchObject({ currency: "USD", method: "efectivo_usd" });
    expect(impact.effects).toEqual([
      expect.objectContaining({ currency: "USD", delta: -impact.payment.amountRef, target: "caja" }),
    ]);
  });

  it("con vuelto en efectivo: devuelve el neto a la venta y repone el vuelto a la caja", async () => {
    const paymentId = await setup("cobro con vuelto en efectivo", () =>
      salePayment("vendedor1", "vuelto", (sale, rateVes) => ({
        p_method: "efectivo_ves",
        p_amount: money(Number(sale.total_ves) + money(rateVes)),
        p_change_method: "efectivo_ves",
        p_change_amount: money(rateVes),
      })),
    );

    const impact = await predictAndApply("admin", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.payment.changeVes).toBeGreaterThan(0);
    expect(impact.payment.netVes).toBe(impact.document.paidVes);
    expect(impact.document.paidVesAfter).toBe(0);
    expect(impact.effects.map((effect) => [effect.target, effect.delta])).toEqual(
      expect.arrayContaining([
        ["caja", -impact.payment.amountVes],
        ["caja", impact.payment.changeVes],
      ]),
    );
  });

  it("con vuelto por cuenta: el retiro del vuelto vuelve al baúl (cuenta)", async () => {
    const paymentId = await setup("cobro con vuelto por pago móvil", async () => {
      await fundAccount("vuelto");
      return salePayment("vendedor1", "vuelto-pm", (sale, rateVes) => ({
        p_method: "efectivo_ves",
        p_amount: money(Number(sale.total_ves) + money(rateVes)),
        p_change_method: "pago_movil",
        p_change_amount: money(rateVes),
      }));
    });

    const impact = await predictAndApply("admin", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.effects[0]).toMatchObject({ delta: impact.payment.changeVes, target: "baul_cuenta" });
  });

  it("D22 · la cuenta del baúl no alcanza: el impact dice el saldo que la RPC deja (0), con su aviso", async () => {
    const paymentId = await setup("cobro por cuenta con el baúl recortado", async () => {
      const id = await salePayment("vendedor1", "d22", (sale) => ({
        p_method: "transferencia",
        p_amount: Number(sale.total_ves),
        p_bank_name: `Banco ${TAG}`,
        p_reference_code: "007788",
      }));
      const payment = await one("select amount_ves::float8 as amount_ves from public.payments where id = $1", [id]);
      await lab.db.query("update public.store_vaults set balance_ves = $2 where store_id = $1", [
        lab.storeId,
        money(Number(payment.amount_ves) / 3),
      ]);
      return id;
    });

    const impact = await predictAndApply("admin", paymentId);
    const vaultEffect = impact.effects.find((effect) => effect.target === "baul_cuenta");

    expect(impact.allowed).toBe(true);
    expect(vaultEffect).toMatchObject({ balanceAfter: 0 });
    expect(vaultEffect?.delta).toBeGreaterThan(-impact.payment.amountVes);
    expect(vaultEffect?.note).toContain("dejará de cuadrar");
  });

  it("pago ya anulado: el impact anticipa el PT409 y nada cambia", async () => {
    const paymentId = await setup("cobro anulado", async () => {
      const id = await salePayment("vendedor1", "anulado", (sale) => ({
        p_method: "efectivo_ves",
        p_amount: Number(sale.total_ves),
      }));
      await rpcOk("admin", "cancel_payment", { p_payment_id: id });
      return id;
    });

    const impact = await predictAndApply("admin", paymentId);

    expect(impact).toMatchObject({ allowed: false, reason: "El pago ya fue anulado", reasonCode: "CONFLICT" });
    expect(impact.payment).toMatchObject({ status: "anulado", statusAfter: "anulado" });
  });

  it("un vendedor no puede anular: el impact anticipa el PT403 de la RPC", async () => {
    const paymentId = await setup("cobro en Bs", () =>
      salePayment("vendedor1", "rol", (sale) => ({ p_method: "efectivo_ves", p_amount: Number(sale.total_ves) })),
    );

    const impact = await predictAndApply("vendedor1", paymentId);

    expect(impact).toMatchObject({ allowed: false, reasonCode: "FORBIDDEN" });
  });

  it("cierre de caja ya transferido al baúl: el impact anticipa el PT409 y nada cambia", async () => {
    const paymentId = await setup("cobro en una caja cerrada y transferida", async () => {
      const register = await one(
        "insert into public.cash_registers (store_id, name, is_active) values ($1, $2, true) returning id",
        [lab.storeId, `${TAG} caja`],
      );
      registerIds.push(String(register.id));
      // El admin no tiene caja asignada: `register_payment` usa la última sesión abierta, que es esta.
      const session = await rpcOk("admin", "open_cash_session", { p_register_id: register.id, p_opening_ves: 0, p_opening_ref: 0 });
      const sale = await mkSale("admin", "cierre");
      const paid = await rpcOk("admin", "register_payment", {
        p_sale_id: sale.id,
        p_method: "efectivo_ves",
        p_amount: Number(sale.total_ves),
      });
      await rpcOk("admin", "close_cash_session", {
        p_session_id: session.id,
        p_closing_ves: Number(sale.total_ves),
        p_closing_ref: 0,
      });
      await rpcOk("admin", "transfer_cash_closures_to_vault", { p_session_ids: [session.id], p_notes: `${TAG} transferencia` });
      return String(paid.id);
    });

    const impact = await predictAndApply("admin", paymentId);

    expect(impact).toMatchObject({ allowed: false, reasonCode: "CONFLICT" });
    expect(impact.reason).toContain("su cierre de caja ya fue transferido al baúl");
    expect(impact.document.statusAfter).toBe("pagada");
  });
});

describe("CNF-14 · impact de anular un pago a proveedor = lo que aplica cancel_payment", () => {
  it("desde el baúl en efectivo Bs: vuelve al baúl (efectivo Bs) y baja lo pagado sin cambiar el estado", async () => {
    const paymentId = await setup("pago en efectivo Bs", async () => {
      await rpcOk("admin", "register_vault_deposit", { p_amount_ves: money(4 * (await rate())), p_amount_ref: 0, p_notes: `${TAG} fondo Bs` });
      return purchasePayment("efe-ves", (rateVes) => ({ p_method: "efectivo_ves", p_amount: money(2 * rateVes) }));
    });

    const impact = await predictAndApply("admin", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.payment.direction).toBe("salida");
    expect(impact.document).toMatchObject({ kind: "purchase", paidVesAfter: 0, paidRefAfter: 0, status: "recibido", statusAfter: "recibido" });
    expect(impact.effects).toEqual([
      expect.objectContaining({ currency: "VES", delta: impact.payment.amountVes, target: "baul_efectivo_ves" }),
    ]);
  });

  it("desde el baúl en efectivo USD: vuelve REF al baúl (efectivo REF)", async () => {
    const paymentId = await setup("pago en efectivo USD", async () => {
      await rpcOk("admin", "register_vault_deposit", { p_amount_ves: 0, p_amount_ref: 4, p_notes: `${TAG} fondo REF` });
      return purchasePayment("efe-usd", () => ({ p_method: "efectivo_usd", p_amount: 2 }));
    });

    const impact = await predictAndApply("contador", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.effects).toEqual([
      expect.objectContaining({ currency: "USD", delta: impact.payment.amountRef, target: "baul_ref" }),
    ]);
    expect(impact.document.pendingRefAfter).toBe(impact.document.totalRef);
  });

  it("desde cuenta: vuelve Bs al baúl (cuenta)", async () => {
    const paymentId = await setup("pago por transferencia", async () => {
      await fundAccount("compra");
      return purchasePayment("cuenta", (rateVes) => ({
        p_method: "transferencia",
        p_amount: money(2 * rateVes),
        p_bank_name: `Banco ${TAG}`,
        p_reference_code: "C-0001",
      }));
    });

    const impact = await predictAndApply("admin", paymentId);

    expect(impact.allowed).toBe(true);
    expect(impact.effects).toEqual([
      expect.objectContaining({ currency: "VES", delta: impact.payment.amountVes, target: "baul_cuenta" }),
    ]);
  });
});

describe("CNF-14 · el impact de un pago no cruza tiendas", () => {
  it("pago de la tienda lab pedido con otra tienda → 404", async () => {
    const paymentId = await setup("cobro en Bs", () =>
      salePayment("vendedor1", "tienda", (sale) => ({ p_method: "efectivo_ves", p_amount: Number(sale.total_ves) })),
    );

    await expect(impactOf("admin", paymentId, lab.defaultStoreId)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("pago de OTRA tienda pedido por un usuario lab → 404 (con su tienda y con la ajena)", async () => {
    const paymentId = await setup("pago en la tienda default", async () => {
      const rateVes = await rate();
      const contact = await one(
        "insert into public.contacts (store_id, name, type) values ($1, $2, 'cliente') returning id",
        [lab.defaultStoreId, `Cliente ${TAG}`],
      );
      foreignContactIds.push(String(contact.id));
      const sale = await one(
        `insert into public.sales (store_id, invoice_number, customer_id, user_id, ref_rate_ves, status)
         values ($1, $2, $3, null, $4, 'pendiente_pago') returning id`,
        [lab.defaultStoreId, `${TAG}-OTRA`, contact.id, rateVes],
      );
      foreignSaleIds.push(String(sale.id));
      const payment = await one(
        `insert into public.payments (store_id, direction, sale_id, contact_id, method, currency, amount, amount_ves, amount_ref, ref_rate_ves)
         values ($1, 'entrada', $2, $3, 'efectivo_ves', 'VES', $4, $4, 1, $5) returning id`,
        [lab.defaultStoreId, sale.id, contact.id, money(rateVes), rateVes],
      );
      foreignPaymentIds.push(String(payment.id));
      return String(payment.id);
    });

    // Con la tienda del usuario (lo que hace el BFF): el filtro por tienda no lo encuentra.
    await expect(impactOf("admin", paymentId)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    // Aunque el servidor recibiera la tienda ajena, la RLS del usuario no lo deja ver.
    await expect(impactOf("admin", paymentId, lab.defaultStoreId)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("pago inexistente → 404; id mal formado → 400", async () => {
    await expect(impactOf("admin", randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(impactOf("admin", "no-es-uuid")).rejects.toMatchObject({ status: 400 });
  });
});
