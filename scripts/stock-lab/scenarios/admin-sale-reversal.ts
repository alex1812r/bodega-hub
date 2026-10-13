/**
 * Escenario `sale.admin_cancel_return_switch_off` (DEC-02): el ADMINISTRADOR anula y devuelve ventas de punta a punta por
 * el BFF con el interruptor «El administrador puede vender» APAGADO. Anular y devolver exigen `sales.cancel`, que el
 * admin tiene siempre; vender sigue exigiendo `sales.create`, que con el interruptor apagado no tiene.
 *
 *   npm run stock-lab:scenarios -- --suite hypotheses --only sale.admin_cancel_return_switch_off
 *
 * Corre con la suite `hypotheses` y necesita el BFF del laboratorio (`npm run stock-lab:start`). Las ventas las crea
 * `lab-vendedor1`; todo lo demás (efecto, anular, anular el pago, devolver) lo hace `lab-admin`. Cada acción se compara
 * con lo que anunció `GET /api/sales/{id}/impact`: stock por producto, estado de la venta y de sus pagos, asientos de
 * caja y saldo del baúl.
 *
 * Convención: `expected` describe lo que haría un sistema sano; `fail` = bug reproducido.
 */
import { randomUUID } from "node:crypto";

import type { ApiResponse } from "../../e2e-bodegon/client";
import { Checks, dataOf, errorOf, mustId, outcome, type CaseCtx, type CaseDef, type CaseOutcome, type Lab } from "./db";

export const ADMIN_SALE_REVERSAL_ID = "sale.admin_cancel_return_switch_off";

type Json = Record<string, unknown>;

export type ImpactSummary = {
  allowed: boolean;
  /** Cambios anunciados sobre el baúl, por cubeta: Σ `delta` de los asientos que se revierten. */
  vaultDelta: { baul_cuenta: number; baul_efectivo_ves: number; baul_ref: number };
  /** Asientos de caja (gaveta o informativos) que la acción revierte. */
  cashEffects: number;
  paidVesAfter: number | null;
  payments: Array<{ outcome: string; paymentId: string; statusAfter: string }>;
  reason: string | null;
  statusAfter: string | null;
  stock: Array<{ productId: string; quantityDelta: number; stockAfter: number | null }>;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

function list(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

/** Lo que el escenario compara de la respuesta de `GET /api/sales/{id}/impact` (lógica pura, cubierta por jest). */
export function summarizeImpact(data: Json): ImpactSummary {
  const vaultDelta = { baul_cuenta: 0, baul_efectivo_ves: 0, baul_ref: 0 };
  let cashEffects = 0;

  for (const payment of list(data.payments)) {
    for (const effect of list(payment.effects)) {
      const target = String(effect.target);

      if (target === "caja") {
        cashEffects += 1;
      } else if (target in vaultDelta) {
        const key = target as keyof typeof vaultDelta;
        vaultDelta[key] = round2(vaultDelta[key] + Number(effect.delta));
      }
    }
  }

  const document = (data.document ?? {}) as Json;

  return {
    allowed: data.allowed === true,
    cashEffects,
    paidVesAfter: typeof data.paidVesAfter === "number" ? data.paidVesAfter : null,
    payments: list(data.payments).map((payment) => ({
      outcome: String(payment.outcome),
      paymentId: String(payment.paymentId),
      statusAfter: String(payment.statusAfter),
    })),
    reason: typeof data.reason === "string" ? data.reason : null,
    statusAfter: typeof document.statusAfter === "string" ? document.statusAfter : null,
    stock: list(data.stock).map((line) => ({
      productId: String(line.productId),
      quantityDelta: Number(line.quantityDelta),
      stockAfter: typeof line.stockAfter === "number" ? line.stockAfter : null,
    })),
    vaultDelta,
  };
}

type Money = {
  cashMovements: number;
  payments: Array<{ id: string; status: string }>;
  sale: { paidVes: number; status: string };
  vault: { baul_cuenta: number; baul_efectivo_ves: number; baul_ref: number };
};

async function readMoney(lab: Lab, saleId: string): Promise<Money> {
  const [sale] = await lab.rows<{ paid_ves: string; status: string }>(
    "select status::text as status, paid_ves::text as paid_ves from public.sales where id = $1",
    [saleId],
  );
  const payments = await lab.rows<{ id: string; status: string }>(
    "select id, status::text as status from public.payments where sale_id = $1 order by created_at, id",
    [saleId],
  );
  const [cash] = await lab.rows<{ n: string }>(
    "select count(*)::text as n from public.cash_movements m join public.payments p on p.id = m.payment_id where p.sale_id = $1",
    [saleId],
  );
  const [vault] = await lab.rows<{ cuenta: string; efectivo: string; ref: string }>(
    `select balance_ves::text as cuenta, balance_efectivo_ves::text as efectivo, balance_ref::text as ref
     from public.store_vaults where store_id = $1`,
    [lab.storeId],
  );

  return {
    cashMovements: Number(cash?.n ?? 0),
    payments,
    sale: { paidVes: Number(sale?.paid_ves ?? 0), status: sale?.status ?? "?" },
    vault: {
      baul_cuenta: Number(vault?.cuenta ?? 0),
      baul_efectivo_ves: Number(vault?.efectivo ?? 0),
      baul_ref: Number(vault?.ref ?? 0),
    },
  };
}

function vaultDiff(before: Money["vault"], after: Money["vault"]): Money["vault"] {
  return {
    baul_cuenta: round2(after.baul_cuenta - before.baul_cuenta),
    baul_efectivo_ves: round2(after.baul_efectivo_ves - before.baul_efectivo_ves),
    baul_ref: round2(after.baul_ref - before.baul_ref),
  };
}

const info = (res: ApiResponse): string => `${res.status} ${errorOf(res)}`;

/** Compara lo aplicado por la acción con lo que anunció su impact. */
async function expectAsAnnounced(
  c: Checks,
  lab: Lab,
  label: string,
  saleId: string,
  announced: ImpactSummary,
  before: Money,
): Promise<Money> {
  const after = await readMoney(lab, saleId);

  for (const line of announced.stock) {
    c.eq(`${label}: stock anunciado del producto ${line.productId}`, await lab.stock(line.productId), line.stockAfter);
  }
  c.eq(`${label}: estado de la venta = anunciado`, after.sale.status, announced.statusAfter);
  c.eq(`${label}: cobrado de la venta = anunciado`, after.sale.paidVes, announced.paidVesAfter);
  c.eq(
    `${label}: estado de cada pago = anunciado`,
    after.payments.map((payment) => [payment.id, payment.status]).sort(),
    announced.payments.map((payment) => [payment.paymentId, payment.statusAfter]).sort(),
  );
  c.eq(`${label}: baúl (cuenta, efectivo Bs, REF) = anunciado`, vaultDiff(before.vault, after.vault), announced.vaultDelta);
  c.eq(`${label}: asientos de caja revertidos = anunciados`, before.cashMovements - after.cashMovements, announced.cashEffects);

  return after;
}

async function adminCancelsAndReturns(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();

  // --- Precondición: el interruptor está apagado y el admin no vende.
  const toggle = await t.http("admin", "GET", "/api/settings/admin-can-sell");
  const me = await t.http("admin", "GET", "/api/auth/me");
  const rawPermissions = dataOf(me).permissions;
  const permissions = Array.isArray(rawPermissions) ? rawPermissions.map(String) : [];
  c.ok("GET /api/settings/admin-can-sell", toggle.ok, info(toggle));
  c.eq("interruptor «El administrador puede vender»", dataOf(toggle).enabled, false);
  c.eq(
    "permisos del admin: sin sales.create ni cash.operate, con sales.cancel",
    ["sales.create", "cash.operate", "sales.cancel"].map((permission) => permissions.includes(permission)),
    [false, false, true],
  );
  const adminSells = await t.http("admin", "POST", "/api/sales", {});
  c.eq("el admin no puede vender (POST /api/sales)", adminSells.status, 403);
  const adminOpensCash = await t.http("admin", "POST", "/api/cash/session/open", {});
  c.eq("el admin no puede abrir caja (POST /api/cash/session/open)", adminOpensCash.status, 403);

  await t.ensureCash("vendedor1");
  const p = await t.product("p", 20);
  const rate = await lab.rate();

  // --- A · venta sin cobrar: el admin ve el efecto y la anula.
  const a = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { clientRequestId: randomUUID() }), "venta A sin cobrar");
  c.eq("stock tras vender 2 (A)", await lab.stock(p.id), 18);
  const aBefore = await readMoney(lab, a);
  const aImpactRes = await t.http("admin", "GET", `/api/sales/${a}/impact?action=cancel`);
  c.ok("admin · efecto de anular A", aImpactRes.ok, info(aImpactRes));
  const aImpact = summarizeImpact(dataOf(aImpactRes));
  c.eq("A: el efecto permite anular y anuncia +2", [aImpact.allowed, aImpact.stock.map((line) => [line.quantityDelta, line.stockAfter])], [true, [[2, 20]]]);
  const aCancel = await t.http("admin", "PATCH", `/api/sales/${a}/cancel`);
  c.ok("admin · anular A", aCancel.ok, info(aCancel));
  await expectAsAnnounced(c, lab, "A anulada", a, aImpact, aBefore);
  c.eq("stock tras anular A", await lab.stock(p.id), 20);

  // --- B · venta cobrada en efectivo USD: anular se bloquea (D63); el admin anula el pago y después la venta.
  const b = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 3 }], { pay: true }), "venta B cobrada en efectivo USD");
  c.eq("stock tras vender 3 (B)", await lab.stock(p.id), 17);
  const bBlockedImpact = summarizeImpact(dataOf(await t.http("admin", "GET", `/api/sales/${b}/impact?action=cancel`)));
  c.eq("B con pago activo: el efecto NO permite anular y señala el pago", [bBlockedImpact.allowed, bBlockedImpact.payments.map((payment) => payment.outcome)], [false, ["blocks_action"]]);
  const bBlocked = await t.http("admin", "PATCH", `/api/sales/${b}/cancel`);
  c.eq("B con pago activo: anular → 409", bBlocked.status, 409);
  // `errorOf` antepone el código (`CONFLICT …`): el mensaje es, letra por letra, el motivo que anunció el efecto.
  c.ok(
    "B con pago activo: el rechazo es el que anunció el efecto",
    Boolean(bBlockedImpact.reason) && errorOf(bBlocked) === `CONFLICT ${bBlockedImpact.reason}`,
    `anunciado "${bBlockedImpact.reason}", obtenido "${errorOf(bBlocked)}"`,
  );
  c.eq("stock tras el rechazo (B)", await lab.stock(p.id), 17);
  const bPayment = (await readMoney(lab, b)).payments[0]?.id ?? "";
  const bPaymentCancel = await t.http("admin", "PATCH", `/api/payments/${bPayment}/cancel`);
  c.ok("admin · anular el pago de B", bPaymentCancel.ok, info(bPaymentCancel));
  const bBefore = await readMoney(lab, b);
  const bImpact = summarizeImpact(dataOf(await t.http("admin", "GET", `/api/sales/${b}/impact?action=cancel`)));
  c.eq("B sin pagos activos: el efecto permite anular", bImpact.allowed, true);
  const bCancel = await t.http("admin", "PATCH", `/api/sales/${b}/cancel`);
  c.ok("admin · anular B", bCancel.ok, info(bCancel));
  await expectAsAnnounced(c, lab, "B anulada", b, bImpact, bBefore);
  c.eq("stock tras anular B", await lab.stock(p.id), 20);

  // --- C · venta cobrada en efectivo USD (caja): el admin la devuelve; el pago se anula con ella.
  const cSale = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 4 }], { pay: true }), "venta C cobrada en efectivo USD");
  const cBefore = await readMoney(lab, cSale);
  const cImpactRes = await t.http("admin", "GET", `/api/sales/${cSale}/impact?action=return`);
  c.ok("admin · efecto de devolver C", cImpactRes.ok, info(cImpactRes));
  const cImpact = summarizeImpact(dataOf(cImpactRes));
  c.eq("C: el efecto permite devolver, anuncia +4 y revierte su pago", [cImpact.allowed, cImpact.stock.map((line) => line.quantityDelta), cImpact.payments.map((payment) => payment.outcome)], [true, [4], ["reverted"]]);
  c.ok("C: el efecto anuncia el asiento de caja del cobro", cImpact.cashEffects > 0, JSON.stringify(cImpact));
  const cReturn = await t.http("admin", "POST", `/api/sales/${cSale}/return`);
  c.ok("admin · devolver C", cReturn.ok, info(cReturn));
  const cAfter = await expectAsAnnounced(c, lab, "C devuelta", cSale, cImpact, cBefore);
  c.eq("C devuelta: sin pagos activos", cAfter.payments.filter((payment) => payment.status === "activo").length, 0);

  // --- D · venta cobrada por punto de venta en Bs (baúl, cuenta): el admin la devuelve y el baúl baja lo anunciado.
  const dTotalVes = round2(5 * rate.rateVes);
  const dSale = mustId(
    await t.sale("vendedor1", [{ productId: p.id, quantity: 5 }], { payments: [{ method: "punto_venta", currency: "VES", amount: dTotalVes }] }),
    "venta D cobrada por punto de venta",
  );
  const dBefore = await readMoney(lab, dSale);
  const dImpact = summarizeImpact(dataOf(await t.http("admin", "GET", `/api/sales/${dSale}/impact?action=return`)));
  c.eq("D: el efecto permite devolver y anuncia la salida de la cuenta del baúl", [dImpact.allowed, dImpact.vaultDelta.baul_cuenta], [true, -dTotalVes]);
  const dReturn = await t.http("admin", "POST", `/api/sales/${dSale}/return`);
  c.ok("admin · devolver D", dReturn.ok, info(dReturn));
  await expectAsAnnounced(c, lab, "D devuelta", dSale, dImpact, dBefore);

  // --- Repetir sobre un documento ya cerrado se rechaza, también para el admin.
  const again = [
    await t.http("admin", "PATCH", `/api/sales/${a}/cancel`),
    await t.http("admin", "POST", `/api/sales/${cSale}/return`),
  ];
  c.rejected("anular A dos veces", again[0].status, errorOf(again[0]));
  c.rejected("devolver C dos veces", again[1].status, errorOf(again[1]));

  // --- Los demás roles siguen igual.
  const denied = {
    almacen: (await t.http("almacen", "GET", `/api/sales/${dSale}/impact?action=cancel`)).status,
    contador: (await t.http("contador", "PATCH", `/api/sales/${dSale}/cancel`)).status,
  };
  c.eq("almacén y contador: 403", denied, { almacen: 403, contador: 403 });

  const finalStock = await lab.stock(p.id);
  c.eq("stock final (todo revertido)", finalStock, 20);
  const scoped = await t.scoped();
  c.eq("reversal_mismatches", scoped.reversal_mismatches, 0);
  c.eq("movements_without_document", scoped.movements_without_document, 0);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);

  return outcome(c, {
    expected: {
      interruptor: false,
      admin_vende: 403,
      A: "anulada por el admin",
      B: "409 con pago activo; anulada tras anular el pago",
      C: "devuelta por el admin (caja)",
      D: "devuelta por el admin (baúl, cuenta)",
      stock_final: 20,
    },
    actual: {
      interruptor: dataOf(toggle).enabled,
      admin_vende: adminSells.status,
      admin_abre_caja: adminOpensCash.status,
      A: { efecto: aImpact, status: aCancel.status },
      B: { bloqueado: bBlocked.status, motivo: bBlockedImpact.reason, pago: bPaymentCancel.status, efecto: bImpact, status: bCancel.status },
      C: { efecto: cImpact, status: cReturn.status },
      D: { efecto: dImpact, status: dReturn.status },
      otros_roles: denied,
      stock_final: finalStock,
    },
    evidence: [`producto ${p.id}`, `ventas ${a} ${b} ${cSale} ${dSale}`, `pago de B ${bPayment}`],
  });
}

export const ADMIN_SALE_REVERSAL_CASES: readonly CaseDef[] = [
  {
    id: ADMIN_SALE_REVERSAL_ID,
    title: "DEC-02 · el admin anula y devuelve ventas por el BFF con «El administrador puede vender» apagado",
    hypothesis: ["H4"],
    run: adminCancelsAndReturns,
  },
];
