/**
 * CNF-14 · El impact de una venta predice lo que `cancel_sale` / `return_sale` aplican.
 *
 * Por cada caso: se crea la venta por las RPC reales (supabase-js + sesión de un
 * usuario lab), se calcula el impact con el MISMO código del BFF
 * (`loadSaleImpactInputs` + `computeSaleImpact`), se comprueba que calcularlo no
 * escribió nada, se ejecuta la RPC real y se compara lo aplicado con lo predicho:
 * stock por producto, estado y cobrado de la venta, estado de cada pago, asientos
 * de caja borrados y saldo del baúl (cuenta). En los rechazos, el mensaje y el
 * código de la RPC son los de `reason` / `reasonCode` y no cambia nada.
 *
 * Corre contra la base lab local (`npm run stock-lab:test`). `pg` (rol postgres)
 * solo prepara datos y lee el resultado. Datos propios con prefijo `RIMP-<nonce>`;
 * se borran en `afterAll`. Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { computeSaleImpact, type SaleImpact, type SaleImpactAction } from "../../../src/modules/sales/services/saleImpact";
import { loadSaleImpactInputs } from "../../../src/modules/sales/services/saleImpact.server";
import { FULL_IMPACT_LEDGER_ACCESS } from "../../../src/shared/impact/impactAccess";
import type { LabRoleKey } from "../agents/base";
import { Lab } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type Seller = "vendedor1" | "vendedor2";

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `RIMP-${NONCE}`;
const REJECTION_CODES: Record<string, string> = {
  PT400: "BAD_REQUEST",
  PT403: "FORBIDDEN",
  PT404: "NOT_FOUND",
  PT409: "CONFLICT",
};

let lab: Lab;
let seq = 0;
const productIds: string[] = [];
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

async function mkProduct(key: string, stock: number, active = true): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${key}-${seq}`;
  const row = await one(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, 1, 0.5, 0, 0, true) returning id`,
    [lab.storeId, sku, `Producto ${sku}`],
  );
  const id = String(row.id);
  productIds.push(id);
  await rpcOk("admin", "adjust_stock", {
    p_product_id: id,
    p_quantity_delta: stock,
    p_reason: `${TAG} inventario inicial`,
    p_type: "inventario_inicial",
  });
  if (!active) await lab.db.query("update public.products set is_active = false where id = $1", [id]);
  return id;
}

/** Venta sin cobrar: dos productos, uno repetido en dos líneas. */
async function mkSale(role: Seller, lines: Array<{ product_id: string; quantity: number }>): Promise<Row> {
  seq += 1;
  return rpcOk(role, "create_sale", {
    p_customer_id: lab.customerId,
    p_items: lines.map((line) => ({ unit_price_ref: 1, ...line })),
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

type Snapshot = {
  cashMovements: Record<string, number>;
  payments: Record<string, string>;
  returnMovements: Record<string, number>;
  sale: { paidVes: number; status: string };
  stock: Record<string, number>;
  vaultBalanceVes: number | null;
  vaultMovements: Record<string, number>;
};

/** Todo lo que la anulación o la devolución pueden tocar, leído por `pg`. */
async function snapshot(saleId: string): Promise<Snapshot> {
  const sale = await one("select status::text as status, paid_ves::float8 as paid_ves from public.sales where id = $1", [saleId]);
  const products = await lab.rows<{ id: string; current_stock: number }>(
    `select p.id, p.current_stock from public.products p
     where p.id in (select product_id from public.sale_items where sale_id = $1)`,
    [saleId],
  );
  const payments = await lab.rows<{ id: string; status: string; cash: number; vault: number }>(
    `select p.id, p.status::text as status,
            (select count(*)::int from public.cash_movements m where m.payment_id = p.id) as cash,
            (select count(*)::int from public.vault_movements v where v.payment_id = p.id) as vault
     from public.payments p where p.sale_id = $1`,
    [saleId],
  );
  const reversals = await lab.rows<{ product_id: string; units: number }>(
    `select product_id, sum(quantity_delta)::int as units from public.stock_movements
     where sale_id = $1 and type in ('ajuste_entrada', 'devolucion_cliente') group by product_id`,
    [saleId],
  );
  const vault = await lab.rows<{ balance_ves: number }>(
    "select balance_ves::float8 as balance_ves from public.store_vaults where store_id = $1",
    [lab.storeId],
  );
  return {
    cashMovements: Object.fromEntries(payments.map((row) => [row.id, row.cash])),
    payments: Object.fromEntries(payments.map((row) => [row.id, row.status])),
    returnMovements: Object.fromEntries(reversals.map((row) => [row.product_id, row.units])),
    sale: { paidVes: Number(sale.paid_ves), status: String(sale.status) },
    stock: Object.fromEntries(products.map((row) => [row.id, row.current_stock])),
    vaultBalanceVes: vault[0] ? Number(vault[0].balance_ves) : null,
    vaultMovements: Object.fromEntries(payments.map((row) => [row.id, row.vault])),
  };
}

/**
 * El impact tal como lo calcula el BFF: lecturas del usuario + asientos de caja con service role.
 * Con el libro completo a la vista (`cash.view` + `vault.view`): aquí se comprueban los saldos
 * previstos contra los que deja la RPC, sea cual sea el rol que ejecuta.
 */
async function impactOf(role: Seller, saleId: string, action: SaleImpactAction, storeId = lab.storeId): Promise<SaleImpact> {
  const user = await lab.supa(role);
  return computeSaleImpact(
    await loadSaleImpactInputs({ privileged: () => lab.service(), user }, saleId, action, storeId, FULL_IMPACT_LEDGER_ACCESS),
  );
}

const RPC_BY_ACTION: Record<SaleImpactAction, string> = { cancel: "cancel_sale", return: "return_sale" };

/**
 * Pide el impact, comprueba que no escribió, ejecuta la RPC real y compara.
 * Devuelve el impact para las aserciones propias de cada caso.
 */
async function predictAndApply(role: Seller, saleId: string, action: SaleImpactAction): Promise<SaleImpact> {
  const before = await snapshot(saleId);
  const impact = await impactOf(role, saleId, action);

  // Solo lectura: nada cambió por calcularlo.
  expect(await snapshot(saleId)).toEqual(before);
  // El "antes" del impact es el de la base.
  expect(impact.paidVes).toBe(before.sale.paidVes);
  expect(impact.document.status).toBe(before.sale.status);
  for (const line of impact.stock) expect(line.stockBefore).toBe(before.stock[line.productId]);

  const applied = await rpcAs(role, RPC_BY_ACTION[action], { p_sale_id: saleId });
  const after = await snapshot(saleId);

  if (!impact.allowed) {
    expect(applied.error?.message).toBe(impact.reason);
    expect(REJECTION_CODES[applied.error?.code ?? ""]).toBe(impact.reasonCode);
    expect(after).toEqual(before);
    return impact;
  }

  expect(applied.error).toBeNull();
  expect(after.sale).toEqual({ paidVes: impact.paidVesAfter, status: impact.document.statusAfter });

  for (const line of impact.stock) {
    expect(after.stock[line.productId]).toBe(line.stockAfter);
    // Unidades repuestas por esta acción = movimientos de reversión nuevos de ese producto.
    expect((after.returnMovements[line.productId] ?? 0) - (before.returnMovements[line.productId] ?? 0)).toBe(
      line.quantityDelta,
    );
  }

  let expectedVault = before.vaultBalanceVes;
  for (const line of impact.payments) {
    expect(after.payments[line.paymentId]).toBe(line.statusAfter);
    if (line.outcome !== "reverted") {
      expect(after.cashMovements[line.paymentId]).toBe(before.cashMovements[line.paymentId]);
      expect(after.vaultMovements[line.paymentId]).toBe(before.vaultMovements[line.paymentId]);
      continue;
    }
    expect(line.inexact).toBeNull();
    // Los asientos de caja y de baúl del pago desaparecen.
    expect(after.cashMovements[line.paymentId]).toBe(0);
    expect(after.vaultMovements[line.paymentId]).toBe(0);
    for (const effect of line.effects) {
      if (effect.target !== "baul_cuenta") continue;
      expect(effect.balanceBefore).toBe(expectedVault);
      expectedVault = effect.balanceAfter;
    }
  }
  expect(after.vaultBalanceVes).toBe(expectedVault);

  return impact;
}

/** Venta de dos productos cobrada por completo con un solo pago. */
async function paidSale(
  role: Seller,
  key: string,
  payment: (sale: Row) => Row,
): Promise<{ productIds: [string, string]; saleId: string }> {
  await ensureCashSession(role);
  const first = await mkProduct(`${key}-a`, 10);
  const second = await mkProduct(`${key}-b`, 6);
  const sale = await mkSale(role, [
    { product_id: first, quantity: 2 },
    { product_id: second, quantity: 1 },
    { product_id: first, quantity: 1 },
  ]);
  // Se desactiva después de venderlo: `create_sale` rechaza un producto inactivo, la reversión no.
  await lab.db.query("update public.products set is_active = false where id = $1", [second]);
  await rpcOk(role, "register_payment", { p_sale_id: sale.id, ...payment(sale) });
  const status = (await one("select status::text as status from public.sales where id = $1", [sale.id])).status;
  if (status !== "pagada") throw new Error(`SETUP la venta ${key} no quedó pagada (${String(status)})`);
  return { productIds: [first, second], saleId: String(sale.id) };
}

async function cleanup(): Promise<void> {
  try {
    await lab.db.query("begin");
    await lab.db.query("delete from public.sales where id = any($1::uuid[])", [foreignSaleIds]);
    await lab.db.query("delete from public.contacts where id = any($1::uuid[])", [foreignContactIds]);
    if (productIds.length > 0) {
      const sales = (await lab.rows("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
      const payments = (await lab.rows("select id from public.payments where sale_id = any($1::uuid[])", [sales])).map((r) => r.id);
      await lab.db.query("delete from public.cash_movements where payment_id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.vault_movements where payment_id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.payments where id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
      await lab.db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
      await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
    }
    await lab.db.query("commit");
  } catch {
    await lab.db.query("rollback").catch(() => undefined);
    await lab.db.query("update public.products set is_active = false where id = any($1::uuid[])", [productIds]).catch(() => undefined);
  }
}

beforeAll(async () => {
  lab = await setup("abrir el laboratorio", () => Lab.open("rimp"));
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

describe("CNF-14 · impact de devolver una venta = lo que aplica return_sale", () => {
  it("pagada en efectivo Bs: anula el pago, borra el asiento de la caja y repone el stock (también el del producto inactivo)", async () => {
    const { productIds: ids, saleId } = await setup("venta cobrada en Bs", () =>
      paidSale("vendedor1", "ves", (sale) => ({ p_method: "efectivo_ves", p_amount: Number(sale.total_ves) })),
    );

    const impact = await predictAndApply("vendedor1", saleId, "return");

    expect(impact.allowed).toBe(true);
    expect(impact.document.statusAfter).toBe("devuelta");
    expect(impact.stock.map((line) => [line.productId, line.quantityDelta, line.isActive])).toEqual([
      [ids[0], 3, true],
      [ids[1], 1, false],
    ]);
    expect(impact.payments).toHaveLength(1);
    expect(impact.payments[0]).toMatchObject({ method: "efectivo_ves", outcome: "reverted", statusAfter: "anulado" });
    expect(impact.payments[0].effects).toEqual([
      expect.objectContaining({ currency: "VES", delta: -impact.payments[0].amountVes, physical: true, target: "caja" }),
    ]);
    expect(impact.payments[0].effects[0].targetName).toEqual(expect.any(String));
    expect(impact.refund?.byMethod).toEqual([expect.objectContaining({ currency: "VES", method: "efectivo_ves" })]);
    expect(impact.paidVesAfter).toBe(0);
  });

  it("pagada en REF (efectivo USD): el asiento de caja que se revierte está en USD", async () => {
    const { saleId } = await setup("venta cobrada en REF", () =>
      paidSale("vendedor1", "ref", (sale) => ({ p_method: "efectivo_usd", p_amount: Number(sale.total_ref) })),
    );

    const impact = await predictAndApply("vendedor1", saleId, "return");

    expect(impact.allowed).toBe(true);
    expect(impact.payments[0]).toMatchObject({ currency: "USD", method: "efectivo_usd", outcome: "reverted" });
    expect(impact.payments[0].effects).toEqual([
      expect.objectContaining({ currency: "USD", delta: -impact.payments[0].amountRef, target: "caja" }),
    ]);
    expect(impact.refund?.byMethod).toEqual([
      expect.objectContaining({ amount: impact.payments[0].amountRef, currency: "USD", method: "efectivo_usd" }),
    ]);
  });

  it("pagada por transferencia: el cobro sale del baúl (cuenta) con el saldo antes y después", async () => {
    const { saleId } = await setup("venta cobrada por cuenta", () =>
      paidSale("vendedor1", "banco", (sale) => ({
        p_method: "transferencia",
        p_amount: Number(sale.total_ves),
        p_bank_name: `Banco ${TAG}`,
        p_reference_code: "004455",
      })),
    );

    const impact = await predictAndApply("vendedor1", saleId, "return");

    expect(impact.allowed).toBe(true);
    const vaultEffects = impact.payments[0].effects.filter((effect) => effect.target === "baul_cuenta");
    expect(vaultEffects).toHaveLength(1);
    expect(vaultEffects[0].balanceBefore).toEqual(expect.any(Number));
    expect(vaultEffects[0].balanceAfter).toEqual(expect.any(Number));
  });

  it("cobrada en la caja de OTRO vendedor: el impact ve ese asiento aunque la RLS se lo oculte a quien devuelve", async () => {
    const { saleId } = await setup("venta cobrada por vendedor2", () =>
      paidSale("vendedor2", "ajena", (sale) => ({ p_method: "efectivo_ves", p_amount: Number(sale.total_ves) })),
    );

    const impact = await predictAndApply("vendedor1", saleId, "return");

    expect(impact.allowed).toBe(true);
    expect(impact.payments[0].effects).toHaveLength(1);
  });

  it("pendiente de pago, sin pagos: solo repone el stock", async () => {
    const productId = await setup("producto", () => mkProduct("pend-ret", 8));
    const sale = await setup("venta", () => mkSale("vendedor1", [{ product_id: productId, quantity: 2 }]));

    const impact = await predictAndApply("vendedor1", String(sale.id), "return");

    expect(impact).toMatchObject({ allowed: true, paidVes: 0, payments: [] });
    expect(impact.refund).toEqual({ byMethod: [], changeToRecover: [], netVes: 0 });
    expect(impact.stock).toEqual([expect.objectContaining({ quantityDelta: 2, stockAfter: 8, stockBefore: 6 })]);
  });

  it("ya devuelta: el impact anticipa el rechazo de la RPC y nada cambia", async () => {
    const productId = await setup("producto", () => mkProduct("dos-veces", 8));
    const sale = await setup("venta devuelta", async () => {
      const created = await mkSale("vendedor1", [{ product_id: productId, quantity: 1 }]);
      await rpcOk("vendedor1", "return_sale", { p_sale_id: created.id });
      return created;
    });

    const impact = await predictAndApply("vendedor1", String(sale.id), "return");

    expect(impact).toMatchObject({ allowed: false, reasonCode: "CONFLICT" });
    expect(impact.stock.every((line) => line.quantityDelta === 0)).toBe(true);
  });
});

describe("CNF-14 · impact de anular una venta = lo que aplica cancel_sale", () => {
  it("pendiente de pago: se anula y repone el stock", async () => {
    const productId = await setup("producto", () => mkProduct("pend-can", 8));
    const sale = await setup("venta", () => mkSale("vendedor1", [{ product_id: productId, quantity: 3 }]));

    const impact = await predictAndApply("vendedor1", String(sale.id), "cancel");

    expect(impact).toMatchObject({ allowed: true, paidVes: 0, refund: null });
    expect(impact.document.statusAfter).toBe("cancelada");
    expect(impact.stock).toEqual([expect.objectContaining({ quantityDelta: 3, stockAfter: 8, stockBefore: 5 })]);
  });

  it("con el pago ya anulado: nada que revertir y la anulación pasa", async () => {
    const { saleId } = await setup("venta con pago anulado", async () => {
      const created = await paidSale("vendedor1", "anulado", (sale) => ({
        p_method: "efectivo_ves",
        p_amount: Number(sale.total_ves),
      }));
      const payment = await one("select id from public.payments where sale_id = $1", [created.saleId]);
      await rpcOk("admin", "cancel_payment", { p_payment_id: payment.id });
      return created;
    });

    const impact = await predictAndApply("vendedor1", saleId, "cancel");

    expect(impact.allowed).toBe(true);
    expect(impact.paidVes).toBe(0);
    expect(impact.payments).toEqual([
      expect.objectContaining({ effects: [], outcome: "already_cancelled", status: "anulado", statusAfter: "anulado" }),
    ]);
  });

  it("con un pago activo: el impact da el mismo PT409 que cancel_sale y nada cambia", async () => {
    const { saleId } = await setup("venta cobrada", () =>
      paidSale("vendedor1", "activo", (sale) => ({ p_method: "efectivo_ves", p_amount: Number(sale.total_ves) })),
    );

    const impact = await predictAndApply("vendedor1", saleId, "cancel");

    expect(impact).toMatchObject({ allowed: false, reasonCode: "CONFLICT" });
    expect(impact.reason).toContain("1 pago(s) activo(s) por Bs ");
    expect(impact.payments[0].outcome).toBe("blocks_action");
    expect(impact.document.statusAfter).toBe("pagada");
  });
});

describe("CNF-14 · el impact no cruza tiendas", () => {
  it("venta de la tienda lab pedida con otra tienda → 404", async () => {
    const productId = await setup("producto", () => mkProduct("tienda", 5));
    const sale = await setup("venta", () => mkSale("vendedor1", [{ product_id: productId, quantity: 1 }]));

    await expect(impactOf("vendedor1", String(sale.id), "cancel", lab.defaultStoreId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("venta de OTRA tienda pedida por un usuario lab → 404 (con su tienda y con la ajena)", async () => {
    const saleId = await setup("venta en la tienda default", async () => {
      const contact = await one(
        "insert into public.contacts (store_id, name, type) values ($1, $2, 'cliente') returning id",
        [lab.defaultStoreId, `Cliente ${TAG}`],
      );
      foreignContactIds.push(String(contact.id));
      const sale = await one(
        `insert into public.sales (store_id, invoice_number, customer_id, user_id, ref_rate_ves, status)
         values ($1, $2, $3, null, $4, 'pendiente_pago') returning id`,
        [lab.defaultStoreId, `${TAG}-OTRA`, contact.id, await rate()],
      );
      foreignSaleIds.push(String(sale.id));
      return String(sale.id);
    });

    for (const action of ["cancel", "return"] as const) {
      // Con la tienda del usuario (lo que hace el BFF): el filtro por tienda no la encuentra.
      await expect(impactOf("vendedor1", saleId, action)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      // Aunque el servidor recibiera la tienda ajena, la RLS del usuario no la deja ver.
      await expect(impactOf("vendedor1", saleId, action, lab.defaultStoreId)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    }
  });

  it("venta inexistente → 404; id mal formado → 400", async () => {
    await expect(impactOf("vendedor1", randomUUID(), "return")).rejects.toMatchObject({ status: 404 });
    await expect(impactOf("vendedor1", "no-es-uuid", "return")).rejects.toMatchObject({ status: 400 });
  });
});
