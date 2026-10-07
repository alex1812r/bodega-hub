/** @jest-environment node */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApiClient, ApiResponse } from "../../e2e-bodegon/client";
import { INTEGRITY_VIEW_NAMES } from "../integrity-views";
import {
  AbortCase,
  CaseHarness,
  CaseRecorder,
  SuiteWriter,
  addDeltas,
  defaultScenarioRunId,
  diffSnapshots,
  emptySnapshot,
  evaluateOp,
  formatSummary,
  groupViewRows,
  mapMovementRows,
  parseScenarioArgs,
  renderMarkdown,
  resultToJsonLine,
  runCase,
  scopedViewsSql,
  selectCases,
  subSuiteArgs,
  suitesFor,
  summarize,
  verdictFromIssues,
  type CaseDef,
  type LabSession,
  type MovementRow,
  type OpExpectation,
  type Oracle,
  type Snapshot,
} from "./lib";

const P = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const SALE = "33333333-3333-4333-8333-333333333333";

function movement(overrides: Partial<MovementRow> & { id: string }): MovementRow {
  return {
    productId: P,
    type: "venta",
    quantityDelta: -2,
    stockAfter: 18,
    saleId: SALE,
    purchaseId: null,
    conversionId: null,
    createdAt: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function snap(stock: Record<string, number>, movements: MovementRow[] = [], extra: Partial<Snapshot> = {}): Snapshot {
  return { ...emptySnapshot(), stock, movements, ...extra };
}

const saleExpect: OpExpectation = {
  http: "accept",
  stockDelta: { [P]: -2 },
  movements: [{ productId: P, type: "venta", quantityDelta: -2 }],
  ref: { kind: "sale", id: SALE },
};

function evaluate(overrides: Partial<Parameters<typeof evaluateOp>[0]> = {}) {
  return evaluateOp({
    op: "POST /api/sales",
    expect: saleExpect,
    status: 201,
    message: "",
    before: snap({ [P]: 20 }),
    after: snap({ [P]: 18 }, [movement({ id: "m1" })]),
    ...overrides,
  });
}

describe("diffSnapshots / addDeltas", () => {
  it("calcula el delta de stock y los movimientos nuevos por id", () => {
    const before = snap({ [P]: 20 }, [movement({ id: "m0", type: "inventario_inicial", quantityDelta: 20, stockAfter: 20, saleId: null })]);
    const after = snap({ [P]: 18, [U]: 5 }, [...before.movements, movement({ id: "m1" })]);
    const diff = diffSnapshots(before, after);
    expect(diff.stockDelta).toEqual({ [P]: -2, [U]: 5 });
    expect(diff.newMovements.map((m) => m.id)).toEqual(["m1"]);
  });

  it("un producto que aún no existía cuenta desde 0 y los ceros no aparecen", () => {
    expect(diffSnapshots(snap({}), snap({ [P]: 7, [U]: 0 })).stockDelta).toEqual({ [P]: 7 });
    expect(addDeltas({ a: 2, b: 1 }, { a: -2, c: 3 })).toEqual({ b: 1, c: 3 });
  });
});

describe("evaluateOp", () => {
  it("pasa cuando stock, movimientos, cadena, referencia, vistas y HTTP cuadran", () => {
    const result = evaluate();
    expect(result.issues).toEqual([]);
    expect(result.accepted).toBe(true);
    expect(result.effective.stockDelta).toEqual({ [P]: -2 });
    expect(verdictFromIssues(result.issues)).toBe("pass");
  });

  it("(a) falla si current_stock no cambió lo esperado", () => {
    const result = evaluate({ after: snap({ [P]: 17 }, [movement({ id: "m1", stockAfter: 17 })]) });
    expect(result.issues.filter((i) => i.check === "a")).toHaveLength(1);
    expect(verdictFromIssues(result.issues)).toBe("fail");
  });

  it("(b) y (d) fallan si falta el movimiento (stock sin libro, H9)", () => {
    const result = evaluateOp({
      op: "POST /api/products",
      expect: { http: "accept", stockDelta: { [P]: 7 }, movements: [{ productId: P, type: "inventario_inicial", quantityDelta: 7 }], ref: null },
      status: 201,
      message: "",
      before: snap({}),
      after: snap({ [P]: 7 }),
    });
    expect(result.issues.map((i) => i.check).sort()).toEqual(["b", "d"]);
  });

  it("(c) falla si stock_after no cierra con current_stock", () => {
    const result = evaluate({ after: snap({ [P]: 18 }, [movement({ id: "m1", stockAfter: 19 })]) });
    expect(result.issues.map((i) => i.check)).toEqual(["c"]);
  });

  it("(d) falla con tipo de movimiento o referencia incorrectos", () => {
    const wrongType = evaluate({ after: snap({ [P]: 18 }, [movement({ id: "m1", type: "ajuste_salida" })]) });
    expect(wrongType.issues.map((i) => i.check)).toEqual(["d"]);
    const wrongRef = evaluate({ after: snap({ [P]: 18 }, [movement({ id: "m1", saleId: null, purchaseId: "x" })]) });
    expect(wrongRef.issues.map((i) => i.check)).toEqual(["d", "d"]);
    expect(wrongRef.issues[0]?.message).toContain("sale_id=null");
  });

  it("(e) falla solo cuando la operación cambia el conteo de una vista del caso", () => {
    const broken = { ...emptySnapshot().views, stock_reconciliation: [{ diff: 7 }] };
    const first = evaluate({ after: snap({ [P]: 18 }, [movement({ id: "m1" })], { views: broken }) });
    expect(first.issues.map((i) => i.check)).toEqual(["e"]);
    expect(first.scopedCounts.stock_reconciliation).toBe(1);
    const already = evaluate({
      before: snap({ [P]: 20 }, [], { views: broken }),
      after: snap({ [P]: 18 }, [movement({ id: "m1" })], { views: broken }),
    });
    expect(already.issues).toEqual([]);
  });

  it("(f) rechazo esperado: 4xx con mensaje pasa; 500 sin mover es finding; 500 moviendo es fail", () => {
    const reject: OpExpectation = { ...saleExpect, http: "reject" };
    const same = { before: snap({ [P]: 1 }), after: snap({ [P]: 1 }) };
    expect(evaluate({ expect: reject, status: 400, message: "Stock insuficiente", ...same }).issues).toEqual([]);
    const five = evaluate({ expect: reject, status: 500, message: "INTERNAL_ERROR", ...same });
    expect(verdictFromIssues(five.issues)).toBe("finding");
    const moved = evaluate({ expect: reject, status: 500, message: "x", before: snap({ [P]: 20 }) });
    expect(verdictFromIssues(moved.issues)).toBe("fail");
    const silent = evaluate({ expect: reject, status: 400, message: "", ...same });
    expect(verdictFromIssues(silent.issues)).toBe("finding");
  });

  it("(f) falla si se esperaba rechazo y aceptó, o se esperaba 2xx y rechazó", () => {
    const accepted = evaluate({ expect: { ...saleExpect, http: "reject" } });
    expect(accepted.issues.some((i) => i.check === "f" && i.severity === "fail")).toBe(true);
    expect(accepted.issues.some((i) => i.check === "a")).toBe(true);
    const rejected = evaluate({ status: 400, message: "tasa fuera de rango", after: snap({ [P]: 20 }) });
    expect(rejected.issues.map((i) => i.check)).toEqual(["f", "a", "b", "d"]);
  });

  it("un rechazo no puede dejar venta, compra ni pago", () => {
    const result = evaluate({
      expect: { ...saleExpect, http: "reject" },
      status: 400,
      message: "Stock insuficiente",
      before: snap({ [P]: 1 }),
      after: snap({ [P]: 1 }, [], { docs: { sales: 1, purchases: 0, payments: 1 } }),
    });
    expect(result.issues.map((i) => i.check)).toEqual(["docs", "docs"]);
  });

  it("either: coherente en ambos sentidos y con hallazgo configurable", () => {
    const either: OpExpectation = { ...saleExpect, http: "either", findingIfAccepted: "acepta", findingIfRejected: "rechaza" };
    const accepted = evaluate({ expect: either });
    expect(accepted.issues.map((i) => i.severity)).toEqual(["finding"]);
    expect(accepted.issues[0]?.message).toContain("acepta");
    const rejected = evaluate({ expect: either, status: 400, message: "no", after: snap({ [P]: 20 }) });
    expect(rejected.issues.map((i) => i.severity)).toEqual(["finding"]);
    expect(rejected.effective.stockDelta).toEqual({});
    const plain = evaluate({ expect: { ...saleExpect, http: "either" }, status: 400, message: "no", after: snap({ [P]: 20 }) });
    expect(plain.issues).toEqual([]);
  });

  it("conversión: dos movimientos con el mismo conversion_id", () => {
    const expectConv: OpExpectation = {
      http: "accept",
      stockDelta: { [P]: -2, [U]: 24 },
      movements: [
        { productId: P, type: "conversion_salida", quantityDelta: -2 },
        { productId: U, type: "conversion_entrada", quantityDelta: 24 },
      ],
      ref: { kind: "conversion", id: "c1" },
    };
    const after = snap({ [P]: 18, [U]: 24 }, [
      movement({ id: "m1", type: "conversion_salida", saleId: null, conversionId: "c1" }),
      movement({ id: "m2", productId: U, type: "conversion_entrada", quantityDelta: 24, stockAfter: 24, saleId: null, conversionId: "c1" }),
    ]);
    expect(evaluate({ expect: expectConv, before: snap({ [P]: 20, [U]: 0 }), after }).issues).toEqual([]);
    const half = snap({ [P]: 18, [U]: 0 }, [after.movements[0] as MovementRow]);
    expect(verdictFromIssues(evaluate({ expect: expectConv, before: snap({ [P]: 20, [U]: 0 }), after: half }).issues)).toBe("fail");
  });
});

describe("runCase", () => {
  const base = { id: "iva.sale_paid", title: "Venta", hypothesis: ["H10"] };
  const deps = { suite: "serial", now: () => new Date("2026-10-06T12:00:00Z"), makeHarness: (recorder: CaseRecorder) => recorder };

  it("skip con motivo sin ejecutar nada", async () => {
    const run = jest.fn();
    const result = await runCase<CaseRecorder>({ ...base, skip: "sin par", run }, deps);
    expect(result).toMatchObject({ verdict: "skip", detail: "sin par", suite: "serial", ts: "2026-10-06T12:00:00.000Z" });
    expect(run).not.toHaveBeenCalled();
  });

  it("una excepción del escenario es `error` y no se propaga", async () => {
    const def: CaseDef<CaseRecorder> = { ...base, run: async () => Promise.reject(new Error("BFF caído")) };
    const result = await runCase(def, deps);
    expect(result.verdict).toBe("error");
    expect(result.detail).toContain("BFF caído");
  });

  it("AbortCase conserva el veredicto acumulado; sin incidencias es `error`", async () => {
    const withIssue: CaseDef<CaseRecorder> = {
      ...base,
      run: async (recorder) => {
        recorder.fail("la venta respondió 500");
        throw new AbortCase("no se puede continuar");
      },
    };
    const failed = await runCase(withIssue, deps);
    expect(failed.verdict).toBe("fail");
    expect(failed.detail).toContain("la venta respondió 500");
    expect(failed.detail).toContain("caso interrumpido");
    const bare = await runCase<CaseRecorder>({ ...base, run: async () => Promise.reject(new AbortCase("x")) }, deps);
    expect(bare.verdict).toBe("error");
  });

  it("acumula esperado/real y ordena el detalle fail → finding → notas", async () => {
    const def: CaseDef<CaseRecorder> = {
      ...base,
      run: async (recorder) => {
        const good = evaluate();
        recorder.recordOp({ op: "POST /api/sales", as: "vendedor1", status: 201, response_id: SALE, ms: 5 }, good);
        recorder.note("nota");
        recorder.finding("hallazgo");
        recorder.setGlobal({ stock_reconciliation: 3 });
      },
    };
    const result = await runCase(def, deps);
    expect(result.verdict).toBe("finding");
    expect(result.detail).toBe("hallazgo · nota");
    expect(result.expected).toEqual({ stock_delta: { [P]: -2 }, movements: [{ product_id: P, type: "venta", quantity_delta: -2 }] });
    expect(result.actual.stock_delta).toEqual({ [P]: -2 });
    expect(result.actual.movements[0]).toMatchObject({ id: "m1", sale_id: SALE, stock_after: 18 });
    expect(result.steps[0]).toMatchObject({ status: 201, expected_delta: { [P]: -2 }, actual_delta: { [P]: -2 } });
    expect(Object.keys(result.reconcile_scoped)).toEqual([...INTEGRITY_VIEW_NAMES]);
    expect(result.reconcile_global).toEqual({ stock_reconciliation: 3 });
  });

  it("una operación con incidencias deja el evento reproductor en evidence", () => {
    const recorder = new CaseRecorder();
    const bad = evaluate({ after: snap({ [P]: 17 }, [movement({ id: "m1", stockAfter: 17 })]) });
    const views = { ...emptySnapshot().views, negative_stock: [{ value: -1 }] };
    recorder.recordOp({ op: "POST /api/sales", as: "vendedor1", status: 201, response_id: SALE, ms: 5, payload: { q: 2 } }, bad, views);
    expect(recorder.evidence[0]).toBe('repro: POST /api/sales as vendedor1 payload={"q":2} -> 201');
    expect(recorder.evidence[1]).toBe('negative_stock: [{"value":-1}]');
    expect(recorder.steps[0]?.issues?.[0]).toMatch(/^\[a\/fail\]/);
  });
});

describe("CLI", () => {
  it("parsea suite, run, only, list y out", () => {
    expect(parseScenarioArgs([])).toEqual({ suite: "all", runId: null, only: null, list: false, out: null });
    expect(parseScenarioArgs(["--suite", "serial", "--run", "stk402-smoke", "--only", "a, b,", "--list", "--out", "x"])).toEqual({
      suite: "serial",
      runId: "stk402-smoke",
      only: ["a", "b"],
      list: true,
      out: "x",
    });
  });

  it("rechaza valores inválidos", () => {
    expect(() => parseScenarioArgs(["--suite", "ui"])).toThrow(/--suite/);
    expect(() => parseScenarioArgs(["--run"])).toThrow(/Falta el valor/);
    expect(() => parseScenarioArgs(["--run", "../x"])).toThrow(/--run/);
    expect(() => parseScenarioArgs(["--only", ","])).toThrow(/--only/);
    expect(() => parseScenarioArgs(["--nope"])).toThrow(/desconocido/);
  });

  it("run id por defecto, suites y flags reenviados a las suites externas", () => {
    expect(defaultScenarioRunId(new Date(2026, 9, 6, 7, 5, 9), "serial")).toBe("20261006-070509-serial");
    expect(suitesFor("all")).toEqual(["serial", "oneshots", "hypotheses"]);
    expect(suitesFor("oneshots")).toEqual(["oneshots"]);
    const args = parseScenarioArgs(["--only", "a,b", "--out", "dir"]);
    expect(subSuiteArgs(args, "r1")).toEqual(["--run", "r1", "--only", "a,b", "--out", "dir"]);
    expect(subSuiteArgs({ ...args, list: true }, "r1")).toEqual(["--list", "--only", "a,b"]);
  });

  it("selectCases conserva el orden de la matriz y reporta ids desconocidos", () => {
    const cases = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(selectCases(cases, null)).toEqual({ selected: cases, unknown: [] });
    expect(selectCases(cases, ["c", "x", "a"])).toEqual({ selected: [{ id: "a" }, { id: "c" }], unknown: ["x"] });
  });
});

describe("archivos de resultados", () => {
  const result = new CaseRecorder().build({ id: "iva.sale_paid", title: "Venta | pagada", hypothesis: ["H10"] }, "serial", "2026-10-06T00:00:00.000Z");

  it("resume por veredicto", () => {
    const results = [{ verdict: "pass" as const }, { verdict: "fail" as const }, { verdict: "pass" as const }, { verdict: "skip" as const }];
    expect(summarize(results)).toEqual({ pass: 2, fail: 1, finding: 0, error: 0, skip: 1 });
    expect(formatSummary("serial", results)).toBe("serial: 4 casos · pass=2 fail=1 finding=0 error=0 skip=1");
  });

  it("una línea JSON por caso con las claves del contrato", () => {
    const line = resultToJsonLine(result);
    expect(line.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(line) as object)).toEqual([
      "ts",
      "suite",
      "id",
      "title",
      "hypothesis",
      "steps",
      "expected",
      "actual",
      "reconcile_scoped",
      "reconcile_global",
      "verdict",
      "detail",
      "evidence",
    ]);
  });

  it("el markdown lleva una fila por caso y escapa las barras", () => {
    const failing = { ...result, id: "x.y", verdict: "fail" as const, detail: "a | b\nc", reconcile_scoped: { stock_reconciliation: 1 }, reconcile_global: { stock_reconciliation: 4 } };
    const md = renderMarkdown("serial", "r1", [result, failing]);
    expect(md).toContain("# serial — run r1");
    expect(md).toContain("| iva.sale_paid | pass | H10 |  | 0 |  |");
    expect(md).toContain("| x.y | fail | H10 |  | stock_reconciliation=1 | a \\| b c |");
    expect(md).toContain('{"stock_reconciliation":4}');
  });

  it("SuiteWriter escribe <suite>.jsonl incremental y <suite>.md al cerrar", () => {
    const dir = mkdtempSync(join(tmpdir(), "stk402-"));
    try {
      const writer = new SuiteWriter("serial", "r1", dir);
      writer.add(result);
      expect(readFileSync(writer.jsonlPath, "utf8").trim().split("\n")).toHaveLength(1);
      writer.add({ ...result, id: "b" });
      expect(writer.close()).toHaveLength(2);
      expect(readFileSync(writer.jsonlPath, "utf8").trim().split("\n")).toHaveLength(2);
      expect(readFileSync(writer.mdPath, "utf8")).toContain("serial: 2 casos");
      expect(writer.jsonlPath).toBe(join(dir, "r1", "serial.jsonl"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SQL del oráculo", () => {
  it("consulta las 9 vistas filtradas por productos ($1) y documentos ($2)", () => {
    const sql = scopedViewsSql();
    for (const name of INTEGRITY_VIEW_NAMES) expect(sql).toContain(`from public.${name} v where`);
    expect(sql.split("union all")).toHaveLength(9);
    expect(sql).toContain("v.pack_product_id = any($1::uuid[]) or v.unit_product_id = any($1::uuid[])");
    expect(sql).toContain("v.document_id = any($2::uuid[])");
    expect(sql).not.toMatch(/\$3/);
  });

  it("mapea filas de movimientos y agrupa filas de vistas", () => {
    const rows = mapMovementRows([
      { id: "m1", product_id: P, type: "compra", quantity_delta: 10, stock_after: 30, sale_id: null, purchase_id: "pu", conversion_id: null, created_at: new Date("2026-10-06T01:02:03Z") },
    ]);
    expect(rows).toEqual([
      { id: "m1", productId: P, type: "compra", quantityDelta: 10, stockAfter: 30, saleId: null, purchaseId: "pu", conversionId: null, createdAt: "2026-10-06T01:02:03.000Z" },
    ]);
    const grouped = groupViewRows([
      { view_name: "negative_stock", row: { value: -1 } },
      { view_name: "negative_stock", row: { value: -2 } },
      { view_name: "desconocida", row: {} },
    ]);
    expect(grouped.negative_stock).toHaveLength(2);
    expect(grouped.stock_reconciliation).toEqual([]);
  });
});

describe("CaseHarness.op", () => {
  function fakeSession(snapshots: Snapshot[], response: ApiResponse) {
    const calls: { products: string[]; docs: string[] }[] = [];
    const request = jest.fn<Promise<ApiResponse>, [string, RequestInit?]>().mockResolvedValue(response);
    const oracle = {
      snapshot: async (products: readonly string[], docs: readonly string[]) => {
        calls.push({ products: [...products], docs: [...docs] });
        return snapshots.shift() ?? emptySnapshot();
      },
      globalReport: async () => ({ stock_reconciliation: 2 }),
    } as unknown as Oracle;
    const session = {
      runId: "r1",
      nonce: "n",
      storeId: "s",
      oracle,
      clients: { vendedor1: { request } as unknown as ApiClient },
      userIds: {},
      close: async () => undefined,
    } as LabSession;
    return { session, calls, request };
  }

  it("fotografía antes y después, resuelve la referencia desde la respuesta y registra el paso", async () => {
    const { session, calls, request } = fakeSession(
      [snap({ [P]: 20 }), snap({ [P]: 18 }, [movement({ id: "m1" })])],
      { ok: true, status: 201, body: { data: { id: SALE, status: "pagada" } } },
    );
    const recorder = new CaseRecorder();
    const harness = new CaseHarness(session, recorder, "iva.sale_paid");
    harness.track(P);
    const result = await harness.op({
      as: "vendedor1",
      method: "POST",
      path: "/api/sales",
      body: { items: [] },
      label: "venta",
      expect: {
        http: "accept",
        stockDelta: { [P]: -2 },
        movements: () => [{ productId: P, type: "venta", quantityDelta: -2 }],
        ref: (data) => ({ kind: "sale", id: String(data?.id) }),
      },
      newDocs: (data) => [String(data?.id)],
    });
    expect(result.accepted).toBe(true);
    expect(result.id).toBe(SALE);
    expect(result.evaluation.issues).toEqual([]);
    expect(request).toHaveBeenCalledWith("/api/sales", { method: "POST", body: '{"items":[]}' });
    expect(calls).toEqual([
      { products: [P], docs: [] },
      { products: [P], docs: [SALE] },
    ]);
    expect(recorder.steps[0]).toMatchObject({ op: "POST /api/sales", as: "vendedor1", status: 201, response_id: SALE, label: "venta" });
    expect(recorder.build({ id: "x", title: "", hypothesis: [] }, "serial", "t").reconcile_global).toEqual({ stock_reconciliation: 2 });
  });

  it("un rechazo esperado guarda el mensaje y `need` corta el caso", async () => {
    const { session } = fakeSession([snap({ [P]: 1 }), snap({ [P]: 1 })], {
      ok: false,
      status: 400,
      body: { error: { code: "BAD_REQUEST", message: "Stock insuficiente" } },
    });
    const recorder = new CaseRecorder();
    const harness = new CaseHarness(session, recorder, "c");
    harness.track(P);
    const result = await harness.op({
      as: "vendedor1",
      method: "POST",
      path: "/api/sales",
      expect: { http: "reject", stockDelta: { [P]: -2 }, movements: [], ref: null },
    });
    expect(result.evaluation.issues).toEqual([]);
    expect(recorder.steps[0]?.error).toBe("BAD_REQUEST Stock insuficiente");
    expect(() => harness.need(result, "la venta")).toThrow(AbortCase);
    expect(() => harness.client("admin")).toThrow(/rol admin/);
  });
});
