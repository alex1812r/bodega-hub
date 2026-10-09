/**
 * Escenarios `pack.assorted_*` (PRO-12, parche `20261009d-assorted-pack.sql`): empaque surtido, una receta con
 * varios componentes que se abre con `convert_pack_to_units`.
 *
 *   npm run stock-lab:scenarios -- --suite hypotheses --only pack.assorted_recipe_222,pack.assorted_real_312
 *
 * Corren con la suite `hypotheses` (mismo runner y mismo formato de salida). No pasan por el BFF, que todavía no
 * envía `p_components`: las recetas se guardan con la RPC `save_pack_recipe` como `lab-almacen` (desde 20261011d
 * `authenticated` no escribe las tablas de la receta) y los empaques se abren llamando a la RPC por PostgREST.
 *
 * Convención: `expected` describe lo que haría un sistema sano; `fail` = bug reproducido. Todo sobre productos
 * propios `s403-<run>-…` con stock por `inventario_inicial`.
 */
import { randomUUID } from "node:crypto";

import type { LabRoleKey } from "../agents/base";
import { Checks, outcome, type CaseCtx, type CaseDef, type CaseOutcome, type Lab, type LabProductRef, type Movement, type RestResult } from "./db";

// ---------------------------------------------------------------------------
// Lógica pura: el reparto del costo tal como lo hace la RPC (oráculo de los casos)
// ---------------------------------------------------------------------------

export type CostLine = { id: string; units: number; weight: number };

/** División entera redondeada al más cercano (mitades hacia arriba; todo es ≥ 0), como `round(numeric, n)`. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

const toScaled = (value: number, scale: number): bigint => BigInt(Math.round(value * scale));

/**
 * Parte del valor transferido que toca a cada componente con unidades (en REF, 4 decimales): proporcional a
 * unidades × peso; el de mayor unidades × peso (si empatan, el de mayor id) se queda con el residuo del redondeo.
 * La suma de las partes es exactamente `transferred`.
 */
export function allocateCost(transferred: number, lines: readonly CostLine[]): Record<string, number> {
  const active = lines.filter((line) => line.units > 0).map((line) => ({ id: line.id, weighted: BigInt(line.units) * toScaled(line.weight, 10_000) }));
  if (active.length === 0) return {};
  const total = active.reduce((sum, line) => sum + line.weighted, BigInt(0));
  const value = toScaled(transferred, 10_000);
  const residual = active.reduce((best, line) => (line.weighted > best.weighted || (line.weighted === best.weighted && line.id > best.id) ? line : best));
  const out: Record<string, number> = {};
  let allocated = BigInt(0);
  for (const line of active) {
    if (line.id === residual.id) continue;
    const part = roundDiv(value * line.weighted, total);
    allocated += part;
    out[line.id] = Number(part) / 10_000;
  }
  out[residual.id] = Number(value - allocated) / 10_000;
  return out;
}

/** Costo del componente tras recibir `units` con valor `share`: promedio ponderado a 2 decimales (sin stock previo, el de la entrada). */
export function weightedCost(stock: number, cost: number, units: number, share: number): number {
  const shareScaled = toScaled(share, 10_000);
  if (stock <= 0) return Number(roundDiv(shareScaled, BigInt(units) * BigInt(100))) / 100;
  const numerator = BigInt(stock) * toScaled(cost, 100) * BigInt(100) + shareScaled;
  return Number(roundDiv(numerator, BigInt(stock + units) * BigInt(100))) / 100;
}

// ---------------------------------------------------------------------------
// Helpers de escenario
// ---------------------------------------------------------------------------

type RecipeLine = { product: LabProductRef; units: number; weight?: number };
type Share = { unit_product_id: string; units: number };
type OpenOptions = { components?: readonly Share[]; clientRequestId?: string; quantity?: number };
type ConversionResult = { conversionId?: unknown; components?: Array<Record<string, unknown>> };

const STOCKER: LabRoleKey = "almacen";
const DEADLOCK_RE = /deadlock|40P01/i;

const share = (product: LabProductRef, units: number): Share => ({ unit_product_id: product.id, units });
const resultOf = (res: RestResult): ConversionResult => (res.data && typeof res.data === "object" ? (res.data as ConversionResult) : {});
export const explain = (res: RestResult): string => (res.error ? `${res.status} ${res.error.code ?? ""} ${res.error.message}`.trim() : String(res.status));

export async function setCost(t: CaseCtx, product: LabProductRef, cost: number): Promise<void> {
  await t.sql(`fixture costo ${product.sku}`, "update public.products set current_cost_ref = $2 where id = $1", [product.id, cost]);
}

/** Receta por la RPC `save_pack_recipe` como `lab-almacen`: único camino de escritura desde 20261011d. */
export async function createRecipe(lab: Lab, t: CaseCtx, pack: LabProductRef, lines: readonly RecipeLine[]): Promise<string> {
  const total = lines.reduce((sum, line) => sum + line.units, 0);
  const saved = await t.rpc(STOCKER, "save_pack_recipe", {
    p_pack_product_id: pack.id,
    p_enabled: true,
    p_total_units: total,
    p_label: `S403 surtido x${total}`,
    p_components: lines.map((line) => ({ unit_product_id: line.product.id, units_per_pack: line.units, cost_weight: line.weight ?? 1 })),
  });
  const id = saved.data && typeof saved.data === "object" ? (saved.data as { conversionId?: unknown }).conversionId : null;
  if (saved.error || typeof id !== "string") throw new Error(`No se pudo guardar la receta: ${explain(saved)}`);
  return id;
}

function open(t: CaseCtx, pack: LabProductRef, options: OpenOptions = {}, as: LabRoleKey = STOCKER): Promise<RestResult> {
  return t.rpc(as, "convert_pack_to_units", {
    p_pack_product_id: pack.id,
    p_pack_quantity: options.quantity ?? 1,
    p_reason: `S403 ${t.key}`,
    ...(options.clientRequestId ? { p_client_request_id: options.clientRequestId } : {}),
    ...(options.components ? { p_components: options.components } : {}),
  });
}

export async function facts(lab: Lab, products: readonly LabProductRef[]): Promise<Array<{ stock: number; cost: number }>> {
  const rows = await lab.rows<{ id: string; current_stock: number; cost: number }>(
    "select id, current_stock, current_cost_ref::float8 as cost from public.products where id = any($1::uuid[])",
    [products.map((p) => p.id)],
  );
  return products.map((p) => {
    const row = rows.find((r) => r.id === p.id);
    return { stock: row?.current_stock ?? Number.NaN, cost: row?.cost ?? Number.NaN };
  });
}

async function conversionMoves(lab: Lab, product: LabProductRef): Promise<Movement[]> {
  return (await lab.movements(product.id)).filter((move) => move.conversion_id);
}

/** Movimientos de conversión de varios productos, uno tras otro (la conexión del oráculo no admite consultas en paralelo). */
async function allConversionMoves(lab: Lab, products: readonly LabProductRef[]): Promise<Movement[]> {
  const out: Movement[] = [];
  for (const product of products) out.push(...(await conversionMoves(lab, product)));
  return out;
}

const brief = (moves: readonly Movement[]): Array<[string, number, number]> => moves.map((move) => [move.type, move.quantity_delta, move.stock_after]);

/** Las 9 vistas en 0 para los productos del caso. */
export async function expectClean(c: Checks, t: CaseCtx): Promise<void> {
  const scoped = await t.scoped();
  c.eq("vistas de integridad de los productos del caso", Object.fromEntries(Object.entries(scoped).filter(([, rows]) => rows > 0)), {});
}

/** Empaque con stock y costo, y tres productos sueltos sin stock (a < b < c por id, el orden de la RPC). */
async function trio(t: CaseCtx, packStock: number, packCost: number): Promise<{ pack: LabProductRef; a: LabProductRef; b: LabProductRef; c: LabProductRef }> {
  const pack = await t.product("pack", packStock);
  await setCost(t, pack, packCost);
  const units = [await t.product("u1", 0), await t.product("u2", 0), await t.product("u3", 0)].sort((x, y) => x.id.localeCompare(y.id));
  const [a, b, c] = units;
  if (!a || !b || !c) throw new Error("No se pudieron crear los tres componentes.");
  for (const unit of units) await setCost(t, unit, 0);
  return { pack, a, b, c };
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

async function recipe222(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, a, b, c } = await trio(t, 5, 6);
  await createRecipe(lab, t, pack, [{ product: a, units: 2 }, { product: b, units: 2 }, { product: c, units: 2 }]);

  const res = await open(t, pack, { quantity: 2 });
  checks.ok("abrir 2 empaques sin distribución", !res.error, explain(res));
  const packMoves = await conversionMoves(lab, pack);
  const unitMoves = [await conversionMoves(lab, a), await conversionMoves(lab, b), await conversionMoves(lab, c)];
  const after = await facts(lab, [pack, a, b, c]);
  checks.eq("salida del empaque", brief(packMoves), [["conversion_salida", -2, 3]]);
  checks.eq("una entrada de 2 × 2 por componente", unitMoves.map(brief), [[["conversion_entrada", 4, 4]], [["conversion_entrada", 4, 4]], [["conversion_entrada", 4, 4]]]);
  const conversionId = packMoves[0]?.conversion_id ?? null;
  checks.ok("los 4 movimientos comparten conversion_id", Boolean(conversionId) && unitMoves.every((moves) => moves[0]?.conversion_id === conversionId));
  checks.eq("stock y costo (12,00 repartido en 12 unidades)", after, [{ stock: 3, cost: 6 }, { stock: 4, cost: 1 }, { stock: 4, cost: 1 }, { stock: 4, cost: 1 }]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { pack: -2, por_componente: "+4 (2 por empaque × 2)", movimientos: "1 conversion_salida + 3 conversion_entrada con el mismo conversion_id" },
    actual: { status: res.status, estado: after, pack: brief(packMoves), componentes: unitMoves.map(brief) },
    evidence: [`empaque ${pack.id}`, `componentes ${a.id} ${b.id} ${c.id}`, `conversion ${String(conversionId)}`],
  });
}

async function real312(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, a, b, c } = await trio(t, 5, 6);
  await createRecipe(lab, t, pack, [{ product: a, units: 2 }, { product: b, units: 2 }, { product: c, units: 2 }]);

  const res = await open(t, pack, { components: [share(a, 3), share(b, 1), share(c, 2)] });
  checks.ok("abrir 1 empaque con la distribución real 3-1-2", !res.error, explain(res));
  const after = await facts(lab, [pack, a, b, c]);
  const entries = [await conversionMoves(lab, a), await conversionMoves(lab, b), await conversionMoves(lab, c)].map(brief);
  checks.eq("entra lo contado, no lo de la receta", entries, [[["conversion_entrada", 3, 3]], [["conversion_entrada", 1, 1]], [["conversion_entrada", 2, 2]]]);
  checks.eq("stock y costo", after, [{ stock: 4, cost: 6 }, { stock: 3, cost: 1 }, { stock: 1, cost: 1 }, { stock: 2, cost: 1 }]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { pack: -1, componentes: [3, 1, 2], conversion_mismatches: 0 },
    actual: { status: res.status, estado: after, componentes: entries },
    evidence: [`empaque ${pack.id}`, `conversion ${String(resultOf(res).conversionId)}`],
  });
}

async function badSum(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, a, b, c } = await trio(t, 5, 6);
  const stranger = await t.product("ajeno", 0);
  await createRecipe(lab, t, pack, [{ product: a, units: 2 }, { product: b, units: 2 }, { product: c, units: 2 }]);
  const before = await facts(lab, [pack, a, b, c, stranger]);

  const attempts: Array<[string, Share[]]> = [
    ["suma de menos (5 de 6)", [share(a, 3), share(b, 1), share(c, 1)]],
    ["suma de más (7 de 6)", [share(a, 3), share(b, 2), share(c, 2)]],
    ["producto que no es de la receta", [share(a, 2), share(b, 2), share(stranger, 2)]],
    ["componente repetido", [share(a, 2), share(b, 2), share(a, 2)]],
    ["unidades negativas", [share(a, 7), share(b, -1)]],
  ];
  const rejected: Array<[string, number, string | null]> = [];
  for (const [name, components] of attempts) {
    const res = await open(t, pack, { components, clientRequestId: randomUUID() });
    rejected.push([name, res.status, res.error?.code ?? null]);
    checks.eq(`${name}: rechazo PT400`, [res.status, res.error?.code ?? null], [400, "PT400"]);
  }
  const moves = await allConversionMoves(lab, [pack, a, b, c, stranger]);
  const afterRejects = await facts(lab, [pack, a, b, c, stranger]);
  checks.eq("sin movimientos tras los rechazos", moves.length, 0);
  checks.eq("stock y costo intactos", afterRejects, before);

  const valid = await open(t, pack, { components: [share(a, 2), share(b, 2), share(c, 2)] });
  checks.ok("tras los rechazos, una distribución correcta entra", !valid.error, explain(valid));
  checks.eq("stock tras la apertura válida", (await facts(lab, [pack, a, b, c])).map((f) => f.stock), [4, 2, 2, 2]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { rechazos: "400 PT400 sin efectos", valida: "pack -1, componentes +2 +2 +2" },
    actual: { rechazos: rejected, movimientos_tras_rechazos: moves.length },
    evidence: [`empaque ${pack.id}`, `ajeno ${stranger.id}`],
  });
}

async function costWeights(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const pack = await t.product("pack", 5);
  await setCost(t, pack, 10.01);
  const withStock = await t.product("u1", 10);
  const [x, y] = [await t.product("u2", 0), await t.product("u3", 0)];
  for (const unit of [x, y]) await setCost(t, unit, 0);
  const lines: RecipeLine[] = [{ product: withStock, units: 2, weight: 1 }, { product: x, units: 2, weight: 3 }, { product: y, units: 2, weight: 0.5 }];
  await createRecipe(lab, t, pack, lines);
  const products = lines.map((line) => line.product);
  let state = await facts(lab, products);
  const sums: number[] = [];
  const expectedCosts: number[][] = [];

  // Apertura 1: por receta. Apertura 2: 2 empaques con reparto real 6-4-2.
  const openings: Array<{ quantity: number; units: number[]; components?: Share[] }> = [
    { quantity: 1, units: [2, 2, 2] },
    { quantity: 2, units: [6, 4, 2], components: [share(withStock, 6), share(x, 4), share(y, 2)] },
  ];
  for (const opening of openings) {
    const transferred = Math.round(opening.quantity * 10.01 * 100) / 100;
    const parts = allocateCost(transferred, lines.map((line, i) => ({ id: line.product.id, units: opening.units[i] ?? 0, weight: line.weight ?? 1 })));
    const expected = lines.map((line, i) => weightedCost(state[i]?.stock ?? 0, state[i]?.cost ?? 0, opening.units[i] ?? 0, parts[line.product.id] ?? 0));
    const res = await open(t, pack, { quantity: opening.quantity, components: opening.components });
    checks.ok(`abrir ${opening.quantity} empaque(s)`, !res.error, explain(res));
    const allocated = (resultOf(res).components ?? []).map((component) => Number(component.allocatedValueRef));
    const sum = Math.round(allocated.reduce((total, value) => total + value, 0) * 10_000) / 10_000;
    sums.push(sum);
    checks.eq(`valor repartido = valor transferido (${opening.quantity} × 10,01)`, sum, transferred);
    checks.eq(
      "parte de cada componente = unidades × peso, con el residuo en el de mayor peso",
      (resultOf(res).components ?? []).map((component) => [component.unitProductId, Number(component.allocatedValueRef)]).sort(),
      Object.entries(parts).sort(),
    );
    state = await facts(lab, products);
    expectedCosts.push(expected);
    checks.eq("costo de cada componente = promedio ponderado con su parte", state.map((f) => f.cost), expected);
  }
  checks.eq("stock final de los componentes", state.map((f) => f.stock), [18, 6, 4]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { suma_repartida: [10.01, 20.02], costos: expectedCosts },
    actual: { suma_repartida: sums, estado: state },
    evidence: [`empaque ${pack.id}`, `componentes ${products.map((p) => p.id).join(" ")}`],
  });
}

async function sharedUnitParallel(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const ROUNDS = 10;
  const [box, mix] = [await t.product("caja", 20), await t.product("mixto", 20)];
  await setCost(t, box, 6);
  await setCost(t, mix, 9);
  const [sharedUnit, extra] = [await t.product("compartido", 0), await t.product("extra", 0)];
  for (const unit of [sharedUnit, extra]) await setCost(t, unit, 0);
  // La caja es un par de siempre (1 componente); el mixto, un surtido que también contiene al producto compartido.
  await createRecipe(lab, t, box, [{ product: sharedUnit, units: 6 }]);
  await createRecipe(lab, t, mix, [{ product: sharedUnit, units: 2 }, { product: extra, units: 4 }]);

  // Las dos recetas a la vez, ROUNDS veces cada una, todas en vuelo.
  const responses = await Promise.all(Array.from({ length: ROUNDS * 2 }, (_, i) => open(t, i % 2 === 0 ? box : mix)));
  const failed = responses.filter((res) => res.error);
  checks.eq("todas las aperturas simultáneas entran", failed.map(explain), []);
  checks.ok("sin deadlock", !responses.some((res) => DEADLOCK_RE.test(res.error?.message ?? "")));

  const after = await facts(lab, [box, mix, sharedUnit, extra]);
  checks.eq("stock final (caja, mixto, compartido, extra)", after.map((f) => f.stock), [20 - ROUNDS, 20 - ROUNDS, ROUNDS * 8, ROUNDS * 4]);
  // Costo del compartido: el promedio ponderado aplicado en el orden real del libro (cada entrada: 6 a 1,00 o 2 a 1,50).
  let stock = 0;
  let cost = 0;
  const entries = await conversionMoves(lab, sharedUnit);
  for (const move of entries) {
    cost = weightedCost(stock, cost, move.quantity_delta, move.quantity_delta === 6 ? 6 : 3);
    stock += move.quantity_delta;
  }
  checks.eq("entradas del compartido", [entries.filter((m) => m.quantity_delta === 6).length, entries.filter((m) => m.quantity_delta === 2).length], [ROUNDS, ROUNDS]);
  checks.eq("costo del compartido = promedio ponderado en el orden del libro", after[2]?.cost, cost);
  checks.eq("costo del extra (6,00 entre 4 unidades)", after[3]?.cost, 1.5);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { stock: [20 - ROUNDS, 20 - ROUNDS, ROUNDS * 8, ROUNDS * 4], costo_compartido: cost, deadlocks: 0, conversion_mismatches: 0 },
    actual: { statuses: responses.map((res) => res.status), estado: after },
    evidence: [`caja ${box.id}`, `mixto ${mix.id}`, `compartido ${sharedUnit.id}`, `extra ${extra.id}`],
  });
}

async function doubleSubmit(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, a, b, c } = await trio(t, 5, 6);
  await createRecipe(lab, t, pack, [{ product: a, units: 2 }, { product: b, units: 2 }, { product: c, units: 2 }]);
  const clientRequestId = randomUUID();
  const components = [share(a, 3), share(b, 1), share(c, 2)];

  const twice = await Promise.all([open(t, pack, { clientRequestId, components }), open(t, pack, { clientRequestId, components })]);
  const later = await open(t, pack, { clientRequestId, components });
  const ids = [...twice, later].map((res) => resultOf(res).conversionId ?? null);
  checks.eq("los tres envíos con la misma clave responden 200", [...twice, later].map((res) => res.status), [200, 200, 200]);
  checks.ok("y devuelven la misma conversión", typeof ids[0] === "string" && ids.every((id) => id === ids[0]), JSON.stringify(ids));
  const otherShares = await open(t, pack, { clientRequestId, components: [share(a, 2), share(b, 2), share(c, 2)] });
  const noShares = await open(t, pack, { clientRequestId });
  checks.eq("misma clave con otro reparto o sin reparto: 409", [otherShares.status, otherShares.error?.code ?? null, noShares.status, noShares.error?.code ?? null], [409, "PT409", 409, "PT409"]);
  const after = await facts(lab, [pack, a, b, c]);
  const moves = await allConversionMoves(lab, [pack, a, b, c]);
  checks.eq("una sola apertura en el libro", [moves.length, after.map((f) => f.stock)], [4, [4, 3, 1, 2]]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { aperturas: 1, movimientos: 4, misma_clave_otro_cuerpo: 409 },
    actual: { ids, statuses: [...twice, later, otherShares, noShares].map((res) => res.status), stock: after.map((f) => f.stock), movimientos: moves.length },
    evidence: [`empaque ${pack.id}`, `clave ${clientRequestId}`],
  });
}

async function zeroPacks(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, a, b, c } = await trio(t, 5, 6);
  await createRecipe(lab, t, pack, [{ product: a, units: 2 }, { product: b, units: 2 }, { product: c, units: 2 }]);
  const before = await facts(lab, [pack, a, b, c]);

  const attempts: Array<[string, OpenOptions]> = [
    ["0 empaques por receta", { quantity: 0 }],
    ["0 empaques con distribución vacía", { quantity: 0, components: [] }],
    ["-1 empaque", { quantity: -1 }],
    ["0 empaques con clave", { quantity: 0, clientRequestId: randomUUID() }],
  ];
  const seen: Array<[string, number, string | null]> = [];
  for (const [name, options] of attempts) {
    const res = await open(t, pack, options);
    seen.push([name, res.status, res.error?.code ?? null]);
    checks.eq(`${name}: rechazo PT400`, [res.status, res.error?.code ?? null], [400, "PT400"]);
  }
  // Una cantidad no entera no llega a la función: PostgREST la rechaza al convertirla (4xx, sin efectos).
  const fractional = await open(t, pack, { quantity: 1.5 });
  checks.rejected("1,5 empaques", fractional.status, fractional.error?.message ?? "");
  const moves = await allConversionMoves(lab, [pack, a, b, c]);
  checks.eq("sin movimientos", moves.length, 0);
  checks.eq("stock y costo intactos", await facts(lab, [pack, a, b, c]), before);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { rechazos: "400 PT400", movimientos: 0 },
    actual: { rechazos: seen, fraccion: [fractional.status, fractional.error?.code ?? null], movimientos: moves.length },
    evidence: [`empaque ${pack.id}`],
  });
}

async function inactiveComponent(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, a, b, c } = await trio(t, 5, 6);
  await createRecipe(lab, t, pack, [{ product: a, units: 2 }, { product: b, units: 2 }, { product: c, units: 2 }]);
  await t.sql(`fixture desactivar ${b.sku}`, "update public.products set is_active = false where id = $1", [b.id]);

  const res = await open(t, pack);
  // Decisión PRO-12: igual que hoy con una unidad inactiva, la apertura no se bloquea; el resultado marca el componente.
  checks.ok("el empaque se abre con un componente inactivo", !res.error, explain(res));
  const flags = (resultOf(res).components ?? []).map((component) => [component.unitProductId, component.isActive]);
  checks.eq("el resultado marca el componente inactivo", flags, [[a.id, true], [b.id, false], [c.id, true]]);
  const after = await facts(lab, [pack, a, b, c]);
  checks.eq("stock tras abrir", after.map((f) => f.stock), [4, 2, 2, 2]);
  checks.note("un componente inactivo recibe sus unidades (aviso en el resultado, no bloqueo), igual que la unidad inactiva de un par 1 a 1");
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { apertura: "200", isActive: [true, false, true], stock: [4, 2, 2, 2] },
    actual: { status: res.status, isActive: flags, stock: after.map((f) => f.stock) },
    evidence: [`empaque ${pack.id}`, `componente inactivo ${b.id}`],
  });
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export const ASSORTED_PACK_CASES: readonly CaseDef[] = [
  { id: "pack.assorted_recipe_222", title: "Surtido 2-2-2 sin distribución: cada componente recibe sus unidades por empaque", hypothesis: ["H5"], run: recipe222 },
  { id: "pack.assorted_real_312", title: "Surtido con distribución real 3-1-2: entra lo contado", hypothesis: ["H5"], run: real312 },
  { id: "pack.assorted_bad_sum", title: "Distribución que no suma, con un producto ajeno o repetido: PT400 sin efectos", hypothesis: ["H5"], run: badSum },
  { id: "pack.assorted_cost_weights", title: "Pesos de costo distintos: el valor del empaque se conserva al repartirlo", hypothesis: ["H5"], run: costWeights },
  { id: "pack.assorted_shared_unit_parallel", title: "El mismo producto unidad en dos recetas, abiertas a la vez: stock y costo correctos, sin deadlock", hypothesis: ["H5", "H6"], run: sharedUnitParallel },
  { id: "pack.assorted_double_submit", title: "Doble envío de una apertura con distribución y la MISMA clave: una sola apertura", hypothesis: ["H8"], run: doubleSubmit },
  { id: "pack.assorted_zero_packs", title: "Abrir 0 empaques (o menos) de un surtido: PT400 sin efectos", hypothesis: ["H5"], run: zeroPacks },
  { id: "pack.assorted_inactive_component", title: "Surtido con un componente inactivo: se abre y el resultado lo marca", hypothesis: ["H5"], run: inactiveComponent },
];
