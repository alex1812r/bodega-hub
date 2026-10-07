/**
 * Suite `oneshots` (STK-403, plan stock-integrity fase 4): un escenario por
 * cada one-shot de `supabase/patches/` que corrigió stock a mano en producción
 * (los 11 de `.notes/stock-integrity-gtm/oneshots-to-scenarios.md`).
 *
 *   npx tsx scripts/stock-lab/scenarios/oneshots.ts --run <id> [--only a,b] [--list] [--out <dir>]
 *
 * Cada fila `os.<parche>` se abre en hasta tres casos:
 *   - `.symptom`     ¿el sistema actual produce el síntoma por el camino real (API)?
 *                    Si el síntoma fue un error de captura en la UI se marca `skip`
 *                    ("requiere UI → ola 8.3, flujo N"); no se inventa un pass.
 *   - `.fix_by_api`  ¿hay una forma legítima de corregirlo por API, sin SQL, que
 *                    deje las vistas de integridad en 0? (`pass`; `finding` si
 *                    corrige el stock pero deja el documento o el dinero mal).
 *   - `.sql_replica` réplica, sobre productos propios, de la escritura SQL del
 *                    parche. `stock_reconciliation` debe quedar SIEMPRE en 0.
 *                    Dos parches (821, 830c) dejan residuo por construcción; en
 *                    esos el esperado es que las vistas v2 (20261006d) detecten
 *                    exactamente ese residuo (`pass` = «el oráculo v2 detecta el
 *                    residuo del one-shot»). Cualquier otra fila en cualquier
 *                    vista es `fail` (ver `residueProblems`).
 *
 * Las réplicas copian solo las escrituras de stock (`stock_movements`,
 * `products.current_stock`, `sale_items` / `purchase_items`); los ajustes de
 * pagos, caja y baúl de los parches quedan fuera (no afectan a las vistas).
 *
 * Desde 20261006e insertar un movimiento YA mueve el stock y el trigger fija
 * `stock_after = current_stock + delta`. Los parches hacían eso mismo a mano
 * (`stock_after := current_stock ± q` + `update products`), así que la réplica
 * que deja el MISMO estado es solo el insert (repetir el update lo duplicaría).
 * Los parches que reescribían filas existentes (821, 830b-remove) se replican
 * tal cual con `update` como `postgres`.
 */
import { randomUUID } from "node:crypto";

import {
  Checks,
  INTEGRITY_VIEWS,
  analyzeChain,
  errorOf,
  fmtMove,
  idOf,
  mustId,
  outcome,
  runSuite,
  skip,
  type CaseCtx,
  type CaseDef,
  type CaseOutcome,
  type IntegrityView,
  type Lab,
  type ViewCounts,
} from "./db";

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

export type OneshotRow = {
  /** Sufijo del id (`os.<key>`). */
  key: string;
  patch: string;
  hypothesis: string[];
  /** Flujos de la ola 8.3 (UI) que cubren el síntoma; vacío = el síntoma no es de captura. */
  uiFlows: number[];
  /** El parche fijó `stock_after` a mano o reasignó movimientos: hay que replicarlo. */
  replica: boolean;
};

export const ONESHOT_ROWS: readonly OneshotRow[] = [
  { key: "20260813d", patch: "20260813d-one-shot-split-jabo-harm-variants.sql", hypothesis: ["H7", "H9"], uiFlows: [], replica: true },
  { key: "20260813e", patch: "20260813e-one-shot-fix-shampoo-pack-qty.sql", hypothesis: ["H2", "H8"], uiFlows: [4], replica: false },
  { key: "20260813f", patch: "20260813f-one-shot-transfer-shampoo-suav-mane-ro.sql", hypothesis: ["H7"], uiFlows: [4, 6], replica: true },
  { key: "20260815c", patch: "20260815c-one-shot-transfer-malta-manz-verd.sql", hypothesis: ["H7"], uiFlows: [4, 6], replica: true },
  { key: "20260818", patch: "20260818-one-shot-fix-sale-toal-wani-qty.sql", hypothesis: ["H8"], uiFlows: [1, 2], replica: false },
  { key: "20260821", patch: "20260821-one-shot-fix-purchase-puff-product.sql", hypothesis: ["H7", "H8"], uiFlows: [4], replica: true },
  { key: "20260830", patch: "20260830-one-shot-cancel-unpaid-pendiente-pago-sales.sql", hypothesis: ["H8"], uiFlows: [2, 3], replica: true },
  { key: "20260830b_add", patch: "20260830b-one-shot-add-polar-unit-sale-V-20260830152541402.sql", hypothesis: ["H8", "H7"], uiFlows: [1], replica: true },
  { key: "20260830b_remove", patch: "20260830b-one-shot-remove-sale-pola-ligh-unit.sql", hypothesis: ["H8"], uiFlows: [1], replica: true },
  { key: "20260830c", patch: "20260830c-one-shot-swap-justy-dura-to-manz-sale-V-20260830152541402.sql", hypothesis: ["H8", "H7"], uiFlows: [1], replica: true },
  { key: "20260830d", patch: "20260830d-one-shot-add-plat-tom-sale-V-20260830152541402.sql", hypothesis: ["H8", "H7"], uiFlows: [1], replica: true },
];

export function uiSkipReason(row: Pick<OneshotRow, "uiFlows">, what: string): string {
  const flows = row.uiFlows.length === 1 ? `flujo ${row.uiFlows[0]}` : `flujos ${row.uiFlows.join(" y ")}`;
  return `${what}: requiere UI → ola 8.3, ${flows}`;
}

/** Vistas con conteo ≠ 0, como `nombre=n`. */
export function nonZeroViews(counts: Partial<ViewCounts>): string[] {
  return Object.entries(counts)
    .filter(([, value]) => typeof value === "number" && value !== 0)
    .map(([name, value]) => `${name}=${String(value)}`);
}

/** Una fila que el one-shot deja, por construcción, en una vista de integridad. */
export type ResidueSpec = {
  view: IntegrityView;
  /** Qué es (para los mensajes y el detalle del caso). */
  label: string;
  /** Columnas de la fila de la vista que deben coincidir exactamente. */
  where: Record<string, unknown>;
};

type ViewRow = Record<string, unknown>;

function matchesSpec(row: ViewRow, spec: ResidueSpec): boolean {
  return Object.entries(spec.where).every(([column, value]) => row[column] === value);
}

/**
 * Compara las filas de las vistas (ya filtradas a los productos del caso) con
 * el residuo que el one-shot deja por construcción. Sin problemas solo si cada
 * fila casa con UNA especificación y cada especificación con UNA fila.
 * `stock_reconciliation` nunca se acepta como residuo: stock ≠ libro es
 * siempre un fallo.
 */
export function residueProblems(rows: Partial<Record<IntegrityView, readonly ViewRow[]>>, expected: readonly ResidueSpec[]): string[] {
  const problems: string[] = [];
  const pending = expected.filter((spec) => {
    if (spec.view !== "stock_reconciliation") return true;
    problems.push(`stock_reconciliation no puede ser residuo aceptado (${spec.label})`);
    return false;
  });
  const used = new Set<ResidueSpec>();
  for (const view of INTEGRITY_VIEWS) {
    for (const row of rows[view] ?? []) {
      const spec = pending.find((candidate) => candidate.view === view && !used.has(candidate) && matchesSpec(row, candidate));
      if (spec) used.add(spec);
      else problems.push(`${view}: fila no esperada ${JSON.stringify(row)}`);
    }
  }
  for (const spec of pending) {
    if (!used.has(spec)) problems.push(`${spec.view}: falta la fila esperada «${spec.label}» ${JSON.stringify(spec.where)}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cierra una réplica. Sin `residue`: todas las vistas de mis productos en 0.
 * Con `residue`: las vistas deben contener exactamente esas filas y ninguna más.
 */
async function replicaOutcome(
  lab: Lab,
  t: CaseCtx,
  c: Checks,
  patch: string,
  extra: Record<string, unknown> = {},
  residue: readonly ResidueSpec[] = [],
): Promise<CaseOutcome> {
  const scoped = await t.scoped();
  const dirty = nonZeroViews(scoped);
  const viewRows: Partial<Record<IntegrityView, ViewRow[]>> = {};
  for (const view of INTEGRITY_VIEWS) {
    const rows = await lab.viewRows(view, [...t.products]);
    if (rows.length > 0) viewRows[view] = rows;
  }
  c.eq("stock_reconciliation tras la réplica (stock = libro)", scoped.stock_reconciliation, 0);
  c.eq(
    residue.length > 0
      ? `las vistas v2 detectan exactamente el residuo de ${patch} (${residue.map((spec) => `${spec.view}: ${spec.label}`).join("; ")}) y nada más`
      : `vistas ≠ 0 tras replicar ${patch}`,
    residueProblems(viewRows, residue),
    [],
  );
  if (residue.length > 0 && c.failures.length === 0) {
    c.note(`el oráculo v2 detecta el residuo del one-shot: ${dirty.join(" ")} (${residue.map((spec) => spec.label).join("; ")})`);
  }
  const chains: Record<string, unknown> = {};
  const evidence: string[] = [];
  for (const id of t.products) {
    const moves = await lab.movements(id);
    chains[id] = { stock: await lab.stock(id), ...analyzeChain(moves, await lab.stock(id)) };
    evidence.push(`producto ${id}`, ...moves.map(fmtMove));
  }
  if (dirty.length > 0 && c.failures.length > 0) c.note("descuadre heredado del propio one-shot: el parche deja estas vistas ≠ 0 sin que exista bug de RPC.");
  return outcome(c, {
    expected:
      residue.length > 0
        ? { stock_reconciliation: 0, residuo: residue.map((spec) => ({ view: spec.view, ...spec.where })), resto: "ninguna otra fila en ninguna vista" }
        : { vistas: "todas 0 sobre los productos tocados" },
    actual: { vistas: scoped, filas: viewRows, chains, ...extra },
    evidence,
  });
}

/** Cierra una corrección por API: stock esperado y vistas en 0. */
async function fixOutcome(
  lab: Lab,
  t: CaseCtx,
  c: Checks,
  expectedStocks: Record<string, number>,
  extra: Record<string, unknown> = {},
): Promise<CaseOutcome> {
  const stocks = await lab.stocks(Object.keys(expectedStocks));
  c.eq("stock tras la corrección por API", stocks, expectedStocks);
  const scoped = await t.scoped();
  c.eq("vistas ≠ 0 tras la corrección por API", nonZeroViews(scoped), []);
  return outcome(c, {
    expected: { stocks: expectedStocks, vistas: "todas 0" },
    actual: { stocks, vistas: scoped, ...extra },
    evidence: [...t.products].map((id) => `producto ${id}`),
  });
}

/** Estado del dinero de una venta devuelta (hueco G3). */
async function moneyOf(lab: Lab, saleId: string): Promise<{ status: string | null; paid_ves: string | null; pagos_activos: number }> {
  const sale = await lab.rows<{ status: string; paid_ves: string }>(
    "select status::text as status, paid_ves::text as paid_ves from public.sales where id = $1",
    [saleId],
  );
  const live = await lab.rows("select 1 from public.payments where sale_id = $1 and status = 'activo'", [saleId]);
  return { status: sale[0]?.status ?? null, paid_ves: sale[0]?.paid_ves ?? null, pagos_activos: live.length };
}

async function movementOf(lab: Lab, productId: string, column: "sale_id" | "purchase_id", docId: string, type: string): Promise<string> {
  const move = (await lab.movements(productId)).find((row) => row[column] === docId && row.type === type);
  if (!move) throw new Error(`No hay movimiento ${type} del documento ${docId} sobre ${productId}.`);
  return move.id;
}

// ---------------------------------------------------------------------------
// 20260813d · split de un producto en variantes
// ---------------------------------------------------------------------------

async function os813dFix(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const source = await t.product("general", 72);
  const expected: Record<string, number> = { [source.id]: 0 };
  for (let i = 1; i <= 3; i += 1) {
    const sku = lab.nextSku(`${t.key}-var${i}`);
    const created = await t.http("almacen", "POST", "/api/products", { sku, name: `S403 ${sku}`, salePriceRef: 1, currentCostRef: 1, currentStock: 0, minStock: 0 });
    const id = mustId(created, `variante ${i}`);
    t.track(id);
    const entry = await t.adjust("almacen", id, 24, "ajuste_entrada");
    c.ok(`entrada de la variante ${i}`, entry.ok, `${entry.status} ${errorOf(entry)}`);
    expected[id] = 24;
  }
  const exit = await t.adjust("almacen", source.id, -72, "ajuste_salida");
  const off = await t.http("almacen", "PATCH", `/api/products/${source.id}`, { isActive: false });
  c.ok("salida del producto general", exit.ok, `${exit.status} ${errorOf(exit)}`);
  c.ok("desactivar el producto general", off.ok, `${off.status} ${errorOf(off)}`);
  c.finding(
    "existe una operación atómica de split / transferencia entre productos",
    false,
    "no hay endpoint: son 3 altas + 4 ajustes sueltos, sin vínculo entre sí ni transacción (si uno falla queda a medias)",
  );
  return fixOutcome(lab, t, c, expected);
}

async function os813dReplica(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const source = await t.product("general", 72);
  const client = await lab.pg();
  await client.query("begin");
  try {
    for (let i = 1; i <= 3; i += 1) {
      const sku = lab.nextSku(`${t.key}-var${i}`);
      // l.51-59: la variante nacía con current_stock = 24; l.81-96: ajuste_entrada con stock_after = 24 fijo.
      // Mismo estado por el libro: alta en 0 + ajuste_entrada +24 (el trigger deja stock 24 y stock_after 24).
      const rows = await t.sql<{ id: string }>(
        `réplica 813d: variante ${i}`,
        `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
         values ($1, $2, $3, 1, 1, 0, 0, true) returning id`,
        [lab.storeId, sku, `S403 ${sku}`],
        client,
      );
      const id = rows[0]?.id ?? "";
      t.track(id);
      await t.sql(
        `réplica 813d: ajuste_entrada +24 de la variante ${i}`,
        `insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
         values ($1, 'ajuste_entrada', 24, 'S403 réplica 813d', $2)`,
        [id, lab.storeId],
        client,
      );
    }
    // l.138-153: ajuste_salida −current_stock (el trigger deja stock y stock_after en 0); l.156-160: inactivo.
    await t.sql(
      "réplica 813d: ajuste_salida −72",
      `insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
       select id, 'ajuste_salida'::public.stock_movement_type, -current_stock, 'S403 réplica 813d', store_id from public.products where id = $1`,
      [source.id],
      client,
    );
    await t.sql("réplica 813d: is_active=false", "update public.products set is_active = false where id = $1", [source.id], client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  return replicaOutcome(lab, t, c, "20260813d");
}

// ---------------------------------------------------------------------------
// 20260813e · compra en modo empaque con pack_count equivocado
// ---------------------------------------------------------------------------

async function os813eFix(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  // Camino A: la mercancía sigue en stock → cancelar la compra mal cargada y registrarla bien.
  const a = await t.product("a", 0);
  const wrongA = mustId(await t.purchase("almacen", "recibido", [{ productId: a.id, packCount: 1, unitsPerPack: 12 }]), "compra 1x12 (mal)");
  const cancel = await t.http("almacen", "PATCH", `/api/purchases/${wrongA}/cancel`);
  c.ok("cancelar la compra mal cargada", cancel.ok, `${cancel.status} ${errorOf(cancel)}`);
  const right = await t.purchase("almacen", "recibido", [{ productId: a.id, packCount: 3, unitsPerPack: 12 }]);
  c.ok("registrar la compra correcta 3x12", right.ok, `${right.status} ${errorOf(right)}`);

  // Camino B: parte del stock ya se vendió (lo normal cuando se detecta días después).
  const b = await t.product("b", 0);
  const wrongB = mustId(await t.purchase("almacen", "recibido", [{ productId: b.id, packCount: 1, unitsPerPack: 12 }]), "compra 1x12 (mal)");
  mustId(await t.sale("vendedor1", [{ productId: b.id, quantity: 5 }], { clientRequestId: randomUUID() }), "venta de 5");
  const cancelSold = await t.http("almacen", "PATCH", `/api/purchases/${wrongB}/cancel`);
  c.rejected("cancelar la compra con stock ya vendido", cancelSold.status, errorOf(cancelSold));
  const topUp = await t.adjust("almacen", b.id, 24, "ajuste_entrada");
  c.ok("ajuste de entrada +24 como única salida", topUp.ok, `${topUp.status} ${errorOf(topUp)}`);
  const items = await lab.rows("select pack_count, units_per_pack, quantity from public.purchase_items where purchase_id = $1", [wrongB]);
  c.finding(
    "existe edición de una compra recibida",
    false,
    `con stock ya vendido solo queda un ajuste suelto: la compra ${wrongB} sigue diciendo ${JSON.stringify(items[0])} (cantidad y costo unitario mal para siempre)`,
  );
  return fixOutcome(lab, t, c, { [a.id]: 36, [b.id]: 31 }, { compra_b: items });
}

// ---------------------------------------------------------------------------
// 20260813f / 20260815c · stock cargado al SKU genérico en vez de a la variante
// ---------------------------------------------------------------------------

function transferFix(bought: number, transfer: number) {
  return async (lab: Lab, t: CaseCtx): Promise<CaseOutcome> => {
    const c = new Checks();
    const generic = await t.product("generico", 0);
    const variant = await t.product("variante", 0);
    mustId(await t.purchase("almacen", "recibido", [{ productId: generic.id, quantity: bought }]), "compra al SKU genérico");
    const out = await t.adjust("almacen", generic.id, -transfer, "ajuste_salida");
    const into = await t.adjust("almacen", variant.id, transfer, "ajuste_entrada");
    c.ok("ajuste de salida del genérico", out.ok, `${out.status} ${errorOf(out)}`);
    c.ok("ajuste de entrada de la variante", into.ok, `${into.status} ${errorOf(into)}`);
    c.note("corrección legítima = dos ajustes espejo (no atómicos, sin vínculo entre sí; la compra sigue apuntando al genérico).");
    return fixOutcome(lab, t, c, { [generic.id]: bought - transfer, [variant.id]: transfer });
  };
}

/**
 * l.53-90 de 813f / l.64-95 de 815c: dos SM con `stock_after := current_stock ± q` + update de ambos productos.
 * Hoy: los dos movimientos (salida del genérico $1, entrada de la variante $2); el trigger hace el resto.
 */
const TRANSFER_REPLICA_SQL = `
  insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
  select id,
         (case when id = $1 then 'ajuste_salida' else 'ajuste_entrada' end)::public.stock_movement_type,
         case when id = $1 then -$3::int else $3::int end,
         'S403 réplica transferencia', store_id
  from public.products where id in ($1, $2)`;

function transferReplica(patch: string, bought: number, transfer: number) {
  return async (lab: Lab, t: CaseCtx): Promise<CaseOutcome> => {
    const c = new Checks();
    const generic = await t.product("generico", 2);
    const variant = await t.product("variante", 3);
    mustId(await t.purchase("almacen", "recibido", [{ productId: generic.id, quantity: bought }]), "compra al SKU genérico");
    await t.sql(`réplica ${patch}: transferencia de ${transfer} u (dos movimientos espejo)`, TRANSFER_REPLICA_SQL, [generic.id, variant.id, transfer]);
    c.eq("stocks tras la réplica", await lab.stocks([generic.id, variant.id]), { [generic.id]: 2 + bought - transfer, [variant.id]: 3 + transfer });
    return replicaOutcome(lab, t, c, patch);
  };
}

// ---------------------------------------------------------------------------
// 20260818 · venta con cantidad 2 que debía ser 1
// ---------------------------------------------------------------------------

async function os818Fix(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 10);
  const wrong = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { pay: true }), "venta cobrada x2 (mal)");
  // No hay edición ni devolución parcial: devolver la venta entera y volver a venderla bien.
  const ret = await t.http("vendedor1", "POST", `/api/sales/${wrong}/return`);
  const resale = await t.sale("vendedor1", [{ productId: p.id, quantity: 1 }], { pay: true });
  c.ok("devolver la venta equivocada", ret.ok, `${ret.status} ${errorOf(ret)}`);
  c.ok("vender de nuevo la cantidad correcta", resale.ok, `${resale.status} ${errorOf(resale)}`);
  const money = await moneyOf(lab, wrong);
  c.ok(
    "la devolución deja el dinero cuadrado",
    money.pagos_activos === 0,
    `la venta devuelta ${wrong} conserva paid_ves=${String(money.paid_ves)} con ${money.pagos_activos} pago(s) activo(s) (G3): el stock queda bien, la caja queda con el cobro de 2 + el de 1`,
  );
  return fixOutcome(lab, t, c, { [p.id]: 9 }, { venta_devuelta: money });
}

// ---------------------------------------------------------------------------
// 20260821 · compra cargada al producto equivocado
// ---------------------------------------------------------------------------

async function os821Fix(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const wrong = await t.product("mora", 0);
  const right = await t.product("azul", 0);
  const purchase = mustId(await t.purchase("almacen", "recibido", [{ productId: wrong.id, quantity: 10 }]), "compra al producto equivocado");
  const cancel = await t.http("almacen", "PATCH", `/api/purchases/${purchase}/cancel`);
  const redo = await t.purchase("almacen", "recibido", [{ productId: right.id, quantity: 10 }]);
  c.ok("cancelar la compra equivocada", cancel.ok, `${cancel.status} ${errorOf(cancel)}`);
  c.ok("registrar la compra en el producto correcto", redo.ok, `${redo.status} ${errorOf(redo)}`);
  c.note("solo sirve si el stock mal cargado no se ha vendido; si no, cancel_purchase se niega (ver os.20260813e.fix_by_api) y quedan dos ajustes espejo.");
  return fixOutcome(lab, t, c, { [wrong.id]: 0, [right.id]: 10 });
}

async function os821Replica(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const wrong = await t.product("mora", 5);
  const right = await t.product("azul", 3);
  const purchase = mustId(await t.purchase("almacen", "recibido", [{ productId: wrong.id, quantity: 10 }]), "compra al producto equivocado");
  // Entre la compra y la corrección hubo operación normal en ambos productos (en producción pasaron horas).
  mustId(await t.sale("vendedor1", [{ productId: wrong.id, quantity: 2 }], { clientRequestId: randomUUID() }), "venta intermedia del equivocado");
  const mid = await t.adjust("almacen", right.id, 4, "ajuste_entrada");
  if (!mid.ok) throw new Error(`ajuste intermedio: ${mid.status} ${errorOf(mid)}`);
  const movementId = await movementOf(lab, wrong.id, "purchase_id", purchase, "compra");
  const client = await lab.pg();
  await client.query("begin");
  try {
    // l.68-70
    await t.sql("réplica 821: purchase_items.product_id → correcto", "update public.purchase_items set product_id = $2 where purchase_id = $1 and product_id = $3", [purchase, right.id, wrong.id], client);
    // l.72-78: el movimiento viejo cambia de producto con stock_after = current_stock ACTUAL del correcto + qty.
    await t.sql(
      "réplica 821: stock_movements.product_id → correcto, stock_after = current_stock actual + qty",
      `update public.stock_movements set product_id = $2,
              stock_after = (select current_stock from public.products where id = $2) + quantity_delta
       where id = $1`,
      [movementId, right.id],
      client,
    );
    // l.84-95
    await t.sql("réplica 821: current_stock −10 (equivocado) y +10 (correcto)", "update public.products set current_stock = current_stock + case when id = $1 then -10 else 10 end where id in ($1, $2)", [wrong.id, right.id], client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  c.eq("stocks tras la réplica (equivocado 5−2, correcto 3+4+10)", await lab.stocks([wrong.id, right.id]), { [wrong.id]: 3, [right.id]: 17 });
  // El parche reescribe un movimiento viejo sin recalcular los posteriores: la cadena queda rota en 3 puntos.
  //   equivocado: inicial(5) · venta −2 (stock_after 13, y ya no la precede la compra → se esperaba 3)
  //   correcto:   inicial(3) · compra +10 reasignada (stock_after 17, se esperaba 13) · ajuste +4 (stock_after 7, se esperaba 21)
  return replicaOutcome(lab, t, c, "20260821", { movimiento_reasignado: movementId, compra: purchase }, [
    { view: "stock_chain_breaks", label: "venta posterior del producto equivocado", where: { product_id: wrong.id, type: "venta", stock_after: 13, expected_stock_after: 3 } },
    { view: "stock_chain_breaks", label: "compra reasignada con stock_after fijado a mano", where: { product_id: right.id, movement_id: movementId, type: "compra", stock_after: 17, expected_stock_after: 13 } },
    { view: "stock_chain_breaks", label: "ajuste intermedio del producto correcto", where: { product_id: right.id, type: "ajuste_entrada", stock_after: 7, expected_stock_after: 21 } },
  ]);
}

// ---------------------------------------------------------------------------
// 20260830 · ventas pendiente_pago repetidas (reintentos) canceladas a mano
// ---------------------------------------------------------------------------

async function os830Symptom(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 20);
  const lines = [{ productId: p.id, quantity: 3 }];
  // Lo que hizo producción: 4 veces la misma venta en minutos, sin clave y sin cobro.
  // Hoy el BFF exige clientRequestId: las 4 deben responder 400 sin crear nada.
  const retries = [];
  for (let i = 0; i < 4; i += 1) retries.push(await t.sale("vendedor1", lines, { clientRequestId: null }));
  const afterRetries = await lab.stock(p.id);
  const pending = await lab.rows<{ id: string }>(
    "select distinct s.id from public.sales s join public.sale_items i on i.sale_id = s.id where i.product_id = $1 and s.status = 'pendiente_pago'",
    [p.id],
  );
  // El POS actual: clave de idempotencia + cobro atómico. 3 reintentos de la misma confirmación.
  const key = randomUUID();
  const pos = [];
  for (let i = 0; i < 3; i += 1) pos.push(await t.sale("vendedor1", lines, { pay: true, clientRequestId: key }));
  const final = await lab.stock(p.id);
  c.eq("los 4 reintentos sin clave responden 400", retries.map((res) => res.status), [400, 400, 400, 400]);
  c.eq("stock tras reintentar 4 veces la misma venta sin clave (sano: ninguna venta)", afterRetries, 20);
  c.eq("ventas pendiente_pago creadas por los reintentos", pending.length, 0);
  c.eq("POS con clientRequestId: 3 reintentos descuentan una sola vez", afterRetries - final, 3);
  c.eq("POS con clientRequestId: misma venta en los 3", [...new Set(pos.map(idOf))].length, 1);
  if (c.failures.length > 0) {
    c.note("síntoma del 29-ago: sin clientRequestId cada reintento creaba otra venta pendiente_pago que ya descontó stock. El BFF debe rechazar el POST sin clave (400) y, con clave, devolver siempre la misma venta.");
  }
  return outcome(c, {
    expected: { sin_clave: { statuses: [400, 400, 400, 400], stock: 20, pendientes: 0 }, con_clave: { descuento: 3, ventas: 1 } },
    actual: {
      sin_clave: { stock: afterRetries, pendientes: pending.length, statuses: retries.map((res) => res.status) },
      con_clave: { descuento: afterRetries - final, ventas: [...new Set(pos.map(idOf))], statuses: pos.map((res) => res.status) },
    },
    evidence: [`producto ${p.id}`, ...pending.map((row) => `venta pendiente ${row.id}`)],
  });
}

async function os830Fix(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 20);
  const lines = [{ productId: p.id, quantity: 3 }];
  const first = mustId(await t.sale("vendedor1", lines, { clientRequestId: randomUUID() }), "pendiente 1");
  const second = mustId(await t.sale("vendedor1", lines, { clientRequestId: randomUUID() }), "pendiente 2");
  for (const id of [first, second]) {
    const cancel = await t.http("vendedor1", "PATCH", `/api/sales/${id}/cancel`);
    c.ok(`cancelar la pendiente ${id}`, cancel.ok, `${cancel.status} ${errorOf(cancel)}`);
  }
  return fixOutcome(lab, t, c, { [p.id]: 20 });
}

async function os830Replica(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 20);
  const saleId = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 3 }], { clientRequestId: randomUUID() }), "venta pendiente");
  // l.112-141: por ítem current_stock += qty, SM ajuste_entrada con stock_after = current_stock nuevo, venta → cancelada.
  // Hoy el restock lo hace el trigger al insertar el ajuste_entrada ligado a la venta.
  await t.sql(
    "réplica 830: restock por movimiento + sales.status = cancelada",
    `with moved as (
       insert into public.stock_movements (product_id, type, quantity_delta, sale_id, reason, store_id)
       select si.product_id, 'ajuste_entrada'::public.stock_movement_type, si.quantity, si.sale_id, 'S403 réplica 830', p.store_id
       from public.sale_items si join public.products p on p.id = si.product_id
       where si.sale_id = $1::uuid
       returning 1
     )
     update public.sales set status = 'cancelada' where id = $1::uuid and exists (select 1 from moved)`,
    [saleId],
  );
  c.eq("stock tras la réplica", await lab.stock(p.id), 20);
  return replicaOutcome(lab, t, c, "20260830", { venta: saleId });
}

// ---------------------------------------------------------------------------
// 20260830b-add / 20260830d · a la venta le faltaba una unidad o una línea
// ---------------------------------------------------------------------------

async function secondSaleFix(lab: Lab, t: CaseCtx, original: number, sameProduct: boolean): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const a = await t.product("a", 20);
  const b = sameProduct ? a : await t.product("b", 20);
  const first = mustId(await t.sale("vendedor1", [{ productId: a.id, quantity: original }], { pay: true }), "venta original");
  const extra = await t.sale("vendedor1", [{ productId: b.id, quantity: 1 }], { pay: true });
  c.ok("segunda venta por lo que faltó", extra.ok, `${extra.status} ${errorOf(extra)}`);
  c.finding(
    "existe edición de una venta cobrada",
    false,
    `el stock se corrige con una segunda venta (${String(idOf(extra))}), pero la venta original ${first} queda como se capturó: dos documentos para una sola compra del cliente`,
  );
  const expected = sameProduct ? { [a.id]: 20 - original - 1 } : { [a.id]: 20 - original, [b.id]: 19 };
  return fixOutcome(lab, t, c, expected);
}

/**
 * l.117-118 + 200-218 de 830b-add (y l.120-121 + 216-234 de 830d): SM venta −1 con stock_after = current_stock − 1
 * ligado a la venta vieja. Hoy: el mismo movimiento; el trigger fija ese stock_after y descuenta el producto.
 */
const LATE_SALE_MOVE_SQL = `
  insert into public.stock_movements (product_id, type, quantity_delta, sale_id, reason, store_id)
  select id, 'venta'::public.stock_movement_type, -1, $2::uuid, 'S403 réplica venta tardía', store_id
  from public.products where id = $1`;

async function os830bAddReplica(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 20);
  const saleId = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 8 }], { pay: true }), "venta x8");
  mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { clientRequestId: randomUUID() }), "venta intermedia");
  // l.120: sale_items.quantity 8 → 9.
  await t.sql("réplica 830b-add: sale_items.quantity = 9", "update public.sale_items set quantity = 9 where sale_id = $1 and product_id = $2", [saleId, p.id]);
  await t.sql("réplica 830b-add: SM venta −1 tardío ligado a la venta", LATE_SALE_MOVE_SQL, [p.id, saleId]);
  c.eq("stock tras la réplica (20 − 8 − 2 − 1)", await lab.stock(p.id), 9);
  return replicaOutcome(lab, t, c, "20260830b-add", { venta: saleId });
}

async function os830dReplica(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const a = await t.product("a", 20);
  const b = await t.product("b", 20);
  const saleId = mustId(await t.sale("vendedor1", [{ productId: a.id, quantity: 1 }], { pay: true }), "venta sin la línea que faltó");
  mustId(await t.sale("vendedor1", [{ productId: b.id, quantity: 2 }], { clientRequestId: randomUUID() }), "venta intermedia");
  // l.124-139: insertar la línea que faltaba.
  await t.sql(
    "réplica 830d: insert sale_items de la línea que faltaba",
    `insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, unit_cost_ref_snapshot, subtotal_ves)
     select $1::uuid, $2::uuid, 1, 1, 1, s.ref_rate_ves from public.sales s where s.id = $1`,
    [saleId, b.id],
  );
  await t.sql("réplica 830d: SM venta −1 tardío ligado a la venta", LATE_SALE_MOVE_SQL, [b.id, saleId]);
  c.eq("stocks tras la réplica", await lab.stocks([a.id, b.id]), { [a.id]: 19, [b.id]: 17 });
  return replicaOutcome(lab, t, c, "20260830d", { venta: saleId });
}

// ---------------------------------------------------------------------------
// 20260830b-remove · la venta incluía una línea que no se vendió
// ---------------------------------------------------------------------------

async function os830bRemoveFix(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const polar = await t.product("polar", 10);
  const light = await t.product("light", 10);
  const saleId = mustId(
    await t.sale("vendedor1", [{ productId: polar.id, quantity: 2 }, { productId: light.id, quantity: 1 }], { pay: true }),
    "venta con la línea de más",
  );
  // R4 (20261006g): la devolución suelta ya no existe; sin `saleId` es 400 y no mueve nada.
  const loose = await t.adjust("almacen", light.id, 1, "devolucion_cliente");
  c.eq("ajuste devolucion_cliente SIN saleId", loose.status, 400);
  c.eq("stock tras el rechazo del ajuste suelto", await lab.stock(light.id), 9);
  // Camino real: devolución parcial ligada a la venta por la unidad que nunca salió, con tope «vendido − ya devuelto».
  const back = await t.adjust("almacen", light.id, 1, "devolucion_cliente", { saleId });
  c.ok("devolucion_cliente +1 ligada a la venta", back.ok, `${back.status} ${errorOf(back)}`);
  const linked = (await lab.movements(light.id)).filter((move) => move.type === "devolucion_cliente");
  c.eq("movimiento de la devolución (delta, stock_after, sale_id)", linked.map((move) => [move.quantity_delta, move.stock_after, move.sale_id]), [[1, 10, saleId]]);
  const over = await t.adjust("almacen", light.id, 1, "devolucion_cliente", { saleId });
  c.rejected("segunda devolución de la misma unidad (tope: vendido 1, ya devuelto 1)", over.status, errorOf(over));
  const money = await moneyOf(lab, saleId);
  const line = await lab.rows<{ quantity: number }>("select quantity from public.sale_items where sale_id = $1 and product_id = $2", [saleId, light.id]);
  c.finding(
    "la devolución parcial ligada también corrige el documento y el cobro",
    false,
    `el stock vuelve ligado a la venta ${saleId} y con tope, pero la venta sigue "${String(money.status)}" con ${money.pagos_activos} pago(s) activo(s) (paid_ves=${String(money.paid_ves)}) y la línea con cantidad ${String(line[0]?.quantity)}: el reembolso de esa unidad no tiene camino por API`,
  );
  return fixOutcome(lab, t, c, { [polar.id]: 8, [light.id]: 10 }, { tope: `${over.status} ${errorOf(over)}`, venta: money });
}

async function os830bRemoveReplica(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const polar = await t.product("polar", 10);
  const light = await t.product("light", 10);
  const saleId = mustId(
    await t.sale("vendedor1", [{ productId: polar.id, quantity: 2 }, { productId: light.id, quantity: 1 }], { pay: true }),
    "venta con la línea de más",
  );
  mustId(await t.sale("vendedor1", [{ productId: light.id, quantity: 3 }], { clientRequestId: randomUUID() }), "venta posterior");
  const movementId = await movementOf(lab, light.id, "sale_id", saleId, "venta");
  const client = await lab.pg();
  await client.query("begin");
  try {
    // l.107-115: borrar la línea y su movimiento; l.117-127: running; l.129-141: current_stock = Σ.
    // El parche ordena el running por `created_at, id`. Aquí va por `seq` (el orden real del libro): el reloj
    // del contenedor lab retrocede ~0,7 s cada ~29 s y, si cae entre dos movimientos del caso, `created_at`
    // los invierte y la réplica rompería la cadena por un artefacto del laboratorio, no del parche.
    await t.sql("réplica 830b-remove: delete sale_items", "delete from public.sale_items where sale_id = $1 and product_id = $2", [saleId, light.id], client);
    await t.sql("réplica 830b-remove: delete stock_movements", "delete from public.stock_movements where id = $1", [movementId], client);
    await t.sql(
      "réplica 830b-remove: recalcular stock_after (running)",
      `update public.stock_movements sm set stock_after = sub.running
       from (select id, sum(quantity_delta) over (order by seq asc) as running
             from public.stock_movements where product_id = $1) sub
       where sm.id = sub.id and sm.product_id = $1`,
      [light.id],
      client,
    );
    await t.sql(
      "réplica 830b-remove: current_stock = Σ quantity_delta",
      "update public.products set current_stock = (select coalesce(sum(quantity_delta), 0) from public.stock_movements where product_id = $1) where id = $1",
      [light.id],
      client,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  c.eq("stocks tras la réplica", await lab.stocks([polar.id, light.id]), { [polar.id]: 8, [light.id]: 7 });
  return replicaOutcome(lab, t, c, "20260830b-remove", { venta: saleId });
}

// ---------------------------------------------------------------------------
// 20260830c · producto equivocado en una línea de venta
// ---------------------------------------------------------------------------

async function os830cFix(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const dura = await t.product("dura", 10);
  const manz = await t.product("manz", 10);
  const wrong = mustId(await t.sale("vendedor1", [{ productId: dura.id, quantity: 1 }], { pay: true }), "venta con el producto equivocado");
  const ret = await t.http("vendedor1", "POST", `/api/sales/${wrong}/return`);
  const resale = await t.sale("vendedor1", [{ productId: manz.id, quantity: 1 }], { pay: true });
  c.ok("devolver la venta equivocada", ret.ok, `${ret.status} ${errorOf(ret)}`);
  c.ok("vender el producto correcto", resale.ok, `${resale.status} ${errorOf(resale)}`);
  const money = await moneyOf(lab, wrong);
  c.ok(
    "la devolución deja el dinero cuadrado",
    money.pagos_activos === 0,
    `la venta devuelta ${wrong} conserva paid_ves=${String(money.paid_ves)} con ${money.pagos_activos} pago(s) activo(s) (G3): cobro duplicado en caja`,
  );
  return fixOutcome(lab, t, c, { [dura.id]: 10, [manz.id]: 9 }, { venta_devuelta: money });
}

async function os830cReplica(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const dura = await t.product("dura", 10);
  const manz = await t.product("manz", 10);
  const saleId = mustId(await t.sale("vendedor1", [{ productId: dura.id, quantity: 1 }], { pay: true }), "venta con el producto equivocado");
  mustId(await t.sale("vendedor1", [{ productId: dura.id, quantity: 2 }, { productId: manz.id, quantity: 2 }], { clientRequestId: randomUUID() }), "venta intermedia");
  const client = await lab.pg();
  await client.query("begin");
  try {
    // l.141
    await t.sql("réplica 830c: sale_items.product_id → manz", "update public.sale_items set product_id = $3 where sale_id = $1 and product_id = $2", [saleId, dura.id, manz.id], client);
    // l.232-250: restock de dura con ajuste_entrada ligado a la venta (stock_after = current_stock + 1: lo fija el trigger).
    await t.sql(
      "réplica 830c: SM ajuste_entrada +1 dura ligado a la venta",
      `insert into public.stock_movements (product_id, type, quantity_delta, sale_id, reason, store_id)
       select id, 'ajuste_entrada'::public.stock_movement_type, 1, $2::uuid, 'S403 réplica 830c', store_id
       from public.products where id = $1`,
      [dura.id, saleId],
      client,
    );
    // l.253-271
    await t.sql("réplica 830c: SM venta −1 manz tardío ligado a la venta", LATE_SALE_MOVE_SQL, [manz.id, saleId], client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  c.eq("stocks tras la réplica", await lab.stocks([dura.id, manz.id]), { [dura.id]: 8, [manz.id]: 7 });
  // Residuo documental del parche: el movimiento `venta` original de «dura» sigue ligado a una venta que ya no
  // tiene esa línea, y su restock es un `ajuste_entrada` (tipo de cancelación) sobre una venta que sigue viva.
  return replicaOutcome(lab, t, c, "20260830c", { venta: saleId }, [
    { view: "movements_without_document", label: "venta original de dura sin línea en el documento", where: { issue: "missing_document_line", product_id: dura.id, sale_id: saleId, type: "venta" } },
    { view: "reversal_mismatches", label: "ajuste_entrada ligado a una venta viva", where: { issue: "reversal_on_live_document", document_type: "sale", document_id: saleId, product_id: dura.id, original_delta: -1, reversal_delta: 1 } },
  ]);
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

type Runner = (lab: Lab, t: CaseCtx) => Promise<CaseOutcome>;

type RowCases = { title: string; symptom?: Runner | string; fix: Runner; replica?: Runner };

const ROW_CASES: Record<string, RowCases> = {
  "20260813d": { title: "split de un producto en 3 variantes", fix: os813dFix, replica: os813dReplica },
  "20260813e": { title: "compra en modo empaque con 1 pack en vez de 3", symptom: "pack_count mal capturado en el formulario de compra (el API respeta lo enviado: h02.pack_normalization)", fix: os813eFix },
  "20260813f": { title: "12 u cargadas al SKU genérico en vez de a la variante", symptom: "producto equivocado al cargar la compra (selector)", fix: transferFix(12, 12), replica: transferReplica("20260813f", 12, 12) },
  "20260815c": { title: "12 u en el genérico que eran 6 + 6 con la variante", symptom: "producto equivocado al cargar la compra (selector)", fix: transferFix(12, 6), replica: transferReplica("20260815c", 12, 6) },
  "20260818": { title: "venta con cantidad 2 que debía ser 1", symptom: "cantidad duplicada en el carrito del POS", fix: os818Fix },
  "20260821": { title: "compra cargada al producto equivocado", symptom: "producto equivocado en el selector de la compra", fix: os821Fix, replica: os821Replica },
  "20260830": { title: "ventas pendiente_pago repetidas por reintentos", symptom: os830Symptom, fix: os830Fix, replica: os830Replica },
  "20260830b_add": { title: "venta con 8 u que debían ser 9", symptom: "el carrito no reflejó la última unidad antes de confirmar", fix: (lab, t) => secondSaleFix(lab, t, 8, true), replica: os830bAddReplica },
  "20260830b_remove": { title: "venta con una línea que no se vendió", symptom: "variante de nombre parecido agregada por error en el POS", fix: os830bRemoveFix, replica: os830bRemoveReplica },
  "20260830c": { title: "línea de venta con el producto equivocado", symptom: "producto equivocado seleccionado en el POS", fix: os830cFix, replica: os830cReplica },
  "20260830d": { title: "venta a la que le faltaba una línea", symptom: "el carrito perdió un ítem antes de confirmar", fix: (lab, t) => secondSaleFix(lab, t, 1, false), replica: os830dReplica },
};

function buildCases(): CaseDef[] {
  const cases: CaseDef[] = [];
  for (const row of ONESHOT_ROWS) {
    const spec = ROW_CASES[row.key];
    if (!spec) throw new Error(`Falta el escenario del one-shot ${row.key}.`);
    const base = `os.${row.key}`;
    const symptom = spec.symptom;
    if (typeof symptom === "string") {
      const reason = uiSkipReason(row, symptom);
      cases.push({ id: `${base}.symptom`, title: `${spec.title} · síntoma`, hypothesis: row.hypothesis, run: async () => skip(reason) });
    } else if (symptom) {
      cases.push({ id: `${base}.symptom`, title: `${spec.title} · síntoma por API`, hypothesis: row.hypothesis, run: symptom });
    }
    // La corrección por API no decide ninguna hipótesis: sin etiqueta para no contaminar el agregado.
    cases.push({ id: `${base}.fix_by_api`, title: `${spec.title} · corrección por API sin SQL`, hypothesis: [], run: spec.fix });
    if (spec.replica) {
      cases.push({ id: `${base}.sql_replica`, title: `${spec.title} · réplica de la escritura SQL del parche`, hypothesis: ["H7"], run: spec.replica });
    }
  }
  return cases;
}

export const ONESHOT_CASES: readonly CaseDef[] = buildCases();

if (require.main === module) {
  runSuite("oneshots", ONESHOT_CASES, process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
