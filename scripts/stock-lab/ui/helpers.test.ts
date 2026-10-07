/** @jest-environment node */
import {
  IMPORT_HEADERS,
  MD_HEADER,
  UI_USAGE,
  adjustmentTypeProblems,
  buildImportRows,
  buildImportSheetAoa,
  countVerdicts,
  defaultRunId,
  diffNumberMaps,
  diffSnapshots,
  flowCoverageProblems,
  flowId,
  flowOfCase,
  flowsMarkdown,
  formatVerdictSummary,
  isUnknownOutcomeNotice,
  judgeLostResponse,
  judgeRejectionMessage,
  judgeUiVsDb,
  packUnits,
  parseEsNumber,
  parseOnly,
  parseStockInt,
  parseUiArgs,
  shotFileName,
  sumMovements,
  sumSaleItems,
  summarizeFlows,
  summarizeSalePosts,
  toMarkdownRow,
  worstVerdict,
  type DbSnapshot,
  type LostResponseInput,
  type MovementRow,
  type PosView,
  type RejectionMessageInput,
  type UiResult,
} from "./helpers";

function movement(partial: Partial<MovementRow> & Pick<MovementRow, "id" | "product_id">): MovementRow {
  return {
    type: "venta",
    quantity_delta: -1,
    stock_after: 0,
    sale_id: null,
    purchase_id: null,
    conversion_id: null,
    ...partial,
  };
}

function emptySnapshot(): DbSnapshot {
  return { stock: {}, movements: [], sales: [], saleItems: [], payments: [], purchases: [] };
}

describe("parseEsNumber", () => {
  it.each([
    ["Bs. 1.437,76", 1437.76],
    ["Bs.S 2.614,11", 2614.11],
    ["ref 2.75", 2.75],
    ["ref 36.00", 36],
    ["45 un", 45],
    ["+36", 36],
    ["-3", -3],
    ["−2", -2],
    ["- 4", -4],
    ["1.000", 1000],
    ["12.345.678", 12345678],
    ["1,5", 1.5],
    ["1,234,567", 1234567],
    ["1,234.50", 1234.5],
    ["Stock: 17", 17],
    ["0", 0],
    ["50 unidades.", 50],
  ])("%s → %s", (text, expected) => {
    expect(parseEsNumber(text)).toBe(expected);
  });

  it("devuelve null sin número", () => {
    expect(parseEsNumber("—")).toBeNull();
    expect(parseEsNumber("")).toBeNull();
    expect(parseEsNumber(null)).toBeNull();
    expect(parseEsNumber(undefined)).toBeNull();
  });

  it("no confunde un guion separador con el signo", () => {
    expect(parseEsNumber("lab-pack 12")).toBe(12);
  });
});

describe("parseStockInt", () => {
  it("acepta enteros con signo y rechaza decimales", () => {
    expect(parseStockInt("+24")).toBe(24);
    expect(parseStockInt("−2")).toBe(-2);
    expect(parseStockInt("1.000")).toBe(1000);
    expect(parseStockInt("2,5")).toBeNull();
    expect(parseStockInt("—")).toBeNull();
  });
});

describe("argumentos", () => {
  const now = new Date(2026, 9, 6, 4, 5, 9);

  it("genera el run id por defecto YYYYMMDD-HHmmss-ui", () => {
    expect(defaultRunId(now)).toBe("20261006-040509-ui");
    expect(parseUiArgs([], now)).toEqual({
      run: "20261006-040509-ui",
      only: null,
      headed: false,
      list: false,
      help: false,
      out: null,
      shots: null,
      seller: "vendedor1",
    });
  });

  it("--help y -h piden la ayuda, que nombra todos los flags", () => {
    expect(parseUiArgs(["--help"], now).help).toBe(true);
    expect(parseUiArgs(["-h"], now).help).toBe(true);
    for (const flag of ["--run", "--only", "--headed", "--list", "--seller", "--out", "--shots", "--help"]) {
      expect(UI_USAGE).toContain(flag);
    }
  });

  it("lee --run, --only, --headed, --list, --seller, --out y --shots", () => {
    const args = parseUiArgs(
      ["--run", "stk404-smoke", "--only", "1,2,5", "--headed", "--list", "--seller", "vendedor2", "--out", "o", "--shots", "s"],
      now,
    );
    expect(args).toEqual({
      run: "stk404-smoke",
      only: [1, 2, 5],
      headed: true,
      list: true,
      help: false,
      out: "o",
      shots: "s",
      seller: "vendedor2",
    });
  });

  it("parseOnly normaliza, ordena y quita duplicados", () => {
    expect(parseOnly("5, f02,10,2,F01")).toEqual([1, 2, 5, 10]);
  });

  it.each(["0", "11", "abc", "1,,x", ""])("parseOnly rechaza %p", (value) => {
    expect(() => parseOnly(value)).toThrow(/--only/);
  });

  it("rechaza argumentos desconocidos, valores ausentes y run ids peligrosos", () => {
    expect(() => parseUiArgs(["--nope"], now)).toThrow(/desconocido/);
    expect(() => parseUiArgs(["--run"], now)).toThrow(/necesita un valor/);
    expect(() => parseUiArgs(["--run", "--headed"], now)).toThrow(/necesita un valor/);
    expect(() => parseUiArgs(["--run", "../x"], now)).toThrow(/--run/);
    expect(() => parseUiArgs(["--seller", "admin"], now)).toThrow(/--seller/);
  });

  it("flowId y shotFileName dan nombres estables", () => {
    expect(flowId(3)).toBe("f03");
    expect(flowId(10)).toBe("f10");
    expect(shotFileName("f03-ii_cut", 2, "Tras corte ¡ya!")).toBe("f03-ii-cut-02-tras-corte-ya.png");
    expect(shotFileName("f01", 11, "")).toBe("f01-11-paso.png");
  });
});

describe("diffSnapshots", () => {
  it("devuelve solo lo nuevo, el delta de stock y los cambios de estado", () => {
    const before: DbSnapshot = {
      ...emptySnapshot(),
      stock: { a: 20, b: 5 },
      movements: [movement({ id: "m0", product_id: "a", type: "inventario_inicial", quantity_delta: 20 })],
      sales: [{ id: "s0", invoice_number: "V-0", status: "pendiente_pago", client_request_id: null }],
      payments: [{ id: "p0", sale_id: "s0", purchase_id: null, status: "activo" }],
      purchases: [{ id: "c0", purchase_number: "C-0", status: "pedido" }],
    };
    const after: DbSnapshot = {
      stock: { a: 17, b: 5 },
      movements: [...before.movements, movement({ id: "m1", product_id: "a", quantity_delta: -3, sale_id: "s1" })],
      sales: [
        { id: "s0", invoice_number: "V-0", status: "cancelada", client_request_id: null },
        { id: "s1", invoice_number: "V-1", status: "pagada", client_request_id: "k1" },
      ],
      saleItems: [{ id: "i1", sale_id: "s1", product_id: "a", quantity: 3 }],
      payments: [
        { id: "p0", sale_id: "s0", purchase_id: null, status: "anulado" },
        { id: "p1", sale_id: "s1", purchase_id: null, status: "activo" },
      ],
      purchases: [{ id: "c0", purchase_number: "C-0", status: "recibido" }],
    };
    const diff = diffSnapshots(before, after);
    expect(diff.stockDelta).toEqual({ a: -3, b: 0 });
    expect(diff.movements.map((m) => m.id)).toEqual(["m1"]);
    expect(diff.sales.map((s) => s.id)).toEqual(["s1"]);
    expect(diff.saleItems).toHaveLength(1);
    expect(diff.payments.map((p) => p.id)).toEqual(["p1"]);
    expect(diff.purchases).toEqual([]);
    expect(diff.statusChanges).toEqual({
      s0: "pendiente_pago→cancelada",
      p0: "activo→anulado",
      c0: "pedido→recibido",
    });
  });

  it("un producto que aparece después cuenta desde 0", () => {
    const diff = diffSnapshots(emptySnapshot(), { ...emptySnapshot(), stock: { nuevo: 15 } });
    expect(diff.stockDelta).toEqual({ nuevo: 15 });
    expect(diff.statusChanges).toEqual({});
  });
});

describe("sumas y comparación de mapas", () => {
  const rows = [
    movement({ id: "1", product_id: "a", quantity_delta: -3 }),
    movement({ id: "2", product_id: "a", quantity_delta: -1 }),
    movement({ id: "3", product_id: "b", type: "compra", quantity_delta: 36 }),
  ];

  it("sumMovements agrupa por producto y filtra por tipo", () => {
    expect(sumMovements(rows)).toEqual({ a: -4, b: 36 });
    expect(sumMovements(rows, ["venta"])).toEqual({ a: -4 });
    expect(sumMovements(rows, ["conversion_salida"])).toEqual({});
  });

  it("sumSaleItems agrupa cantidades por producto", () => {
    expect(
      sumSaleItems([
        { id: "1", sale_id: "s", product_id: "a", quantity: 2 },
        { id: "2", sale_id: "t", product_id: "a", quantity: 2 },
        { id: "3", sale_id: "s", product_id: "b", quantity: 1 },
      ]),
    ).toEqual({ a: 4, b: 1 });
  });

  it("diffNumberMaps: vacío si coinciden, una frase por diferencia, ausente = 0", () => {
    expect(diffNumberMaps({ a: 3, b: 0 }, { a: 3 })).toEqual([]);
    expect(diffNumberMaps({ a: 3, b: 2 }, { a: 6, c: 1 }, { a: "sku-a" })).toEqual([
      "sku-a: esperado 3, real 6",
      "b: esperado 2, real 0",
      "c: esperado 0, real 1",
    ]);
  });

  it("packUnits multiplica y valida", () => {
    expect(packUnits(3, 12)).toBe(36);
    expect(() => packUnits(0, 12)).toThrow();
    expect(() => packUnits(2, 1.5)).toThrow();
  });
});

describe("judgeUiVsDb (comparador UI ↔ base)", () => {
  const what = "venta(s)";

  it("pass: éxito con exactamente lo esperado", () => {
    expect(judgeUiVsDb({ what, uiClaim: "success", expectedDocs: 1, createdDocs: 1 })).toEqual({ verdict: "pass", detail: "" });
    expect(judgeUiVsDb({ what, uiClaim: "success", expectedDocs: 2, createdDocs: 2 }).verdict).toBe("pass");
  });

  it("pass: error con nada esperado y nada creado", () => {
    expect(judgeUiVsDb({ what, uiClaim: "error", expectedDocs: 0, createdDocs: 0 }).verdict).toBe("pass");
    expect(judgeUiVsDb({ what, uiClaim: "none", expectedDocs: 0, createdDocs: 0 }).verdict).toBe("pass");
  });

  it("fail: éxito falso (UI dice éxito, base vacía)", () => {
    const judged = judgeUiVsDb({ what, uiClaim: "success", expectedDocs: 1, createdDocs: 0 });
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/Éxito falso/);
  });

  it("fail: duplicado aunque la UI diga éxito", () => {
    const judged = judgeUiVsDb({ what, uiClaim: "success", expectedDocs: 1, createdDocs: 2 });
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/Duplicado.*2/);
  });

  it("fail: la base registró y la UI dijo error o calló", () => {
    expect(judgeUiVsDb({ what, uiClaim: "error", expectedDocs: 1, createdDocs: 1 }).detail).toMatch(/Error falso/);
    expect(judgeUiVsDb({ what, uiClaim: "none", expectedDocs: 1, createdDocs: 1 }).detail).toMatch(/Operación muda/);
    expect(judgeUiVsDb({ what, uiClaim: "error", expectedDocs: 0, createdDocs: 1 }).verdict).toBe("fail");
  });

  it("fail: se esperaba un documento y no nació (la UI no afirmó éxito)", () => {
    expect(judgeUiVsDb({ what, uiClaim: "error", expectedDocs: 1, createdDocs: 0 }).detail).toMatch(/mostró error/);
    expect(judgeUiVsDb({ what, uiClaim: "none", expectedDocs: 1, createdDocs: 0 }).detail).toMatch(/no dijo nada/);
  });

  it("fail: éxito con menos documentos de los esperados", () => {
    const judged = judgeUiVsDb({ what: "producto(s)", uiClaim: "success", expectedDocs: 3, createdDocs: 2 });
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/esperaban 3.*hay 2/);
  });

  it("fail: se creó algo cuando no se esperaba nada y la UI dijo éxito", () => {
    expect(judgeUiVsDb({ what, uiClaim: "success", expectedDocs: 0, createdDocs: 1 }).verdict).toBe("fail");
    expect(judgeUiVsDb({ what, uiClaim: "success", expectedDocs: 0, createdDocs: 2 }).detail).toMatch(/Duplicado/);
  });
});

describe("summarizeSalePosts", () => {
  it("cuenta peticiones y claves de idempotencia distintas", () => {
    const body = (id?: string) => JSON.stringify({ clientRequestId: id, items: [] });
    expect(summarizeSalePosts([body("k1"), body("k1"), body("k2"), body(), null, "{no json"])).toEqual({
      requests: 6,
      clientRequestIds: ["k1", "k1", "k2"],
      distinctClientRequestIds: 2,
      withoutClientRequestId: 3,
    });
    expect(summarizeSalePosts([])).toEqual({
      requests: 0,
      clientRequestIds: [],
      distinctClientRequestIds: 0,
      withoutClientRequestId: 0,
    });
  });
});

describe("Excel de importación", () => {
  it("genera filas con SKU único en minúsculas y stock inicial > 0", () => {
    const rows = buildImportRows("U404-Run-F10-", "U404 run F10", "Snacks Lab", 3);
    expect(rows.map((row) => row.sku)).toEqual(["u404-run-f10-x1", "u404-run-f10-x2", "u404-run-f10-x3"]);
    expect(rows.map((row) => row.stock_inicial)).toEqual([7, 14, 21]);
    expect(new Set(rows.map((row) => row.nombre)).size).toBe(3);
    expect(rows.every((row) => row.categoria === "Snacks Lab" && row.precio_ref > row.costo_ref)).toBe(true);
    expect(() => buildImportRows("p", "n", "c", 0)).toThrow();
  });

  it("arma la hoja: encabezados exactos, fila 2 de ejemplo y datos desde la fila 3", () => {
    const rows = buildImportRows("p-", "N", "Cat", 2);
    const aoa = buildImportSheetAoa(rows);
    expect(aoa).toHaveLength(4);
    expect(aoa[0]).toEqual([...IMPORT_HEADERS]);
    expect(aoa[0]).toEqual(["sku", "codigo_barras", "nombre", "categoria", "precio_ref", "costo_ref", "stock_inicial", "stock_minimo"]);
    expect(aoa[1]?.[0]).toBe("bod-ej-001");
    expect(aoa[1]?.[6]).toBe(0);
    expect(aoa[2]).toEqual(["p-x1", "", "N Import 1", "Cat", 1.25, 0.6, 7, 1]);
    expect(aoa[3]).toEqual(["p-x2", "", "N Import 2", "Cat", 1.5, 0.7, 14, 1]);
    expect(aoa.every((row) => row.length === IMPORT_HEADERS.length)).toBe(true);
  });
});

describe("formato de resultados", () => {
  const result: UiResult = {
    ts: "2026-10-06T04:00:00.000Z",
    suite: "ui",
    id: "f03.ii",
    scope: "plan",
    title: "Corte | tras commit",
    hypothesis: ["H8"],
    steps: [],
    ui_says: ["POS: «Failed to fetch»", "otra\nlínea"],
    expected: {},
    actual: {},
    reconcile_scoped: {},
    reconcile_global: {},
    verdict: "finding",
    detail: "detalle",
    evidence: ["a.png"],
  };

  it("cuenta y resume veredictos", () => {
    const counts = countVerdicts([result, { verdict: "pass" }, { verdict: "pass" }, { verdict: "error" }]);
    expect(counts).toEqual({ pass: 2, fail: 0, finding: 1, error: 1, skip: 0 });
    expect(formatVerdictSummary(counts)).toBe("pass=2 fail=0 finding=1 error=1 skip=0");
  });

  it("worstVerdict ordena error > fail > finding > pass > skip", () => {
    expect(worstVerdict([])).toBe("skip");
    expect(worstVerdict(["pass", "finding", "pass"])).toBe("finding");
    expect(worstVerdict(["finding", "fail"])).toBe("fail");
    expect(worstVerdict(["fail", "error", "pass"])).toBe("error");
  });

  it("la fila markdown escapa barras y saltos de línea", () => {
    const row = toMarkdownRow(result);
    expect(row.split("\n")).toHaveLength(1);
    expect(row).toContain("Corte \\| tras commit");
    expect(row).toContain("otra línea");
    expect(row.startsWith("| f03.ii | finding |")).toBe(true);
    expect(MD_HEADER.split("\n")[0]?.split("|").length).toBe(row.split(/(?<!\\)\|/).length);
  });
});

describe("judgeLostResponse (respuesta perdida tras el commit, plan §8.3 flujo 3)", () => {
  const NOTICE = "La venta pudo haberse registrado; verifica antes de volver a cobrar.";
  const view = (partial: Partial<PosView> = {}): PosView => ({
    claim: "error",
    text: NOTICE,
    invoice: null,
    verifyOffered: true,
    ...partial,
  });
  const success = (invoice = "V-1"): PosView => ({
    claim: "success",
    text: `Venta registrada Factura ${invoice}.`,
    invoice,
    verifyOffered: false,
  });
  const base = (partial: Partial<LostResponseInput> = {}): LostResponseInput => ({
    dbProblems: [],
    dbInvoice: "V-1",
    salesAtCut: 1,
    postsAtCut: 1,
    atCut: view(),
    final: success(),
    ...partial,
  });

  it("reconoce el aviso de resultado desconocido", () => {
    expect(isUnknownOutcomeNotice(NOTICE)).toBe(true);
    expect(isUnknownOutcomeNotice("Failed to fetch")).toBe(false);
    expect(isUnknownOutcomeNotice("")).toBe(false);
  });

  it("pass: la UI recupera sola la venta y la muestra (era `finding` con el esperado de fase 4)", () => {
    expect(judgeLostResponse(base({ atCut: success(), final: success() }))).toEqual({ verdict: "pass", detail: "" });
  });

  it("pass: aviso «pudo haberse registrado» + Verificar, y al verificar muestra la venta", () => {
    expect(judgeLostResponse(base()).verdict).toBe("pass");
  });

  it("pass: tras recargar el aviso sigue y la UI nombra la venta ya registrada en vez de cobrar otra", () => {
    const final = view({
      text: "El cobro anterior si quedo registrado como venta V-1. Si este carrito es esa misma venta, limpia la orden: no la cobres otra vez.",
      verifyOffered: false,
    });
    expect(judgeLostResponse(base({ onReturn: view(), final })).verdict).toBe("pass");
  });

  it("fail: cualquier descuadre de la base manda (venta duplicada)", () => {
    const judged = judgeLostResponse(base({ dbProblems: ["ventas: esperado 1, real 2"] }));
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/esperado 1, real 2/);
  });

  it("fail: éxito falso (la UI afirma la venta y la base no la tiene)", () => {
    const judged = judgeLostResponse(base({ salesAtCut: 0, atCut: success(), dbInvoice: null }));
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/Éxito falso/);
  });

  it("fail: la venta está en la base y la UI solo dice «Failed to fetch»", () => {
    const judged = judgeLostResponse(base({ atCut: view({ text: "Failed to fetch", verifyOffered: false }) }));
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/Failed to fetch/);
    expect(judged.detail).toMatch(/Verificar/);
  });

  it("fail: avisa pero no ofrece «Verificar»", () => {
    expect(judgeLostResponse(base({ atCut: view({ verifyOffered: false }) })).verdict).toBe("fail");
  });

  it("fail: el cliente reintentó solo antes de que el cajero hiciera nada", () => {
    expect(judgeLostResponse(base({ postsAtCut: 2 })).detail).toMatch(/reintentó solo/);
  });

  it("fail: al volver (recarga / salir y volver) el aviso desapareció", () => {
    const judged = judgeLostResponse(base({ onReturn: view({ claim: "none", text: "", verifyOffered: false }) }));
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/al volver/i);
  });

  it("fail: con la red de vuelta la UI no llega a mostrar la venta registrada", () => {
    expect(judgeLostResponse(base({ final: view() })).detail).toMatch(/V-1/);
    expect(judgeLostResponse(base({ final: success("V-2") })).verdict).toBe("fail");
    expect(judgeLostResponse(base({ atCut: success("V-9"), final: success("V-1") })).verdict).toBe("fail");
  });
});

describe("adjustmentTypeProblems (flujo 6: tipos que ofrece el ajuste libre)", () => {
  it("vacío con exactamente los tres tipos (ignora el placeholder, acentos y mayúsculas)", () => {
    expect(adjustmentTypeProblems(["Selecciona tipo", "Ajuste entrada", "Ajuste salida", "Inventario inicial"])).toEqual([]);
    expect(adjustmentTypeProblems([" AJUSTE ENTRADA ", "ajuste salida", "Inventario Inicial"])).toEqual([]);
  });

  it("denuncia las devoluciones, con o sin acento", () => {
    const problems = adjustmentTypeProblems([
      "Ajuste entrada",
      "Ajuste salida",
      "Devolución cliente",
      "Devolucion proveedor",
      "Inventario inicial",
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/Devolución cliente/);
    expect(problems.join(" ")).toMatch(/Devolucion proveedor/);
  });

  it("denuncia un tipo que falta y uno inesperado", () => {
    const problems = adjustmentTypeProblems(["Ajuste entrada", "Venta"]).join(" · ");
    expect(problems).toMatch(/falta «Ajuste salida»/);
    expect(problems).toMatch(/falta «Inventario inicial»/);
    expect(problems).toMatch(/inesperado «Venta»/);
  });
});

describe("resumen por flujo y capturas", () => {
  const result = (
    id: string,
    verdict: UiResult["verdict"],
    scope: UiResult["scope"],
    evidence: string[],
  ): UiResult => ({
    ts: "t",
    suite: "ui",
    id,
    scope,
    title: id,
    hypothesis: [],
    steps: [],
    ui_says: [],
    expected: {},
    actual: {},
    reconcile_scoped: {},
    reconcile_global: {},
    verdict,
    detail: "",
    evidence,
  });
  const results = [
    result("f01", "pass", "plan", ["d/f01-01-carrito.png"]),
    result("f07.normal", "pass", "plan", ["d/f07-normal-01.png", "d/f07-normal-02.png"]),
    result("f07.sin_stock", "finding", "extra", ["d/f07-sin-stock-01.png"]),
    result("f10", "error", "plan", ["d/f10-import.xlsx", "d/f10-error.aria.txt"]),
  ];

  it("flowOfCase lee el número del id", () => {
    expect(flowOfCase("f03.ii_cut")).toBe(3);
    expect(flowOfCase("f10")).toBe(10);
    expect(flowOfCase("otro")).toBeNull();
  });

  it("el veredicto del flujo sale de los casos del plan; los extra van aparte; solo cuentan los PNG", () => {
    const flows = summarizeFlows(results, [1, 2, 7, 10]);
    expect(flows.map((f) => [f.id, f.verdict, f.extras, f.cases, f.shots.length])).toEqual([
      ["f01", "pass", null, 1, 1],
      ["f02", "error", null, 0, 0],
      ["f07", "pass", "finding", 2, 3],
      ["f10", "error", null, 1, 0],
    ]);
    expect(flows[2]?.shots).toEqual(["d/f07-normal-01.png", "d/f07-normal-02.png", "d/f07-sin-stock-01.png"]);
  });

  it("flowCoverageProblems: flujo sin ejecutar y flujo sin captura", () => {
    expect(flowCoverageProblems(summarizeFlows(results, [1, 2, 7, 10]))).toEqual([
      "f02: no se ejecutó ningún caso",
      "f10: no dejó ninguna captura",
    ]);
    expect(flowCoverageProblems(summarizeFlows(results, [1, 7]))).toEqual([]);
  });

  it("flowsMarkdown: una fila por flujo y la lista completa de capturas por flujo", () => {
    const md = flowsMarkdown(summarizeFlows(results, [1, 7]));
    expect(md).toContain("| f01 | pass | — | 1 | 1 |");
    expect(md).toContain("| f07 | pass | finding | 2 | 3 |");
    expect(md).toContain("## Capturas por flujo");
    expect(md).toContain("### f07");
    expect(md).toContain("- d/f07-sin-stock-01.png");
  });
});

describe("judgeRejectionMessage (rechazo a la vista y en español · STK-607)", () => {
  const viewport = { width: 1440, height: 900 };
  const base: RejectionMessageInput = {
    what: "el rechazo de la anulación",
    text: "No pudimos actualizar la venta La venta V-1 tiene 1 pago(s) activo(s). Anula primero los pagos y luego cancela la venta.",
    box: { x: 300, y: 180, width: 800, height: 170 },
    viewport,
    explains: /pago|devoluci/i,
    nativeValidation: "",
  };

  it("pass: mensaje dentro de la ventana, explica el motivo y sin burbuja nativa", () => {
    expect(judgeRejectionMessage(base)).toEqual({ verdict: "pass", detail: "" });
    expect(judgeRejectionMessage({ ...base, box: { x: 0, y: 0, width: 1440, height: 900 } }).verdict).toBe("pass");
  });

  it("fail: no hay mensaje (ni en el DOM ni pintado)", () => {
    expect(judgeRejectionMessage({ ...base, text: null, box: null }).detail).toMatch(/no muestra ningún mensaje/);
    expect(judgeRejectionMessage({ ...base, text: "   ", box: base.box }).verdict).toBe("fail");
    expect(judgeRejectionMessage({ ...base, box: null }).detail).toMatch(/no está pintado/);
    expect(judgeRejectionMessage({ ...base, box: { x: 300, y: 180, width: 0, height: 0 } }).detail).toMatch(/no está pintado/);
  });

  it("fail: el mensaje está en el DOM pero bajo el pliegue (caso s606-ui-1: 991 px con ventana de 900)", () => {
    const judged = judgeRejectionMessage({ ...base, box: { x: 300, y: 991, width: 800, height: 170 } });
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/fuera de la ventana.*991.*900/);
  });

  it("fail: el mensaje asoma pero queda cortado por cualquier borde", () => {
    expect(judgeRejectionMessage({ ...base, box: { x: 300, y: 800, width: 800, height: 170 } }).verdict).toBe("fail");
    expect(judgeRejectionMessage({ ...base, box: { x: 300, y: -20, width: 800, height: 170 } }).verdict).toBe("fail");
    expect(judgeRejectionMessage({ ...base, box: { x: 1000, y: 180, width: 800, height: 170 } }).verdict).toBe("fail");
    expect(judgeRejectionMessage({ ...base, box: { x: -5, y: 180, width: 800, height: 170 } }).verdict).toBe("fail");
  });

  it("fail: visible pero no explica el motivo en español", () => {
    const judged = judgeRejectionMessage({ ...base, text: "Something went wrong" });
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/no explica.*Something went wrong/);
  });

  it("fail: el navegador pinta su burbuja de validación nativa, aunque haya mensaje propio", () => {
    const judged = judgeRejectionMessage({
      ...base,
      explains: /no hay/i,
      text: "No hay empaques en stock para abrir.",
      nativeValidation: "Minimum value (1) must be less than the maximum value (0).",
    });
    expect(judged.verdict).toBe("fail");
    expect(judged.detail).toMatch(/burbuja.*Minimum value/);
  });
});
