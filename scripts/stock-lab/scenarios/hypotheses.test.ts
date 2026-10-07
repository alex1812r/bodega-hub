/**
 * @jest-environment node
 *
 * Lógica pura de la suite `hypotheses` y de la base compartida `db.ts`
 * (STK-403). Sin red ni base.
 */
import {
  Checks,
  aggregateHypotheses,
  analyzeChain,
  buildPurchaseBody,
  buildResult,
  buildSaleBody,
  countVerdicts,
  defaultHypothesisVerdict,
  defaultRunId,
  formatCounts,
  parseSuiteArgs,
  purchaseLineUnits,
  renderMarkdown,
  runTag,
  selectCases,
  type CaseResult,
  type ChainMove,
} from "./db";
import { HYPOTHESIS_CASES, STOCK_RPCS, d0Problems, restRowCount, sumDelta, summarizeStatuses, type D0FunctionRow } from "./hypotheses";

const move = (id: string, quantity_delta: number, stock_after: number): ChainMove => ({ id, quantity_delta, stock_after });

describe("catálogo de casos de hipótesis", () => {
  const ids = HYPOTHESIS_CASES.map((c) => c.id);

  it("tiene ids únicos con prefijo hNN.", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^h(0[1-9]|1[0-2])\.[a-z0-9_]+$/);
  });

  it("cubre H1..H12 con al menos un caso cuyo id y etiqueta coinciden", () => {
    for (let n = 1; n <= 12; n += 1) {
      const prefix = `h${String(n).padStart(2, "0")}.`;
      const cases = HYPOTHESIS_CASES.filter((c) => c.id.startsWith(prefix));
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) expect(c.hypothesis).toContain(`H${n}`);
    }
  });

  it("incluye los escenarios obligatorios del ticket", () => {
    const required = [
      "h03.d1_store_isolation",
      "h03.moved_product_ops",
      "h03.dg6_reversal_out_of_store",
      "h04.dg3_return_with_live_payments",
      "h06.concurrent_sales",
      "h06.dg7_deadlock",
      "h07.no_trigger",
      "h07.direct_update_postgres",
      "h07.dg1_direct_update_postgrest",
      "h07.movement_without_stock",
      "h07.oneshot_pattern",
      "h07.dg9_interleaved_transactions",
      "h07.dg9_repeated_line",
      "h08.same_client_request_id",
      "h08.no_client_request_id",
      "h08.dg4_two_step_fallback",
      "h08.dg5_double_submit",
      "h09.create_product_with_stock",
      "h09.import_payload",
      "h11.receive_twice",
      "h12.d0_catalog",
      "h12.rpc_rowcounts",
      "h12.dg2_inactive_user",
      "h02.dg8_units_per_pack_unchecked",
    ];
    for (const id of required) expect(ids).toContain(id);
  });
});

describe("parseSuiteArgs / selectCases", () => {
  const now = new Date(2026, 9, 6, 7, 5, 9);

  it("usa YYYYMMDD-HHmmss-<suite> como run por defecto", () => {
    expect(defaultRunId("hypotheses", now)).toBe("20261006-070509-hypotheses");
    expect(parseSuiteArgs([], "oneshots", now)).toEqual({ run: "20261006-070509-oneshots", only: null, list: false, out: null });
  });

  it("lee --run, --only, --list y --out", () => {
    expect(parseSuiteArgs(["--run", "stk403-smoke", "--only", "h01.a, h07.b", "--list", "--out", "x/runs"], "hypotheses", now)).toEqual({
      run: "stk403-smoke",
      only: ["h01.a", "h07.b"],
      list: true,
      out: "x/runs",
    });
  });

  it("rechaza flags desconocidos, valores ausentes y runs con caracteres de ruta", () => {
    expect(() => parseSuiteArgs(["--nope"], "hypotheses", now)).toThrow("Flag desconocido");
    expect(() => parseSuiteArgs(["--run"], "hypotheses", now)).toThrow("Falta el valor");
    expect(() => parseSuiteArgs(["--run", "--list"], "hypotheses", now)).toThrow("Falta el valor");
    expect(() => parseSuiteArgs(["--run", "../x"], "hypotheses", now)).toThrow("--run inválido");
  });

  it("selecciona por id exacto o por prefijo de segmento", () => {
    const cases = [{ id: "os.20260830.symptom" }, { id: "os.20260830b_add.fix_by_api" }, { id: "h01.x" }];
    expect(selectCases(cases, null)).toHaveLength(3);
    expect(selectCases(cases, ["os.20260830"]).map((c) => c.id)).toEqual(["os.20260830.symptom"]);
    expect(selectCases(cases, ["h01.x", "os.20260830b_add"]).map((c) => c.id)).toEqual(["os.20260830b_add.fix_by_api", "h01.x"]);
    expect(selectCases(cases, ["nope"])).toEqual([]);
  });

  it("deriva un sufijo de SKU en minúsculas y sin símbolos", () => {
    expect(runTag("STK403-Smoke_1", "Ab-12cdEFG")).toBe("k403smoke1ab12cd");
  });
});

describe("Checks", () => {
  it("pass sin fallos; finding con solo blandos; fail si hay alguno duro", () => {
    const c = new Checks();
    expect(c.eq("a", { x: 1 }, { x: 1 })).toBe(true);
    expect(c.verdict()).toBe("pass");
    c.finding("código HTTP", false, "500 en vez de 409");
    expect(c.verdict()).toBe("finding");
    expect(c.eq("stock", 4, 5)).toBe(false);
    expect(c.verdict()).toBe("fail");
    expect(c.detail()).toBe("stock: esperado 5, obtenido 4 | código HTTP: 500 en vez de 409");
  });

  it("rejected: 2xx es fallo, 5xx hallazgo, 4xx correcto", () => {
    const ok = new Checks();
    expect(ok.rejected("op", 409)).toBe(true);
    expect(ok.verdict()).toBe("pass");
    const soft = new Checks();
    expect(soft.rejected("op", 500, "deadlock detected")).toBe(true);
    expect(soft.verdict()).toBe("finding");
    expect(soft.detail()).toContain('500 "deadlock detected" en vez de 4xx');
    const hard = new Checks();
    expect(hard.rejected("op", 201)).toBe(false);
    expect(hard.verdict()).toBe("fail");
  });

  it("las notas van al detalle sin cambiar el veredicto", () => {
    const c = new Checks();
    c.note("contexto");
    expect(c.verdict()).toBe("pass");
    expect(c.detail()).toBe("contexto");
  });
});

describe("veredicto por hipótesis", () => {
  it("fail confirma, pass/finding descartan, error/skip no prueban nada", () => {
    expect(defaultHypothesisVerdict("fail")).toBe("confirmada");
    expect(defaultHypothesisVerdict("pass")).toBe("descartada");
    expect(defaultHypothesisVerdict("finding")).toBe("descartada");
    expect(defaultHypothesisVerdict("error")).toBe("no_reproducible");
    expect(defaultHypothesisVerdict("skip")).toBe("no_reproducible");
  });

  it("agrega: confirmada gana, luego descartada, luego no_reproducible", () => {
    expect(
      aggregateHypotheses([
        { hypothesis: ["H7"], hypothesis_verdict: "descartada" },
        { hypothesis: ["H7", "H9"], hypothesis_verdict: "confirmada" },
        { hypothesis: ["H3"], hypothesis_verdict: "no_reproducible" },
        { hypothesis: ["H3"], hypothesis_verdict: "descartada" },
        { hypothesis: ["H1"], hypothesis_verdict: "no_reproducible" },
        { hypothesis: [], hypothesis_verdict: "confirmada" },
      ]),
    ).toEqual({ H7: "confirmada", H9: "confirmada", H3: "descartada", H1: "no_reproducible" });
  });

  it("buildResult respeta el hypothesis_verdict explícito y deriva el resto", () => {
    const def = { id: "h02.dg8", title: "t", hypothesis: ["H2"] };
    const base = { detail: "d", expected: 1, actual: 2, evidence: ["e"] };
    const now = new Date("2026-10-06T10:00:00.000Z");
    const explicit = buildResult("hypotheses", def, [], { ...base, verdict: "fail", hypothesis_verdict: "descartada" }, {}, {}, now);
    expect(explicit).toMatchObject({ ts: "2026-10-06T10:00:00.000Z", suite: "hypotheses", id: "h02.dg8", verdict: "fail", hypothesis_verdict: "descartada" });
    expect(buildResult("hypotheses", def, [], { ...base, verdict: "fail" }, {}, {}, now).hypothesis_verdict).toBe("confirmada");
  });

  it("cuenta veredictos y renderiza el markdown con la tabla por hipótesis ordenada", () => {
    const result = (id: string, hypothesis: string[], verdict: CaseResult["verdict"], detail = ""): CaseResult => ({
      ts: "t",
      suite: "hypotheses",
      id,
      title: id,
      hypothesis,
      steps: [],
      expected: null,
      actual: null,
      reconcile_scoped: { stock_reconciliation: 1, stock_chain_breaks: 0 },
      reconcile_global: {},
      verdict,
      hypothesis_verdict: defaultHypothesisVerdict(verdict),
      detail,
      evidence: [],
    });
    const results = [result("h10.a", ["H10"], "pass"), result("h02.a", ["H2"], "fail", "a | b"), result("h02.b", ["H2"], "skip")];
    expect(countVerdicts(results)).toEqual({ pass: 1, fail: 1, finding: 0, error: 0, skip: 1 });
    expect(formatCounts(countVerdicts(results))).toBe("pass=1 fail=1 finding=0 error=0 skip=1");
    const md = renderMarkdown("hypotheses", "r1", results);
    expect(md).toContain("# hypotheses · run r1");
    expect(md.indexOf("| H2 | confirmada | h02.a:fail, h02.b:skip |")).toBeGreaterThan(0);
    expect(md.indexOf("| H2 |")).toBeLessThan(md.indexOf("| H10 |"));
    expect(md).toContain("| h02.a | H2 | fail | confirmada | stock_reconciliation=1 | a \\| b |");
  });
});

describe("analyzeChain", () => {
  it("cadena en orden: sana", () => {
    const chain = analyzeChain([move("a", 10, 10), move("b", -2, 8), move("c", 3, 11)], 11);
    expect(chain).toEqual({ orderBreaks: 0, ledger: 11, reorderable: true, endsAtCurrentStock: true, classification: "sana" });
  });

  it("dos transacciones con created_at invertido respecto al commit: artefacto de orden", () => {
    // Orden real: +10 → 10, venta −1 → 9, venta −2 → 7. La vista ve la venta −2 antes.
    const chain = analyzeChain([move("ini", 10, 10), move("s1", -2, 7), move("s2", -1, 9)], 7);
    expect(chain.orderBreaks).toBe(2);
    expect(chain.reorderable).toBe(true);
    expect(chain.endsAtCurrentStock).toBe(true);
    expect(chain.classification).toBe("artefacto_orden");
  });

  it("dos líneas del mismo producto en un documento, desempate por id al revés: artefacto de orden", () => {
    const chain = analyzeChain([move("ini", 30, 30), move("l2", -2, 27), move("l1", -1, 29)], 27);
    expect(chain.classification).toBe("artefacto_orden");
  });

  it("decremento perdido (dos ventas leen 5 y escriben 4): rotura real", () => {
    const chain = analyzeChain([move("ini", 5, 5), move("a", -1, 4), move("b", -1, 4)], 4);
    expect(chain.orderBreaks).toBe(1);
    expect(chain.reorderable).toBe(false);
    expect(chain.classification).toBe("rotura_real");
  });

  it("escritura directa de current_stock seguida de un movimiento: rotura real", () => {
    const chain = analyzeChain([move("ini", 10, 10), move("adj", 1, 18)], 18);
    expect(chain.reorderable).toBe(false);
    expect(chain.classification).toBe("rotura_real");
  });

  it("cadena limpia pero current_stock distinto del último stock_after: rotura real", () => {
    const chain = analyzeChain([move("ini", 10, 10), move("a", -1, 9)], 17);
    expect(chain.orderBreaks).toBe(0);
    expect(chain.classification).toBe("rotura_real");
  });

  it("reordenable pero termina en otro stock: rotura real", () => {
    const chain = analyzeChain([move("ini", 10, 10), move("s1", -2, 7), move("s2", -1, 9)], 9);
    expect(chain.reorderable).toBe(true);
    expect(chain.endsAtCurrentStock).toBe(false);
    expect(chain.classification).toBe("rotura_real");
  });

  it("circuito (vuelve al stock de partida) desordenado: artefacto de orden", () => {
    // Producto creado con stock 5 sin movimiento: −2 → 3, +2 → 5, visto al revés.
    const chain = analyzeChain([move("back", 2, 5), move("sale", -2, 3)], 5);
    // Dos movimientos: la vista no ve salto (el primero no se evalúa) pero el último stock_after no es current_stock.
    expect(chain.orderBreaks).toBe(0);
    expect(chain.classification).toBe("artefacto_orden");
  });

  it("sin movimientos: sana", () => {
    expect(analyzeChain([], 0).classification).toBe("sana");
  });
});

describe("payloads", () => {
  it("venta: precio 1 por defecto, pago efectivo_usd por el total y clave solo si se pasa", () => {
    const body = buildSaleBody(
      [
        { productId: "a", quantity: 2 },
        { productId: "b", quantity: 1, unitPriceRef: 2.5 },
      ],
      { customerId: "c", exchangeRateId: "r", rateVes: 52, payments: true, clientRequestId: "k" },
    );
    expect(body).toMatchObject({
      customerId: "c",
      exchangeRateId: "r",
      refRateVes: 52,
      clientRequestId: "k",
      taxRef: 0,
      discountRef: 0,
      items: [
        { productId: "a", quantity: 2, unitPriceRef: 1 },
        { productId: "b", quantity: 1, unitPriceRef: 2.5 },
      ],
      payments: [{ method: "efectivo_usd", currency: "USD", amount: 4.5 }],
    });
    const bare = buildSaleBody([{ productId: "a", quantity: 1 }], { customerId: "c", exchangeRateId: null, rateVes: 52, clientRequestId: null });
    expect(bare).not.toHaveProperty("clientRequestId");
    expect(bare).not.toHaveProperty("payments");
    expect(bare).not.toHaveProperty("exchangeRateId");
  });

  it("compra: totales coherentes en modo unidad y empaque", () => {
    const body = buildPurchaseBody(
      [
        { productId: "u", quantity: 5 },
        { productId: "p", packCount: 3, unitsPerPack: 12 },
      ],
      { supplierId: "s", status: "recibido", exchangeRateId: "r", rateVes: 50 },
    );
    expect(body).toMatchObject({ supplierId: "s", status: "recibido", subtotalRef: 41, subtotalVes: 2050, taxRef: 0, discountVes: 0 });
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ entryMode: "unit", productId: "u", quantity: 5, unitCostRef: 1, unitCostVes: 50, subtotalRef: 5, subtotalVes: 250 });
    expect(items[1]).toMatchObject({ entryMode: "pack", productId: "p", packCount: 3, unitsPerPack: 12, packCostRef: 12, packCostVes: 600, subtotalRef: 36 });
    expect(items[1]).not.toHaveProperty("quantity");
  });

  it("compra en modo empaque: las unidades esperadas son pack_count × units_per_pack aunque llegue un quantity contradictorio", () => {
    expect(purchaseLineUnits({ productId: "p", packCount: 2, unitsPerPack: 6, quantity: 99 })).toBe(12);
    expect(purchaseLineUnits({ productId: "p", quantity: 7 })).toBe(7);
    const body = buildPurchaseBody([{ productId: "p", packCount: 2, unitsPerPack: 6, quantity: 99 }], {
      supplierId: "s",
      status: "pedido",
      exchangeRateId: null,
      rateVes: 50,
    });
    expect((body.items as Array<Record<string, unknown>>)[0]).toMatchObject({ quantity: 99, subtotalRef: 12 });
  });
});

describe("helpers de hypotheses.ts", () => {
  it("summarizeStatuses separa 2xx, 4xx y 5xx", () => {
    expect(summarizeStatuses([201, 200, 400, 409, 500])).toEqual({ ok: 2, rejected4xx: 2, errors5xx: 1, statuses: [201, 200, 400, 409, 500] });
  });

  it("sumDelta suma por tipo", () => {
    const moves = [
      { type: "venta", quantity_delta: -2 },
      { type: "venta", quantity_delta: -1 },
      { type: "ajuste_entrada", quantity_delta: 2 },
    ];
    expect(sumDelta(moves, "venta")).toBe(-3);
    expect(sumDelta(moves)).toBe(-1);
  });

  it("restRowCount cuenta filas de la representación", () => {
    expect(restRowCount({ data: [{ id: 1 }], error: null, status: 200 })).toBe(1);
    expect(restRowCount({ data: null, error: { message: "x" }, status: 403 })).toBe(0);
  });

  describe("d0Problems", () => {
    const healthy = (proname: string): D0FunctionRow => ({
      proname,
      owner: "postgres",
      prosecdef: true,
      proconfig: ["search_path=public"],
      rolbypassrls: true,
      rolsuper: true,
    });

    it("sin problemas cuando las 12 RPC cumplen", () => {
      expect(d0Problems(STOCK_RPCS.map(healthy), ["postgres"])).toEqual([]);
    });

    it("detecta ausencia, sobrecarga, falta de definer, search_path y dueño sin bypass", () => {
      const rows = STOCK_RPCS.filter((name) => name !== "return_sale").map(healthy);
      rows.push(healthy("create_sale"));
      rows.push({ ...healthy("x"), proname: "adjust_stock", prosecdef: false, proconfig: null, owner: "app", rolbypassrls: false, rolsuper: false });
      const problems = d0Problems(rows, ["postgres"]);
      expect(problems).toContain("return_sale: no existe");
      expect(problems).toContain("create_sale: 2 sobrecargas vivas");
      expect(problems).toContain("adjust_stock: no es security definer");
      expect(problems).toContain("adjust_stock: search_path no fijado a public");
      expect(problems).toContain("adjust_stock: su dueño (app) no es el de las tablas ni tiene bypassrls");
    });

    it("acepta un dueño sin bypass si es el dueño de todas las tablas", () => {
      const rows = STOCK_RPCS.map((name) => ({ ...healthy(name), owner: "app", rolbypassrls: false, rolsuper: false }));
      expect(d0Problems(rows, ["app", "app"])).toEqual([]);
      expect(d0Problems(rows, ["app", "postgres"]).length).toBe(STOCK_RPCS.length);
    });
  });
});
