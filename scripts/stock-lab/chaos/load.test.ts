/** @jest-environment node */
import { buildReportFromCounts } from "../integrity-views";
import { emptyScoped } from "./cases";
import {
  DEFAULT_MIX,
  type LoadReport,
  OP_KINDS,
  type Sample,
  allocateOps,
  buildSchedule,
  judgeLoad,
  parseLoadArgs,
  parseMix,
  percentile,
  renderLoadMarkdown,
  statsOf,
  summarize,
  topErrors,
} from "./load";

describe("percentile (nearest-rank)", () => {
  it("vacío → 0; un valor → ese valor", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("1..100: p50=50, p95=95, p99=99, p100=100", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile(values, 100)).toBe(100);
    expect(percentile(values, 0)).toBe(1);
  });

  it("no exige entrada ordenada ni la muta", () => {
    const values = [300, 100, 200, 1000, 150];
    expect(percentile(values, 50)).toBe(200);
    expect(percentile(values, 95)).toBe(1000);
    expect(percentile(values, 80)).toBe(300);
    expect(values).toEqual([300, 100, 200, 1000, 150]);
  });

  it("acota p fuera de rango", () => {
    expect(percentile([1, 2, 3], 150)).toBe(3);
    expect(percentile([1, 2, 3], -5)).toBe(1);
  });
});

describe("statsOf / summarize", () => {
  const samples: Sample[] = [
    { op: "create_sale", status: 201, ms: 100 },
    { op: "create_sale", status: 201, ms: 200 },
    { op: "create_sale", status: 400, ms: 50, error: "BAD_REQUEST stock" },
    { op: "create_sale", status: 500, ms: 900, error: "INTERNAL_ERROR deadlock detected" },
    { op: "adjust", status: 201, ms: 80 },
    { op: "adjust", status: 0, ms: 10, error: "fetch failed" },
  ];

  it("cuenta 2xx/4xx/5xx (sin respuesta cuenta como 5xx) y calcula percentiles", () => {
    const stats = statsOf(samples.filter((s) => s.op === "create_sale"), 2000);
    expect(stats).toEqual({ n: 4, s2xx: 2, s4xx: 1, s5xx: 1, p50: 100, p95: 900, p99: 900, max: 900, mean: 312.5, throughput: 2 });
  });

  it("agrupa por operación en orden de aparición y totaliza", () => {
    const summary = summarize(samples, 3000);
    expect(Object.keys(summary.byOp)).toEqual(["create_sale", "adjust"]);
    expect(summary.byOp.adjust).toMatchObject({ n: 2, s2xx: 1, s4xx: 0, s5xx: 1, max: 80 });
    expect(summary.total).toMatchObject({ n: 6, s2xx: 3, s4xx: 1, s5xx: 2, throughput: 2 });
  });

  it("sin muestras: todo en 0", () => {
    expect(statsOf([], 1000)).toEqual({ n: 0, s2xx: 0, s4xx: 0, s5xx: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0, throughput: 0 });
    expect(statsOf([{ op: "x", status: 200, ms: 1 }], 0).throughput).toBe(0);
  });
});

describe("topErrors", () => {
  it("agrupa por operación, código y mensaje normalizando uuids y números de documento", () => {
    const errors = topErrors([
      { op: "create_sale", status: 201, ms: 1 },
      { op: "create_sale", status: 404, ms: 1, error: "NOT_FOUND Producto no encontrado: 069fce35-56cc-493d-ad87-b9732148b582" },
      { op: "create_sale", status: 404, ms: 1, error: "NOT_FOUND Producto no encontrado: 15737ca7-6548-411e-ad7f-126aa5579f46" },
      { op: "cancel_sale", status: 400, ms: 1, error: "BAD_REQUEST La venta V-20261006041334548 tiene pagos" },
      { op: "cancel_sale", status: 400, ms: 1, error: "BAD_REQUEST La venta V-20261006041400624 tiene pagos" },
      { op: "cancel_sale", status: 400, ms: 1, error: "BAD_REQUEST La venta V-20261006041400999 tiene pagos" },
      { op: "receive", status: 500, ms: 1 },
    ]);
    expect(errors).toEqual([
      { op: "cancel_sale", status: 400, message: "BAD_REQUEST La venta V-<n> tiene pagos", count: 3 },
      { op: "create_sale", status: 404, message: "NOT_FOUND Producto no encontrado: <uuid>", count: 2 },
      { op: "receive", status: 500, message: "", count: 1 },
    ]);
  });

  it("respeta el límite", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ op: `op${i}`, status: 500, ms: 1, error: "x" }));
    expect(topErrors(many, 2)).toHaveLength(2);
  });
});

describe("mezcla y planificación", () => {
  it("la mezcla por defecto suma 100 y es mayoría de ventas con pago", () => {
    expect(OP_KINDS.reduce((sum, kind) => sum + DEFAULT_MIX[kind], 0)).toBe(100);
    expect(DEFAULT_MIX.create_sale).toBeGreaterThan(50);
  });

  it("parseMix deja en 0 lo no nombrado y valida", () => {
    const mix = parseMix("create_sale=70, adjust=30");
    expect(mix.create_sale).toBe(70);
    expect(mix.adjust).toBe(30);
    expect(mix.purchase).toBe(0);
    expect(() => parseMix("venta=1")).toThrow(/desconocida/);
    expect(() => parseMix("create_sale=-1")).toThrow(/inválido/);
    expect(() => parseMix("create_sale=0")).toThrow(/todos los pesos/);
  });

  it("allocateOps reparte exactamente `ops` según los pesos", () => {
    const counts = allocateOps(1000, DEFAULT_MIX);
    expect(counts).toEqual({ create_sale: 620, sale_pending: 60, cancel_sale: 50, return_sale: 50, purchase: 80, purchase_order: 40, receive: 40, adjust: 60 });
    const small = allocateOps(7, DEFAULT_MIX);
    expect(OP_KINDS.reduce((sum, kind) => sum + small[kind], 0)).toBe(7);
    expect(small.create_sale).toBeGreaterThanOrEqual(4);
  });

  it("buildSchedule es determinista por semilla y respeta el reparto", () => {
    const a = buildSchedule(50, DEFAULT_MIX, 411);
    const b = buildSchedule(50, DEFAULT_MIX, 411);
    const c = buildSchedule(50, DEFAULT_MIX, 412);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(50);
    expect(a.filter((k) => k === "create_sale")).toHaveLength(31);
    expect([...a].sort()).toEqual([...c].sort());
  });

  it("parseLoadArgs: defaults del plan (1000 ops en 120 s) y overrides", () => {
    expect(parseLoadArgs([])).toMatchObject({ ops: 1000, seconds: 120, concurrency: 16, seed: 411, runId: null, out: null });
    const args = parseLoadArgs(["--ops", "50", "--seconds", "10", "--concurrency", "4", "--mix", "create_sale=1", "--run", "r1", "--out", "d", "--seed", "7"]);
    expect(args).toMatchObject({ ops: 50, seconds: 10, concurrency: 4, runId: "r1", out: "d", seed: 7 });
    expect(args.mix.create_sale).toBe(1);
    expect(args.mix.adjust).toBe(0);
  });

  it("parseLoadArgs rechaza valores inválidos", () => {
    expect(() => parseLoadArgs(["--ops", "0"])).toThrow(/--ops/);
    expect(() => parseLoadArgs(["--seconds", "x"])).toThrow(/--seconds/);
    expect(() => parseLoadArgs(["--ops"])).toThrow(/Falta el valor/);
    expect(() => parseLoadArgs(["--foo"])).toThrow(/desconocido/);
    expect(() => parseLoadArgs(["--run", "a/b"])).toThrow(/--run/);
  });
});

describe("judgeLoad (9.13)", () => {
  const zero = buildReportFromCounts({});
  const sale = statsOf([{ op: "create_sale", status: 201, ms: 120 }, { op: "create_sale", status: 201, ms: 340 }], 1000);

  it("pass con reconcile en 0 y documenta el p95 de create_sale", () => {
    const j = judgeLoad(emptyScoped(), emptyScoped(), zero, zero, sale);
    expect(j.verdict).toBe("pass");
    expect(j.detail).toContain("p95 de create_sale = 340 ms");
  });

  it("fail si los productos propios o los calientes no cuadran", () => {
    const own = emptyScoped();
    own.stock_reconciliation = 2;
    expect(judgeLoad(own, emptyScoped(), zero, zero, sale).detail).toContain("propios stock_reconciliation=2");
    const hot = emptyScoped();
    hot.chain_inconsistent = 1;
    const j = judgeLoad(emptyScoped(), hot, zero, zero, sale);
    expect(j.verdict).toBe("fail");
    expect(j.detail).toContain("calientes chain_inconsistent=1");
  });

  it("stock_chain_breaks de la vista (G9) no hace fallar; el global que crece fuera se documenta", () => {
    const own = emptyScoped();
    own.stock_chain_breaks = 4;
    const after = buildReportFromCounts({ stock_chain_breaks: 9, stock_reconciliation: 1 });
    const j = judgeLoad(own, emptyScoped(), zero, after, sale);
    expect(j.verdict).toBe("pass");
    expect(j.detail).toContain("stock_reconciliation +1");
    expect(j.detail).toContain("stock_chain_breaks +9");
  });

  it("error si no hubo ventas", () => {
    expect(judgeLoad(emptyScoped(), emptyScoped(), zero, zero, undefined).verdict).toBe("error");
  });
});

describe("renderLoadMarkdown", () => {
  it("incluye veredicto, tabla por operación, errores y reconcile", () => {
    const samples: Sample[] = [
      { op: "create_sale", status: 201, ms: 100 },
      { op: "create_sale", status: 409, ms: 90, error: "CONFLICT El recurso ya existe." },
    ];
    const report: LoadReport = {
      runId: "r1",
      suite: "load",
      id: "9.13",
      title: "t",
      severity: "Media",
      expected: "e",
      startedAt: "2026-10-06T00:00:00.000Z",
      args: { ops: 2, seconds: 1, concurrency: 2, mix: DEFAULT_MIX, seed: 1 },
      elapsedMs: 1000,
      throughput: 2,
      scheduleLagMs: { p50: 0, p95: 1, max: 2 },
      summary: summarize(samples, 1000),
      errors: topErrors(samples),
      products: { own: 24, hot: 5, ownSkuPrefix: "C411-r1-x-load-" },
      reconcile_scoped: emptyScoped(),
      reconcile_scoped_hot: emptyScoped(),
      reconcile_global_before: buildReportFromCounts({}),
      reconcile_global: buildReportFromCounts({ stock_chain_breaks: 3 }),
      verdict: "pass",
      detail: "ok",
    };
    const md = renderLoadMarkdown(report);
    expect(md).toContain("Veredicto: **pass** — ok");
    expect(md).toContain("| create_sale | 2 | 1 | 1 | 0 | 90 | 100 | 100 | 100 | 2 |");
    expect(md).toContain("| create_sale | 409 | 1 | CONFLICT El recurso ya existe. |");
    expect(md).toContain("| stock_chain_breaks | 0 | 0 | 0 | 3 |");
    expect(md).toContain("chain_inconsistent (chequeo exacto)");
  });
});
