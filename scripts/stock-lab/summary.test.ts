import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readEvents, type LabEvent } from "./agents/logger";
import { agentArgv, agentFileFor, assignAgents, defaultRunId, parseRunArgs } from "./run";
import {
  RECONCILE_PENDING_TEXT,
  buildSummary,
  countErrorsByStatus,
  countOpsByType,
  expectedDeltaByProduct,
  expectedStockByProduct,
  findAllBreaks,
  findChainBreak,
  findFirstBreak,
  movementsInRun,
  shortSummary,
  type SummaryMovement,
  type SummaryProduct,
} from "./summary";

jest.mock("pg", () => ({ Client: class {} }));

const FIXTURES = resolve(__dirname, "__fixtures__");

const events: LabEvent[] = readEvents(resolve(FIXTURES, "events-bisect.jsonl"));
const fixture = JSON.parse(readFileSync(resolve(FIXTURES, "movements-bisect.json"), "utf8")) as {
  products: SummaryProduct[];
  movements: SummaryMovement[];
};
const { products, movements } = fixture;
const ofProduct = (id: string) => movements.filter((m) => m.product_id === id);

describe("fixture events-bisect", () => {
  it("tiene ≥ 12 eventos de 3 agentes o más sobre 3 productos, con un 400 y un agent_error", () => {
    expect(events.length).toBeGreaterThanOrEqual(12);
    expect(new Set(events.map((e) => e.agent)).size).toBeGreaterThanOrEqual(3);
    expect(Object.keys(expectedDeltaByProduct(events)).sort()).toEqual(["prod-a", "prod-b", "prod-c"]);
    expect(events.some((e) => e.status === 400)).toBe(true);
    expect(events.some((e) => e.op === "agent_error" && e.status === 0)).toBe(true);
  });
});

describe("countOpsByType", () => {
  it("cuenta total/2xx/no-2xx por op", () => {
    const ops = countOpsByType(events);
    expect(ops.sale_create).toEqual({ total: 7, ok: 6, failed: 1 });
    expect(ops.purchase_create).toEqual({ total: 2, ok: 2, failed: 0 });
    expect(ops.adjustment).toEqual({ total: 2, ok: 2, failed: 0 });
    expect(ops.sale_cancel).toEqual({ total: 1, ok: 1, failed: 0 });
    expect(ops.agent_error).toEqual({ total: 1, ok: 0, failed: 1 });
    expect(ops.noop).toEqual({ total: 1, ok: 1, failed: 0 });
  });
});

describe("countErrorsByStatus", () => {
  it("solo cuenta no-2xx (status × op), incluido el 0", () => {
    expect(countErrorsByStatus(events)).toEqual({
      "400": { sale_create: 1 },
      "0": { agent_error: 1 },
    });
  });
});

describe("expectedDeltaByProduct / movementsInRun", () => {
  it("suma expected_delta solo de los 2xx", () => {
    expect(expectedDeltaByProduct(events)).toEqual({ "prod-a": 7, "prod-b": 0, "prod-c": 2 });
  });

  it("deja fuera los movimientos anteriores al run (stock inicial)", () => {
    const inRun = movementsInRun(events, movements);
    expect(inRun.map((m) => m.id)).not.toContain("m-a0");
    expect(inRun).toHaveLength(movements.length - 1);
    expect(movementsInRun([], movements)).toEqual([]);
  });
});

describe("expectedStockByProduct", () => {
  const rows = expectedStockByProduct(events, products, movements);
  const row = (id: string) => rows.find((r) => r.productId === id);

  it("solo incluye productos tocados, ordenados por sku", () => {
    expect(rows.map((r) => r.productId)).toEqual(["prod-a", "prod-b", "prod-c"]);
  });

  it("A cuadra en las tres comparaciones (esperado, Σmov run/total, current_stock vs último stock_after)", () => {
    expect(row("prod-a")).toMatchObject({
      sku: "LAB-HOT-01",
      expectedDelta: 7,
      runMovementDelta: 7,
      totalMovementDelta: 107,
      currentStock: 107,
      lastStockAfter: 107,
      deltaOk: true,
      stockOk: true,
    });
  });

  it("B descuadra en delta (venta 2xx sin movimiento) pero current_stock sigue al último stock_after", () => {
    expect(row("prod-b")).toMatchObject({
      expectedDelta: 0,
      runMovementDelta: 1,
      currentStock: 51,
      lastStockAfter: 51,
      deltaOk: false,
      stockOk: true,
    });
  });

  it("C cuadra en Σ pero su cadena está rota (lo detecta la bisección)", () => {
    expect(row("prod-c")).toMatchObject({ expectedDelta: 2, runMovementDelta: 2, deltaOk: true, stockOk: true });
  });

  it("marca stockOk=false si current_stock no coincide con el último stock_after", () => {
    const drifted = products.map((p) => (p.id === "prod-a" ? { ...p, current_stock: 99 } : p));
    expect(expectedStockByProduct(events, drifted, movements).find((r) => r.productId === "prod-a")).toMatchObject({
      currentStock: 99,
      lastStockAfter: 107,
      stockOk: false,
    });
  });

  it("un producto desconocido sale con sku ? y current_stock null", () => {
    const row2 = expectedStockByProduct(events, [], movements).find((r) => r.productId === "prod-b");
    expect(row2).toMatchObject({ sku: "?", currentStock: null, stockOk: false });
  });
});

describe("findChainBreak", () => {
  it("devuelve el primer movimiento cuyo stock_after no es anterior + delta", () => {
    expect(findChainBreak(ofProduct("prod-a"))).toBeNull();
    expect(findChainBreak(ofProduct("prod-c"))?.id).toBe("m-c3");
    expect(findChainBreak([])).toBeNull();
  });
});

describe("findFirstBreak", () => {
  it("A: null, todo cuadra", () => {
    expect(findFirstBreak(events, ofProduct("prod-a"), "prod-a")).toBeNull();
  });

  it("B: culpa a la venta 2xx sin movimiento (sale-3)", () => {
    const found = findFirstBreak(events, ofProduct("prod-b"), "prod-b");
    expect(found).toMatchObject({
      productId: "prod-b",
      reason: "missing_movement",
      expected: -1,
      actual: 0,
      movement: null,
    });
    expect(found?.event?.response_id).toBe("sale-3");
    expect(found?.event?.agent).toBe("vendedor-2");
  });

  it("C: chain_break en el tercer movimiento", () => {
    const found = findFirstBreak(events, ofProduct("prod-c"), "prod-c");
    expect(found).toMatchObject({
      productId: "prod-c",
      reason: "chain_break",
      event: null,
      expected: 32,
      actual: 30,
    });
    expect(found?.movement?.id).toBe("m-c3");
  });

  it("ignora los eventos no-2xx y los de otros productos", () => {
    const extra: LabEvent = {
      ts: "2026-10-05T10:00:14.900Z",
      agent: "caos",
      op: "chaos_over_stock",
      payload: {},
      status: 409,
      response_id: null,
      expected_delta: {},
    };
    expect(findFirstBreak([...events, extra], ofProduct("prod-a"), "prod-a")).toBeNull();
  });

  it("acepta un movimiento concurrente en vuelo dentro de la tolerancia (ventana estricta)", () => {
    // El movimiento de la siguiente op entra en ts+2s pero la ventana estricta (≤ ts) cuadra.
    const evs: LabEvent[] = [
      { ts: "2026-10-05T11:00:00.900Z", agent: "v1", op: "sale_create", payload: {}, status: 201, response_id: "s1", expected_delta: { p: -1 } },
      { ts: "2026-10-05T11:00:01.900Z", agent: "v2", op: "sale_create", payload: {}, status: 201, response_id: "s2", expected_delta: { p: -2 } },
    ];
    const movs: SummaryMovement[] = [
      { id: "x1", product_id: "p", type: "venta", quantity_delta: -1, stock_after: 9, sale_id: "s1", purchase_id: null, conversion_id: null, created_at: "2026-10-05T11:00:00.400Z" },
      { id: "x2", product_id: "p", type: "venta", quantity_delta: -2, stock_after: 7, sale_id: "s2", purchase_id: null, conversion_id: null, created_at: "2026-10-05T11:00:01.400Z" },
    ];
    expect(findFirstBreak(evs, movs, "p")).toBeNull();
  });

  it("señala los movimientos sin evento que aparecen después del último evento", () => {
    const evs: LabEvent[] = [
      { ts: "2026-10-05T11:00:00.900Z", agent: "v1", op: "sale_create", payload: {}, status: 201, response_id: "s1", expected_delta: { p: -1 } },
    ];
    const movs: SummaryMovement[] = [
      { id: "x1", product_id: "p", type: "venta", quantity_delta: -1, stock_after: 9, sale_id: "s1", purchase_id: null, conversion_id: null, created_at: "2026-10-05T11:00:00.400Z" },
      { id: "x2", product_id: "p", type: "ajuste", quantity_delta: -5, stock_after: 4, sale_id: null, purchase_id: null, conversion_id: null, created_at: "2026-10-05T11:00:30.000Z" },
    ];
    const found = findFirstBreak(evs, movs, "p");
    expect(found).toMatchObject({ reason: "unattributed_movements", expected: -1, actual: -6 });
    expect(found?.movement?.id).toBe("x2");
    expect(found?.event?.response_id).toBe("s1");
  });

  describe("STK-308: corridas paralelas (ts del evento = hora de respuesta en el cliente)", () => {
    const mov = (over: Partial<SummaryMovement> & Pick<SummaryMovement, "id" | "quantity_delta" | "stock_after" | "created_at">): SummaryMovement => ({
      product_id: "p",
      type: over.quantity_delta < 0 ? "venta" : "compra",
      sale_id: null,
      purchase_id: null,
      conversion_id: null,
      ...over,
    });
    const ev = (over: Partial<LabEvent> & Pick<LabEvent, "ts" | "op" | "response_id">, delta: number): LabEvent => ({
      agent: "v1",
      payload: {},
      status: 201,
      expected_delta: { p: delta },
      ...over,
    });
    // A: venta −5 (ts 10.200). B: compra +120 de otro agente (ts 10.735) cuyo
    // movimiento se creó en 10.060, antes del ts de A.
    const saleA = ev({ ts: "2026-10-06T01:41:10.200Z", op: "sale_create", response_id: "s-a" }, -5);
    const purchaseB = ev({ ts: "2026-10-06T01:41:10.735Z", agent: "comprador", op: "purchase_create", response_id: "p-b" }, 120);
    const movA = mov({ id: "m-a", quantity_delta: -5, stock_after: 95, sale_id: "s-a", created_at: "2026-10-06T01:41:09.980Z" });
    const movB = mov({ id: "m-b", quantity_delta: 120, stock_after: 215, purchase_id: "p-b", created_at: "2026-10-06T01:41:10.060Z" });

    it("no culpa a nadie si Σ esperado == Σ movimientos y la cadena es válida", () => {
      expect(findFirstBreak([saleA, purchaseB], [movA, movB], "p")).toBeNull();
    });

    it("al bisecar atribuye por referencia (sale_id/purchase_id) y culpa al evento sin movimiento, no al primero por tiempo", () => {
      const saleC = ev({ ts: "2026-10-06T01:41:11.500Z", agent: "v2", op: "sale_create", response_id: "s-c" }, -1);
      const found = findFirstBreak([saleA, purchaseB, saleC], [movA, movB], "p");
      expect(found).toMatchObject({ reason: "missing_movement", expected: -1, actual: 0, movement: null });
      expect(found?.event?.response_id).toBe("s-c");
    });

    it("un evento con varias líneas del mismo producto suma todos sus movimientos; una cancelación consume los suyos", () => {
      const sale = ev({ ts: "2026-10-06T01:41:10.200Z", op: "sale_create", response_id: "s-1" }, -5);
      const cancel = ev({ ts: "2026-10-06T01:41:12.000Z", op: "sale_cancel", response_id: "s-1", status: 200 }, 5);
      const movs = [
        mov({ id: "m-1", quantity_delta: -2, stock_after: 98, sale_id: "s-1", created_at: "2026-10-06T01:41:10.000Z" }),
        mov({ id: "m-2", quantity_delta: -3, stock_after: 95, sale_id: "s-1", created_at: "2026-10-06T01:41:10.001Z" }),
        mov({ id: "m-3", quantity_delta: 5, stock_after: 100, sale_id: "s-1", type: "devolucion", created_at: "2026-10-06T01:41:11.900Z" }),
      ];
      expect(findFirstBreak([sale, cancel], movs, "p")).toBeNull();
      // Si la cancelación devuelve 4 en vez de 5: delta_mismatch en la cancelación.
      const short = movs.map((m) => (m.id === "m-3" ? { ...m, quantity_delta: 4, stock_after: 99 } : m));
      const found = findFirstBreak([sale, cancel], short, "p");
      expect(found).toMatchObject({ reason: "delta_mismatch", expected: 5, actual: 4 });
      expect(found?.event?.op).toBe("sale_cancel");
    });

    it("movimientos sin evento atribuible → unattributed_movements", () => {
      const extra = mov({ id: "m-x", quantity_delta: -7, stock_after: 208, created_at: "2026-10-06T01:41:30.000Z", type: "ajuste" });
      const found = findFirstBreak([saleA, purchaseB], [movA, movB, extra], "p");
      expect(found).toMatchObject({ reason: "unattributed_movements", expected: 115, actual: 108 });
      expect(found?.movement?.id).toBe("m-x");
    });
  });

  it("findAllBreaks reúne B y C", () => {
    expect(findAllBreaks(events, movements).map((b) => `${b.productId}:${b.reason}`).sort()).toEqual([
      "prod-b:missing_movement",
      "prod-c:chain_break",
    ]);
  });
});

describe("buildSummary", () => {
  it("contiene todas las secciones, la tabla de bisección y la nota de reconcile pendiente", () => {
    const md = buildSummary({
      runId: "20261005-100000-seed7",
      events,
      products,
      movements,
      reconcile: { status: "missing" },
      agents: [
        { name: "vendedor-1", exitCode: 0 },
        { name: "caos", exitCode: 1 },
      ],
    });
    expect(md).toContain("# Stock-lab run 20261005-100000-seed7");
    for (const section of [
      "## Agentes",
      "## Operaciones por tipo",
      "## Errores HTTP (status × op)",
      "## Descuadres por producto",
      "## Primer evento que rompió cada producto",
      "## Reconcile",
    ]) {
      expect(md).toContain(section);
    }
    expect(md).toContain(RECONCILE_PENDING_TEXT);
    expect(md).toContain("| caos | 1 | FALLÓ |");
    expect(md).toContain("| sale_create | 7 | 6 | 1 |");
    expect(md).toContain("| 0 (agent_error) | agent_error | 1 |");
    expect(md).toContain("| 400 | sale_create | 1 |");
    expect(md).toContain("| Producto B | LAB-HOT-02 | 0 | 1 | 1 | 51 | 51 | DESCUADRE | ok |");
    expect(md).toContain("| Producto B | LAB-HOT-02 | 2026-10-05T10:00:04.900Z · vendedor-2 · sale_create · sale-3 | missing_movement");
    expect(md).toContain("| Producto C | LAB-HOT-03 | 2026-10-05T10:00:09.400Z · mov m-c3 · venta · sale-5 | chain_break");
    expect(md).not.toContain("Producto D");
  });

  it("sin reconcile también dice que está pendiente; con raw lo vuelca y cuenta rows/mismatches", () => {
    expect(buildSummary({ runId: "r", events: [], products: [], movements: [] })).toContain(RECONCILE_PENDING_TEXT);
    const md = buildSummary({
      runId: "r",
      events: [],
      products: [],
      movements: [],
      reconcile: { status: "ok", raw: { rows: [1, 2], mismatches: [], other: true } },
    });
    expect(md).toContain("rows: 2");
    expect(md).toContain("mismatches: 0");
    expect(md).toContain('"other": true');
    expect(md).not.toContain(RECONCILE_PENDING_TEXT);
    const failed = buildSummary({ runId: "r", events: [], products: [], movements: [], reconcile: { status: "failed", error: "boom" } });
    expect(failed).toContain("reconcile falló: boom");
  });

  it("muestra avisos y el caso sin eventos", () => {
    const md = buildSummary({ runId: "r", events: [], products, movements: [], notes: ["base inaccesible"] });
    expect(md).toContain("## Avisos");
    expect(md).toContain("- base inaccesible");
    expect(md).toContain("(sin eventos)");
    expect(md).toContain("(ningún producto tocado)");
    expect(md).toContain("(sin agentes registrados)");
  });

  it("shortSummary devuelve 3 líneas", () => {
    const lines = shortSummary({ runId: "r", events, products, movements, agents: [{ name: "caos", exitCode: null }] });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("fallidos: caos");
    expect(lines[2]).toContain("2 producto(s)");
  });
});

describe("run.ts helpers", () => {
  it("parseRunArgs: paralelo con run id por defecto", () => {
    const now = new Date(2026, 9, 5, 9, 7, 3);
    expect(parseRunArgs(["--agents", "5", "--minutes", "10", "--seed", "42"], now)).toEqual({
      agents: 5,
      minutes: 10,
      seed: 42,
      run: "20261005-090703-seed42",
      serial: false,
    });
    expect(defaultRunId(1, now)).toBe("20261005-090703-seed1");
  });

  it("parseRunArgs: serial con ops y run explícito; errores claros", () => {
    expect(parseRunArgs(["--serial", "--ops=200", "--seed", "3", "--run", "lab-1"])).toEqual({
      agents: 1,
      ops: 200,
      seed: 3,
      run: "lab-1",
      serial: true,
    });
    expect(() => parseRunArgs(["--agents", "2", "--minutes", "1"])).toThrow(/--seed/);
    expect(() => parseRunArgs(["--agents", "2", "--seed", "1"])).toThrow(/--minutes <m> o --ops <n>/);
    expect(() => parseRunArgs(["--agents", "0", "--seed", "1", "--ops", "5"])).toThrow(/--agents/);
    expect(() => parseRunArgs(["--foo", "1", "--seed", "1", "--ops", "5"])).toThrow(/Flag desconocida --foo/);
    expect(() => parseRunArgs(["--seed", "1", "--ops", "5", "--run", "a b"])).toThrow(/--run/);
  });

  it("assignAgents reparte cíclicamente y sufija las vueltas", () => {
    expect(assignAgents(3, 10).map((p) => `${p.name}@${p.seed}`)).toEqual(["vendedor-1@10", "vendedor-2@11", "comprador@12"]);
    expect(assignAgents(7, 0).map((p) => p.name)).toEqual([
      "vendedor-1",
      "vendedor-2",
      "comprador",
      "almacen",
      "caos",
      "vendedor-1-b",
      "vendedor-2-b",
    ]);
    expect(assignAgents(11, 0)[10]?.name).toBe("vendedor-1-c");
    expect(assignAgents(7, 0).map((p) => p.file)).toContain("scripts/stock-lab/agents/vendedor.ts");
    expect(agentFileFor("vendedor-2-b")).toBe("vendedor");
    expect(agentFileFor("caos")).toBe("caos");
  });

  it("agentArgv arma el argv de npx tsx", () => {
    const plan = assignAgents(2, 5)[1];
    expect(plan).toBeDefined();
    if (!plan) return;
    expect(agentArgv(plan, { agents: 2, minutes: 0.5, seed: 5, run: "r1", serial: false })).toEqual([
      "tsx",
      "scripts/stock-lab/agents/vendedor.ts",
      "--run",
      "r1",
      "--seed",
      "6",
      "--minutes",
      "0.5",
      "--agent",
      "vendedor-2",
    ]);
  });
});
