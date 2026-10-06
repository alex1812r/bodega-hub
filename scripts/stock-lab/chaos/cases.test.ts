/** @jest-environment node */
import {
  type ChaosLine,
  PLAN_CASES,
  VARIANTS,
  addScoped,
  aggregateAttempts,
  applyIntegrity,
  chainConsistent,
  countVerdicts,
  defaultRunId,
  emptyScoped,
  integrityProblems,
  isDeadlock,
  isRawDbError,
  judgeAbortRetry,
  judgeCancelVsReturn,
  judgeConversion,
  judgeDeactivatedSale,
  judgeDoubleReceive,
  judgeDuplicateSale,
  judgeKeyReuse,
  judgeMissingKey,
  judgeRejection,
  judgeReverseOrder,
  judgeSoftCategory,
  judgeStockRace,
  latestById,
  parseChaosArgs,
  planCaseOf,
  purchaseBody,
  renderChaosMarkdown,
  repeatsFor,
  saleBody,
  selectVariantIds,
  slimSteps,
  variantIds,
} from "./cases";

describe("tabla del plan y catálogo de variantes", () => {
  it("cubre los 13 casos de la sección 9 con su severidad", () => {
    expect(Object.keys(PLAN_CASES)).toEqual(Array.from({ length: 13 }, (_, i) => `9.${i + 1}`));
    expect(PLAN_CASES["9.5"]?.severity).toBe("Media");
    expect(PLAN_CASES["9.11"]?.severity).toBe("Baja");
    expect(PLAN_CASES["9.2"]?.expected).toBe("Un solo ingreso de stock; el segundo 409/400");
  });

  it("hay al menos una variante por cada caso 9.1–9.12, con ids únicos del plan", () => {
    const ids = variantIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (let n = 1; n <= 12; n += 1) {
      expect(ids.some((id) => planCaseOf(id) === `9.${n}`)).toBe(true);
    }
    for (const id of ids) expect(PLAN_CASES[planCaseOf(id)]).toBeDefined();
    expect(ids.some((id) => planCaseOf(id) === "9.13")).toBe(false);
  });

  it("repite 10 veces por defecto las carreras 9.1–9.4, 9.6.race y 9.10; el resto 1", () => {
    for (const v of VARIANTS) {
      const plan = planCaseOf(v.id);
      const isRace = ["9.1", "9.2", "9.3", "9.4", "9.10"].includes(plan) || v.id === "9.6.race";
      expect([v.id, v.defaultRepeat]).toEqual([v.id, isRace ? 10 : 1]);
    }
  });

  it("--repeat solo multiplica las variantes repetibles", () => {
    expect(repeatsFor({ defaultRepeat: 10, repeatable: true }, null)).toBe(10);
    expect(repeatsFor({ defaultRepeat: 10, repeatable: true }, 2)).toBe(2);
    expect(repeatsFor({ defaultRepeat: 1, repeatable: false }, 5)).toBe(1);
    expect(repeatsFor({ defaultRepeat: 1, repeatable: true }, 5)).toBe(5);
  });
});

describe("parseChaosArgs / selectVariantIds", () => {
  it("parsea --case con lista, --run, --repeat y --out", () => {
    expect(parseChaosArgs(["--case", "9.1, 9.2", "--run", "r1", "--repeat", "3", "--out", "x"])).toEqual({
      cases: ["9.1", "9.2"],
      all: false,
      runId: "r1",
      repeat: 3,
      list: false,
      out: "x",
    });
  });

  it("acepta --only como alias, --all y --list", () => {
    expect(parseChaosArgs(["--only", "9.5"]).cases).toEqual(["9.5"]);
    expect(parseChaosArgs(["--all"]).all).toBe(true);
    expect(parseChaosArgs(["--list"]).list).toBe(true);
  });

  it("rechaza argv inválido", () => {
    expect(() => parseChaosArgs([])).toThrow(/--case/);
    expect(() => parseChaosArgs(["--all", "--repeat", "0"])).toThrow(/--repeat/);
    expect(() => parseChaosArgs(["--case"])).toThrow(/Falta el valor/);
    expect(() => parseChaosArgs(["--all", "--nope"])).toThrow(/desconocido/);
    expect(() => parseChaosArgs(["--all", "--run", "../x"])).toThrow(/--run/);
  });

  it("selecciona por caso, por variante o todo, en el orden del catálogo", () => {
    const available = ["9.1.a", "9.1.b", "9.10", "9.5"];
    expect(selectVariantIds(available, { all: true, cases: [] })).toEqual(available);
    expect(selectVariantIds(available, { all: false, cases: ["9.5", "9.1"] })).toEqual(["9.1.a", "9.1.b", "9.5"]);
    expect(selectVariantIds(available, { all: false, cases: ["9.1.b"] })).toEqual(["9.1.b"]);
    // "9.1" no arrastra "9.10"
    expect(selectVariantIds(available, { all: false, cases: ["9.1"] })).not.toContain("9.10");
    expect(() => selectVariantIds(available, { all: false, cases: ["9.99"] })).toThrow(/desconocido/);
  });

  it("planCaseOf y defaultRunId", () => {
    expect(planCaseOf("9.10")).toBe("9.10");
    expect(planCaseOf("9.1.same_key_x2")).toBe("9.1");
    expect(defaultRunId(new Date(2026, 9, 6, 4, 5, 9), "chaos")).toBe("20261006-040509-chaos");
  });
});

describe("judgeDuplicateSale (9.1)", () => {
  const base = { ids: ["a", "a"], errors: [undefined, undefined], quantity: 2, paid: true };

  it("pass: una venta y todas las respuestas con el mismo id", () => {
    const j = judgeDuplicateSale({ ...base, statuses: [201, 201], sales: 1, saleMovements: 1, activePayments: 1, stockDelta: -2 });
    expect(j.verdict).toBe("pass");
  });

  it("finding: una venta pero la segunda respuesta es 409", () => {
    const j = judgeDuplicateSale({ ...base, statuses: [201, 409], ids: ["a", null], errors: [undefined, "CONFLICT ya existe"], sales: 1, saleMovements: 1, activePayments: 1, stockDelta: -2 });
    expect(j.verdict).toBe("finding");
    expect(j.detail).toContain("409 CONFLICT ya existe");
  });

  it("fail: dos ventas / doble descuento / doble pago", () => {
    expect(judgeDuplicateSale({ ...base, statuses: [201, 201], ids: ["a", "b"], sales: 2, saleMovements: 2, activePayments: 2, stockDelta: -4 }).verdict).toBe("fail");
    expect(judgeDuplicateSale({ ...base, statuses: [201, 201], sales: 1, saleMovements: 1, activePayments: 2, stockDelta: -2 }).verdict).toBe("fail");
    expect(judgeDuplicateSale({ ...base, paid: false, statuses: [201, 201], ids: ["a", "b"], sales: 2, saleMovements: 2, activePayments: 0, stockDelta: -4 }).verdict).toBe("fail");
  });

  it("fail: venta única incoherente o ids distintos con una sola venta", () => {
    expect(judgeDuplicateSale({ ...base, statuses: [201, 201], sales: 1, saleMovements: 0, activePayments: 1, stockDelta: 0 }).verdict).toBe("fail");
    expect(judgeDuplicateSale({ ...base, statuses: [201, 201], ids: ["a", "b"], sales: 1, saleMovements: 1, activePayments: 1, stockDelta: -2 }).verdict).toBe("fail");
  });

  it("ninguna venta: finding si no hay efectos, fail si los hay", () => {
    const none = { ...base, statuses: [500, 500], ids: [null, null], errors: ["x", "y"], sales: 0, activePayments: 0 };
    expect(judgeDuplicateSale({ ...none, saleMovements: 0, stockDelta: 0 }).verdict).toBe("finding");
    expect(judgeDuplicateSale({ ...none, saleMovements: 1, stockDelta: -2 }).verdict).toBe("fail");
  });

});

describe("judgeMissingKey (9.1 sin clientRequestId, STK-514)", () => {
  const none = { errors: ["BAD_REQUEST clientRequestId requerido", "BAD_REQUEST clientRequestId requerido"], sales: 0, saleMovements: 0, activePayments: 0, stockDelta: 0 };

  it("pass: 400 en ambas, 0 ventas, 0 movimientos", () => {
    const j = judgeMissingKey({ ...none, statuses: [400, 400] });
    expect(j.verdict).toBe("pass");
    expect(j.detail).toContain("0 ventas, 0 movimientos");
  });

  it("fail: alguna crea venta, movimiento o pago, o responde 2xx", () => {
    expect(judgeMissingKey({ ...none, statuses: [201, 400], sales: 1, saleMovements: 1, stockDelta: -2 }).verdict).toBe("fail");
    expect(judgeMissingKey({ ...none, statuses: [201, 201], sales: 2, saleMovements: 2, stockDelta: -4 }).verdict).toBe("fail");
    expect(judgeMissingKey({ ...none, statuses: [400, 400], saleMovements: 1, stockDelta: -2 }).verdict).toBe("fail");
    expect(judgeMissingKey({ ...none, statuses: [400, 400], activePayments: 1 }).verdict).toBe("fail");
    expect(judgeMissingKey({ ...none, statuses: [201, 400] }).verdict).toBe("fail");
  });

  it("finding: sin efecto pero con un código distinto de 400", () => {
    const j = judgeMissingKey({ ...none, statuses: [400, 500], errors: ["BAD_REQUEST x", "INTERNAL_ERROR y"] });
    expect(j.verdict).toBe("finding");
    expect(j.detail).toContain("500 INTERNAL_ERROR y");
  });

  it("las variantes 9.1.no_key_* siguen en el catálogo con el esperado nuevo", () => {
    for (const id of ["9.1.no_key_x2", "9.1.no_key_gap50"]) {
      const def = VARIANTS.find((v) => v.id === id);
      expect(def?.expected).toMatchObject({ sales: 0, sale_movements: 0 });
      expect(def?.defaultRepeat).toBe(10);
    }
  });
});

describe("judgeKeyReuse (9.8 misma clave, otro carrito)", () => {
  const one = { firstStatus: 201, firstId: "s1", retryId: null, sales: 1, saleMovements: 1, activePayments: 1, stockDelta: -1, quantity: 1 };

  it("pass: el segundo envío responde 409 y solo existe la primera venta", () => {
    expect(judgeKeyReuse({ ...one, retryStatus: 409, retryError: "CONFLICT La clave de idempotencia ya se usó" }).verdict).toBe("pass");
  });

  it("fail: 2xx con la venta vieja, segunda venta o 5xx", () => {
    const stale = judgeKeyReuse({ ...one, retryStatus: 201, retryId: "s1" });
    expect(stale.verdict).toBe("fail");
    expect(stale.detail).toContain("OTRO carrito respondió 201");
    expect(judgeKeyReuse({ ...one, retryStatus: 201, retryId: "s2", sales: 2, saleMovements: 2, activePayments: 2, stockDelta: -6 }).verdict).toBe("fail");
    expect(judgeKeyReuse({ ...one, retryStatus: 500, retryError: "INTERNAL_ERROR x" }).verdict).toBe("fail");
  });

  it("finding: rechazo 4xx que no es 409; error si la primera venta no entró", () => {
    expect(judgeKeyReuse({ ...one, retryStatus: 400, retryError: "BAD_REQUEST x" }).verdict).toBe("finding");
    expect(judgeKeyReuse({ ...one, firstStatus: 400, firstId: null, retryStatus: 400, sales: 0, saleMovements: 0, activePayments: 0, stockDelta: 0 }).verdict).toBe("error");
  });

  it("la variante está en el catálogo bajo el caso 9.8", () => {
    expect(VARIANTS.find((v) => v.id === "9.8.same_key_other_cart")?.expected).toMatchObject({ sales: 1, retry: 409 });
  });
});

describe("judgeDoubleReceive (9.2)", () => {
  const base = { errors: [], quantity: 7 };

  it("pass: un ingreso y el resto 400/409", () => {
    expect(judgeDoubleReceive({ ...base, statuses: [200, 409, 400], purchaseMovements: 1, stockDelta: 7, purchaseStatus: "recibido" }).verdict).toBe("pass");
  });

  it("fail: un ingreso pero la perdedora responde 500 (el rechazo de negocio debe ser 409)", () => {
    const j = judgeDoubleReceive({ statuses: [500, 200], errors: ["INTERNAL_ERROR Solo se pueden recibir compras en estado pedido", undefined], quantity: 7, purchaseMovements: 1, stockDelta: 7, purchaseStatus: "recibido" });
    expect(j.verdict).toBe("fail");
    expect(j.detail).toContain("500 INTERNAL_ERROR");
  });

  it("finding: un ingreso y la perdedora 4xx que no es 409/400", () => {
    expect(judgeDoubleReceive({ ...base, statuses: [200, 403], purchaseMovements: 1, stockDelta: 7, purchaseStatus: "recibido" }).verdict).toBe("finding");
  });

  it("finding: dos 2xx con un solo ingreso; o ninguna recepción", () => {
    expect(judgeDoubleReceive({ ...base, statuses: [200, 200], purchaseMovements: 1, stockDelta: 7, purchaseStatus: "recibido" }).verdict).toBe("finding");
    expect(judgeDoubleReceive({ ...base, statuses: [500, 500], purchaseMovements: 0, stockDelta: 0, purchaseStatus: "pedido" }).verdict).toBe("finding");
  });

  it("fail: doble ingreso o estado incoherente", () => {
    expect(judgeDoubleReceive({ ...base, statuses: [200, 200], purchaseMovements: 2, stockDelta: 14, purchaseStatus: "recibido" }).verdict).toBe("fail");
    expect(judgeDoubleReceive({ ...base, statuses: [200, 400], purchaseMovements: 0, stockDelta: 0, purchaseStatus: "recibido" }).verdict).toBe("fail");
    expect(judgeDoubleReceive({ ...base, statuses: [200, 400], purchaseMovements: 1, stockDelta: 3, purchaseStatus: "recibido" }).verdict).toBe("fail");
  });
});

describe("judgeStockRace (9.3)", () => {
  const base = { errors: [], initialStock: 5 };

  it("pass: una pasa, la otra 400, stock 0", () => {
    expect(judgeStockRace({ ...base, statuses: [201, 400], stock: 0, minStockAfter: 0, sales: 1, saleMovements: 1, activePayments: 1 }).verdict).toBe("pass");
  });

  it("pass: la perdedora recibe el 409 «Stock insuficiente» del libro mayor (PT409)", () => {
    expect(
      judgeStockRace({ ...base, statuses: [201, 409], errors: [undefined, "CONFLICT Stock insuficiente"], stock: 0, minStockAfter: 0, sales: 1, saleMovements: 1, activePayments: 1 }).verdict,
    ).toBe("pass");
  });

  it("finding: la perdedora no es 400/409 por stock (409 de otra cosa o 500)", () => {
    expect(judgeStockRace({ ...base, statuses: [201, 409], stock: 0, minStockAfter: 0, sales: 1, saleMovements: 1, activePayments: 1 }).verdict).toBe("finding");
    expect(
      judgeStockRace({ ...base, statuses: [201, 409], errors: [undefined, "CONFLICT El recurso ya existe."], stock: 0, minStockAfter: 0, sales: 1, saleMovements: 1, activePayments: 1 }).verdict,
    ).toBe("finding");
    expect(judgeStockRace({ ...base, statuses: [201, 500], stock: 0, minStockAfter: 0, sales: 1, saleMovements: 1, activePayments: 1 }).verdict).toBe("finding");
  });

  it("fail: negativo, sobreventa o ganadora incoherente", () => {
    expect(judgeStockRace({ ...base, statuses: [201, 201], stock: -5, minStockAfter: -5, sales: 2, saleMovements: 2, activePayments: 2 }).verdict).toBe("fail");
    expect(judgeStockRace({ ...base, statuses: [201, 201], stock: 0, minStockAfter: 0, sales: 2, saleMovements: 2, activePayments: 2 }).verdict).toBe("fail");
    expect(judgeStockRace({ ...base, statuses: [201, 400], stock: 0, minStockAfter: 0, sales: 1, saleMovements: 1, activePayments: 2 }).verdict).toBe("fail");
  });

  it("ninguna pasa: finding si todo intacto; fail si la rechazada dejó rastro", () => {
    expect(judgeStockRace({ ...base, statuses: [500, 500], stock: 5, minStockAfter: 5, sales: 0, saleMovements: 0, activePayments: 0 }).verdict).toBe("finding");
    expect(judgeStockRace({ ...base, statuses: [500, 500], stock: 0, minStockAfter: 0, sales: 0, saleMovements: 1, activePayments: 0 }).verdict).toBe("fail");
  });
});

describe("judgeCancelVsReturn (9.4)", () => {
  const base = { errors: [undefined, "BAD_REQUEST ya fue cancelada"], lines: 1, initialStock: 10, quantity: 2, activePayments: 0, paidVes: 0 };

  it("pass: una reversión y la perdedora 4xx", () => {
    expect(judgeCancelVsReturn({ ...base, paid: false, cancelStatus: 200, returnStatus: 400, reversalMovements: 1, stock: 10, saleStatus: "cancelada" }).verdict).toBe("pass");
  });

  it("fail: doble reversión", () => {
    const j = judgeCancelVsReturn({ ...base, paid: false, cancelStatus: 200, returnStatus: 200, reversalMovements: 2, stock: 12, saleStatus: "devuelta" });
    expect(j.verdict).toBe("fail");
    expect(j.detail).toContain("Doble reversión");
  });

  it("finding: una reversión con dos 2xx o perdedora 500", () => {
    expect(judgeCancelVsReturn({ ...base, paid: false, cancelStatus: 200, returnStatus: 200, reversalMovements: 1, stock: 10, saleStatus: "cancelada" }).verdict).toBe("finding");
    expect(judgeCancelVsReturn({ ...base, paid: false, cancelStatus: 500, returnStatus: 200, reversalMovements: 1, stock: 10, saleStatus: "devuelta" }).verdict).toBe("finding");
  });

  it("fail G3: venta pagada devuelta con el pago vivo (return_sale debe anularlo)", () => {
    const j = judgeCancelVsReturn({ ...base, paid: true, cancelStatus: 400, returnStatus: 200, reversalMovements: 1, stock: 10, saleStatus: "devuelta", activePayments: 1, paidVes: 104 });
    expect(j.verdict).toBe("fail");
    expect(j.detail).toContain("G3");
    expect(j.detail).toContain("paid_ves=104");
  });

  it("pagada: pass si return revierte y no queda ningún pago activo", () => {
    expect(judgeCancelVsReturn({ ...base, paid: true, cancelStatus: 409, returnStatus: 200, reversalMovements: 1, stock: 10, saleStatus: "devuelta", activePayments: 0, paidVes: 0 }).verdict).toBe("pass");
  });

  it("pagada: finding si ambas se rechazan (return_sale debe aceptar la venta pagada)", () => {
    const j = judgeCancelVsReturn({ ...base, paid: true, cancelStatus: 400, returnStatus: 400, reversalMovements: 0, stock: 8, saleStatus: "pagada", activePayments: 1, paidVes: 104 });
    expect(j.verdict).toBe("finding");
    expect(j.detail).toContain("return_sale debe aceptar");
  });

  it("sin reversión: finding sin pagar; fail si el stock se movió o la reversión es parcial", () => {
    expect(judgeCancelVsReturn({ ...base, paid: false, cancelStatus: 500, returnStatus: 500, reversalMovements: 0, stock: 8, saleStatus: "pendiente_pago" }).verdict).toBe("finding");
    expect(judgeCancelVsReturn({ ...base, paid: false, cancelStatus: 500, returnStatus: 500, reversalMovements: 0, stock: 10, saleStatus: "pendiente_pago" }).verdict).toBe("fail");
    expect(judgeCancelVsReturn({ ...base, paid: false, lines: 2, cancelStatus: 200, returnStatus: 400, reversalMovements: 1, stock: 9, saleStatus: "cancelada" }).verdict).toBe("fail");
    expect(judgeCancelVsReturn({ ...base, paid: false, cancelStatus: 200, returnStatus: 400, reversalMovements: 1, stock: 10, saleStatus: "pendiente_pago" }).verdict).toBe("fail");
  });
});

describe("judgeRejection (9.5 / 9.7 / 9.9) e isRawDbError", () => {
  const base = { expectedStatuses: [400, 409], newMovements: 0, stockDelta: 0, what: "Ajuste" };

  it("pass: rechazado con el código esperado y mensaje de negocio", () => {
    expect(judgeRejection({ ...base, status: 400, error: "BAD_REQUEST El ajuste no puede dejar stock negativo." }).verdict).toBe("pass");
  });

  it("finding: 500, 2xx sin efecto o mensaje crudo de Postgres", () => {
    expect(judgeRejection({ ...base, status: 500, error: "INTERNAL_ERROR x" }).verdict).toBe("finding");
    expect(judgeRejection({ ...base, status: 201 }).verdict).toBe("finding");
    const raw = judgeRejection({ ...base, status: 400, error: 'BAD_REQUEST null value in column "current_stock" of relation "products" violates not-null constraint' });
    expect(raw.verdict).toBe("finding");
    expect(raw.detail).toContain("error crudo de Postgres");
  });

  it("9.7 (requireBusinessMessage): crudo de Postgres o no-4xx = fail; genérico del BFF = finding; mensaje de negocio = pass", () => {
    const strict = { ...base, expectedStatuses: [400, 403, 404, 409], requireBusinessMessage: true };
    expect(judgeRejection({ ...strict, status: 409, error: "CONFLICT El producto pertenece a otra tienda." }).verdict).toBe("pass");
    expect(judgeRejection({ ...strict, status: 404, error: "NOT_FOUND Producto no encontrado." }).verdict).toBe("pass");
    const raw = judgeRejection({ ...strict, status: 400, error: 'BAD_REQUEST null value in column "current_stock" of relation "products" violates not-null constraint' });
    expect(raw.verdict).toBe("fail");
    expect(raw.detail).toContain("error crudo de Postgres");
    expect(judgeRejection({ ...strict, status: 500, error: "INTERNAL_ERROR x" }).verdict).toBe("fail");
    expect(judgeRejection({ ...strict, status: 200 }).verdict).toBe("fail");
    const generic = judgeRejection({ ...strict, status: 400, error: "BAD_REQUEST Los datos enviados no son validos." });
    expect(generic.verdict).toBe("finding");
    expect(generic.detail).toContain("mensaje genérico");
    expect(judgeRejection({ ...strict, status: 409, error: "CONFLICT x", newMovements: 1 }).verdict).toBe("fail");
  });

  it("pass: 200 sin filas cuando RLS filtra (allow2xxWithoutEffect)", () => {
    expect(judgeRejection({ ...base, status: 200, allow2xxWithoutEffect: true }).verdict).toBe("pass");
  });

  it("fail: cualquier movimiento o cambio de stock, sea cual sea el código", () => {
    expect(judgeRejection({ ...base, status: 400, newMovements: 1 }).verdict).toBe("fail");
    expect(judgeRejection({ ...base, status: 200, allow2xxWithoutEffect: true, stockDelta: 989 }).verdict).toBe("fail");
    expect(judgeRejection({ ...base, status: 403, expectedStatuses: [403], stockDelta: 5 }).verdict).toBe("fail");
  });

  it("isRawDbError / isDeadlock", () => {
    expect(isRawDbError("duplicate key value violates unique constraint")).toBe(true);
    expect(isRawDbError("Producto no encontrado")).toBe(false);
    expect(isRawDbError(undefined)).toBe(false);
    expect(isDeadlock("INTERNAL_ERROR deadlock detected")).toBe(true);
    expect(isDeadlock("BAD_REQUEST stock insuficiente")).toBe(false);
    expect(isDeadlock(null)).toBe(false);
  });
});

describe("judgeConversion (9.6)", () => {
  const base = { status: 201, packQuantity: 2, candidates: [12, 24], conversionMovements: 2, packMovementDelta: -2, packStockDelta: -2 };

  it("pass: par coherente con cualquiera de los valores vigentes", () => {
    expect(judgeConversion({ ...base, responseUnitsPerPack: 12, unitMovementDelta: 24, unitStockDelta: 24 }).detail).toContain("units_per_pack=12");
    expect(judgeConversion({ ...base, responseUnitsPerPack: 24, unitMovementDelta: 48, unitStockDelta: 48 }).verdict).toBe("pass");
    expect(judgeConversion({ ...base, responseUnitsPerPack: null, unitMovementDelta: 48, unitStockDelta: 48 }).verdict).toBe("pass");
  });

  it("fail: mezcla de valores, respuesta distinta de los movimientos o stock que no sigue al movimiento", () => {
    expect(judgeConversion({ ...base, responseUnitsPerPack: 12, unitMovementDelta: 36, unitStockDelta: 36 }).verdict).toBe("fail");
    expect(judgeConversion({ ...base, responseUnitsPerPack: 24, unitMovementDelta: 24, unitStockDelta: 24 }).verdict).toBe("fail");
    expect(judgeConversion({ ...base, responseUnitsPerPack: 12, unitMovementDelta: 24, unitStockDelta: 48 }).verdict).toBe("fail");
    expect(judgeConversion({ ...base, conversionMovements: 1, responseUnitsPerPack: 12, unitMovementDelta: 24, unitStockDelta: 24 }).verdict).toBe("fail");
  });

  it("rechazo: finding sin efecto, fail con efecto", () => {
    const rejected = { ...base, status: 500, error: "INTERNAL_ERROR x", responseUnitsPerPack: null, conversionMovements: 0, packMovementDelta: 0, unitMovementDelta: 0 };
    expect(judgeConversion({ ...rejected, packStockDelta: 0, unitStockDelta: 0 }).verdict).toBe("finding");
    expect(judgeConversion({ ...rejected, packStockDelta: -2, unitStockDelta: 0 }).verdict).toBe("fail");
  });
});

describe("judgeReverseOrder (9.10)", () => {
  const lines = 3;

  it("pass: las dos ventas pasan", () => {
    expect(judgeReverseOrder({ statuses: [201, 201], errors: [], lines, stockDeltas: [-2, -2, -2], sales: 2, saleMovements: 6, activePayments: 2 }).verdict).toBe("pass");
  });

  it("fail: deadlock con rollback limpio (el plan pide sin deadlock o reintento)", () => {
    const j = judgeReverseOrder({ statuses: [500, 201], errors: ["INTERNAL_ERROR deadlock detected", undefined], lines, stockDeltas: [-1, -1, -1], sales: 1, saleMovements: 3, activePayments: 1 });
    expect(j.verdict).toBe("fail");
    expect(j.detail).toContain("Deadlock sin reintento: 1 de 2");
    expect(j.detail).toContain("rollback limpio");
  });

  it("fail: rollback parcial", () => {
    const j = judgeReverseOrder({ statuses: [500, 201], errors: ["INTERNAL_ERROR deadlock detected", undefined], lines, stockDeltas: [-2, -1, -1], sales: 1, saleMovements: 4, activePayments: 1 });
    expect(j.verdict).toBe("fail");
    expect(j.detail).toContain("Rollback parcial");
  });

  it("pass: la perdedora recibe el 409 reintentable del BFF (40P01) con rollback limpio", () => {
    const j = judgeReverseOrder({
      statuses: [409, 201],
      errors: ["CONFLICT La operacion choco con otra en curso y no se aplico. Intenta de nuevo.", undefined],
      lines,
      stockDeltas: [-1, -1, -1],
      sales: 1,
      saleMovements: 3,
      activePayments: 1,
    });
    expect(j.verdict).toBe("pass");
    expect(j.detail).toContain("409 reintentable");
  });

  it("fail: 5xx aunque no mencione deadlock (nunca 500)", () => {
    const j = judgeReverseOrder({ statuses: [500, 201], errors: ["INTERNAL_ERROR x", undefined], lines, stockDeltas: [-1, -1, -1], sales: 1, saleMovements: 3, activePayments: 1 });
    expect(j.verdict).toBe("fail");
    expect(j.detail).toContain("error no controlado");
  });

  it("finding: rechazo que no es deadlock, con rollback limpio", () => {
    expect(judgeReverseOrder({ statuses: [409, 201], errors: ["CONFLICT El recurso ya existe.", undefined], lines, stockDeltas: [-1, -1, -1], sales: 1, saleMovements: 3, activePayments: 1 }).verdict).toBe("finding");
  });
});

describe("judgeAbortRetry (9.8)", () => {
  const base = { committedWithoutResponse: true, originalId: "s1", quantity: 1 };

  it("error si la venta no quedó confirmada (precondición)", () => {
    expect(judgeAbortRetry({ ...base, mode: "same_key", committedWithoutResponse: false, retryStatus: 0, retryId: null, sales: 0, saleMovements: 0, activePayments: 0, stockDelta: 0 }).verdict).toBe("error");
  });

  it("misma clave: pass si devuelve la misma venta; finding si responde otra cosa; fail si duplica", () => {
    const one = { sales: 1, saleMovements: 1, activePayments: 1, stockDelta: -1 };
    expect(judgeAbortRetry({ ...base, mode: "same_key", retryStatus: 201, retryId: "s1", ...one }).verdict).toBe("pass");
    expect(judgeAbortRetry({ ...base, mode: "same_key", retryStatus: 409, retryId: null, retryError: "CONFLICT", ...one }).verdict).toBe("finding");
    expect(judgeAbortRetry({ ...base, mode: "same_key", retryStatus: 201, retryId: "s2", sales: 2, saleMovements: 2, activePayments: 2, stockDelta: -2 }).verdict).toBe("fail");
  });

  it("clave nueva: el duplicado se documenta como finding; rechazo = pass; resto fail", () => {
    const dup = judgeAbortRetry({ ...base, mode: "new_key", retryStatus: 201, retryId: "s2", sales: 2, saleMovements: 2, activePayments: 2, stockDelta: -2 });
    expect(dup.verdict).toBe("finding");
    expect(dup.detail).toContain("clave NUEVA duplica");
    expect(judgeAbortRetry({ ...base, mode: "new_key", retryStatus: 409, retryId: null, sales: 1, saleMovements: 1, activePayments: 1, stockDelta: -1 }).verdict).toBe("pass");
    expect(judgeAbortRetry({ ...base, mode: "new_key", retryStatus: 201, retryId: "s2", sales: 2, saleMovements: 1, activePayments: 2, stockDelta: -1 }).verdict).toBe("fail");
  });
});

describe("judgeDeactivatedSale (9.11) y judgeSoftCategory (9.12)", () => {
  const base = { initialStock: 10, quantity: 2 };

  it("pagar: pass / fail si se rechaza / fail si incoherente", () => {
    expect(judgeDeactivatedSale({ ...base, action: "pay", status: 201, saleStatus: "pagada", stock: 8, reversalMovements: 0, activePayments: 1 }).verdict).toBe("pass");
    const rejected = judgeDeactivatedSale({ ...base, action: "pay", status: 400, error: "BAD_REQUEST inactivo", saleStatus: "pendiente_pago", stock: 8, reversalMovements: 0, activePayments: 0 });
    expect(rejected.verdict).toBe("fail");
    expect(rejected.detail).toContain("No se puede pagar");
    expect(judgeDeactivatedSale({ ...base, action: "pay", status: 201, saleStatus: "pendiente_pago", stock: 8, reversalMovements: 0, activePayments: 1 }).verdict).toBe("fail");
  });

  it("cancelar: pass / fail si se rechaza / fail si el stock no vuelve", () => {
    expect(judgeDeactivatedSale({ ...base, action: "cancel", status: 200, saleStatus: "cancelada", stock: 10, reversalMovements: 1, activePayments: 0 }).verdict).toBe("pass");
    expect(judgeDeactivatedSale({ ...base, action: "cancel", status: 404, saleStatus: "pendiente_pago", stock: 8, reversalMovements: 0, activePayments: 0 }).detail).toContain("No se puede cancelar");
    expect(judgeDeactivatedSale({ ...base, action: "cancel", status: 200, saleStatus: "cancelada", stock: 8, reversalMovements: 0, activePayments: 0 }).verdict).toBe("fail");
  });

  it("categoría borrada: funciona, falla limpio, 500 sin efecto, o huérfano", () => {
    const sold = { deleteStatus: 200, quantity: 1, sales: 1, saleMovements: 1, stockDelta: -1 };
    const none = { deleteStatus: 200, quantity: 1, sales: 0, saleMovements: 0, stockDelta: 0 };
    expect(judgeSoftCategory({ ...sold, saleHttpStatus: 201 }).verdict).toBe("pass");
    expect(judgeSoftCategory({ ...none, saleHttpStatus: 400, error: "BAD_REQUEST categoría inactiva" }).verdict).toBe("pass");
    expect(judgeSoftCategory({ ...none, saleHttpStatus: 500, error: "INTERNAL_ERROR x" }).verdict).toBe("finding");
    expect(judgeSoftCategory({ ...none, saleMovements: 1, stockDelta: -1, saleHttpStatus: 500 }).verdict).toBe("fail");
    expect(judgeSoftCategory({ ...sold, saleMovements: 0, saleHttpStatus: 201 }).verdict).toBe("fail");
  });
});

describe("chainConsistent", () => {
  const m = (quantity_delta: number, stock_after: number) => ({ quantity_delta, stock_after });

  it("sin movimientos solo cuadra con stock 0", () => {
    expect(chainConsistent([], 0)).toBe(true);
    expect(chainConsistent([], 3)).toBe(false);
  });

  it("acepta una cadena válida en cualquier orden de filas", () => {
    const chain = [m(10, 10), m(-2, 8), m(-3, 5), m(5, 10), m(-10, 0), m(4, 4)];
    expect(chainConsistent(chain, 4)).toBe(true);
    expect(chainConsistent([...chain].reverse(), 4)).toBe(true);
  });

  it("acepta una cadena que termina en 0 (circuito)", () => {
    expect(chainConsistent([m(5, 5), m(-5, 0)], 0)).toBe(true);
  });

  it("rechaza si el stock final no es el del último eslabón", () => {
    expect(chainConsistent([m(10, 10), m(-2, 8)], 10)).toBe(false);
    expect(chainConsistent([m(10, 10), m(-2, 8)], 7)).toBe(false);
  });

  it("rechaza un hueco: update directo de current_stock sin movimiento (G1)", () => {
    // 0→10, [escritura directa +7], 17→18
    expect(chainConsistent([m(10, 10), m(1, 18)], 18)).toBe(false);
  });

  it("rechaza dos movimientos que parten del mismo stock (lectura sin lock)", () => {
    // ambos leyeron 10 y escribieron 8: se pierde una venta
    expect(chainConsistent([m(10, 10), m(-2, 8), m(-2, 8)], 8)).toBe(false);
  });

  it("rechaza un ciclo desconectado del origen", () => {
    expect(chainConsistent([m(10, 10), m(5, 55), m(-5, 50)], 10)).toBe(false);
  });

  it("escala a miles de movimientos", () => {
    const many = Array.from({ length: 20000 }, (_, i) => m(1, i + 1));
    expect(chainConsistent(many, 20000)).toBe(true);
    expect(chainConsistent(many, 19999)).toBe(false);
  });
});

describe("integridad y agregación", () => {
  it("integrityProblems ignora stock_chain_breaks (G9) y usa chain_inconsistent", () => {
    const scoped = emptyScoped();
    scoped.stock_chain_breaks = 3;
    expect(integrityProblems(scoped)).toEqual([]);
    scoped.chain_inconsistent = 1;
    scoped.stock_reconciliation = 2;
    scoped.conversion_mismatches = 1;
    expect(integrityProblems(scoped)).toEqual(["stock_reconciliation=2", "conversion_mismatches=1", "chain_inconsistent=1"]);
    expect(integrityProblems(scoped, ["conversion_mismatches"])).toEqual(["stock_reconciliation=2", "chain_inconsistent=1"]);
  });

  it("addScoped suma vista a vista", () => {
    const a = emptyScoped();
    a.negative_stock = 1;
    const b = emptyScoped();
    b.negative_stock = 2;
    b.chain_inconsistent = 1;
    const sum = addScoped(a, b);
    expect(sum.negative_stock).toBe(3);
    expect(sum.chain_inconsistent).toBe(1);
    expect(addScoped(a, null)).toBe(a);
  });

  it("applyIntegrity convierte pass/finding en fail si las vistas no están en 0", () => {
    const dirty = emptyScoped();
    dirty.stock_reconciliation = 1;
    expect(applyIntegrity({ verdict: "pass", detail: "ok." }, dirty)).toEqual({
      verdict: "fail",
      detail: "ok. Vistas de integridad sobre los productos del caso: stock_reconciliation=1.",
    });
    expect(applyIntegrity({ verdict: "finding", detail: "x" }, dirty).verdict).toBe("fail");
    expect(applyIntegrity({ verdict: "error", detail: "x" }, dirty).verdict).toBe("error");
    expect(applyIntegrity({ verdict: "pass", detail: "ok" }, emptyScoped()).verdict).toBe("pass");
  });

  it("aggregateAttempts: el peor manda y el detalle lleva k de N", () => {
    const agg = aggregateAttempts([
      { verdict: "pass", detail: "bien" },
      { verdict: "fail", detail: "doble venta" },
      { verdict: "finding", detail: "500" },
      { verdict: "fail", detail: "otra" },
    ]);
    expect(agg.verdict).toBe("fail");
    expect(agg.sampleIndex).toBe(1);
    expect(agg.counts).toEqual({ pass: 1, fail: 2, finding: 1, error: 0, skip: 0 });
    expect(agg.detail).toBe("fail 2 de 4 · finding 1 de 4 · pass 1 de 4. doble venta");
  });

  it("aggregateAttempts: error gana a finding y pass; sin intentos = error", () => {
    expect(aggregateAttempts([{ verdict: "pass", detail: "" }, { verdict: "error", detail: "no arrancó" }, { verdict: "finding", detail: "f" }]).verdict).toBe("error");
    expect(aggregateAttempts([{ verdict: "pass", detail: "a" }, { verdict: "pass", detail: "b" }]).detail).toBe("pass 2 de 2. a");
    expect(aggregateAttempts([]).verdict).toBe("error");
  });

  it("slimSteps quita request/response y conserva error y aborted", () => {
    expect(
      slimSteps([{ op: "POST /api/sales", as: "vendedor1", status: 0, response_id: null, ms: 700, error: "TimeoutError", aborted: true, request: { a: 1 }, response: null }]),
    ).toEqual([{ op: "POST /api/sales", as: "vendedor1", status: 0, response_id: null, ms: 700, error: "TimeoutError", aborted: true }]);
  });
});

describe("payloads", () => {
  const rate = { id: "rate-1", rateVes: 50 };

  it("saleBody sin opciones lleva una clientRequestId nueva (uuid) en cada llamada y ningún pago", () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const lines = [{ productId: "p1", quantity: 2, price: 1.5 }];
    const a = saleBody("c1", rate, lines);
    const b = saleBody("c1", rate, lines, { notes: "x" });
    expect(a.clientRequestId).toMatch(UUID);
    expect(b.clientRequestId).toMatch(UUID);
    expect(a.clientRequestId).not.toBe(b.clientRequestId);
    expect(a).not.toHaveProperty("payments");
  });

  it("saleBody con key null es el envío SIN clave (9.1.no_key_*): ni clientRequestId ni payments", () => {
    const body = saleBody("c1", rate, [{ productId: "p1", quantity: 2, price: 1.5 }], { key: null });
    expect(body).toEqual({
      customerId: "c1",
      exchangeRateId: "rate-1",
      refRateVes: 50,
      items: [{ productId: "p1", quantity: 2, unitPriceRef: 1.5 }],
      taxRef: 0,
      discountRef: 0,
      notes: "Lab C411",
    });
  });

  it("saleBody con clave y pago: efectivo USD por el total redondeado", () => {
    const body = saleBody("c1", rate, [{ productId: "p1", quantity: 3, price: 1.1 }, { productId: "p2", quantity: 1, price: 0.2 }], { key: "k", paid: true });
    expect(body.clientRequestId).toBe("k");
    expect(body.payments).toEqual([{ method: "efectivo_usd", currency: "USD", amount: 3.5 }]);
  });

  it("purchaseBody calcula subtotales en ref y Bs con la tasa", () => {
    const body = purchaseBody("s1", rate, [{ productId: "p1", quantity: 7, cost: 0.5 }], "pedido");
    expect(body.status).toBe("pedido");
    expect(body.subtotalRef).toBe(3.5);
    expect(body.subtotalVes).toBe(175);
    expect(body.items).toEqual([
      { entryMode: "unit", productId: "p1", quantity: 7, unitCostRef: 0.5, unitCostVes: 25, costCurrency: "ref", taxRate: 0, taxRef: 0, taxVes: 0, subtotalRef: 3.5, subtotalVes: 175 },
    ]);
  });
});

describe("markdown y conteos", () => {
  const line = (id: string, verdict: ChaosLine["verdict"], detail: string): ChaosLine => ({
    ts: "2026-10-06T00:00:00.000Z",
    suite: "chaos",
    id,
    title: `caso ${id}`,
    severity: "Alta",
    hypothesis: [],
    steps: [],
    expected: { plan: "Una venta | un movimiento" },
    actual: { attempts: 10 },
    reconcile_scoped: null,
    reconcile_global: null,
    verdict,
    detail,
    evidence: [],
  });

  it("latestById se queda con la última línea de cada id", () => {
    const rows = latestById([line("9.1", "fail", "viejo"), line("9.2", "pass", ""), line("9.1", "pass", "nuevo")]);
    expect(rows.map((r) => [r.id, r.detail])).toEqual([["9.1", "nuevo"], ["9.2", ""]]);
  });

  it("renderChaosMarkdown: una fila por id, resumen y pipes escapados", () => {
    const md = renderChaosMarkdown("r1", [line("9.1", "fail", "a | b\nc"), line("9.2", "pass", "")]);
    expect(md).toContain("run `r1`");
    expect(md).toContain("Resumen: pass=1 fail=1 finding=0 error=0 skip=0");
    expect(md).toContain("| 9.1 | caso 9.1 | Alta | Una venta \\| un movimiento | **fail** | 10 | a \\| b c |");
    expect(md.split("\n").filter((l) => l.startsWith("| 9."))).toHaveLength(2);
  });

  it("countVerdicts", () => {
    expect(countVerdicts([{ verdict: "pass" }, { verdict: "skip" }, { verdict: "pass" }])).toEqual({ pass: 2, fail: 0, finding: 0, error: 0, skip: 1 });
  });
});
