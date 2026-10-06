/**
 * @jest-environment node
 *
 * STK-603: esperados de `h08.dg5_double_submit*` y `h06.dg7_deadlock` tras la
 * fase 5 (clave de idempotencia opcional en compras/ajustes/conversiones; una
 * RPC = una transacción). Lógica pura, sin red ni base.
 */
import { buildAdjustBody, buildPurchaseBody } from "./db";
import { HYPOTHESIS_CASES, judgeCrossedSales, judgeDoubleSubmit } from "./hypotheses";

const KEY = "0b0f8c0e-6a55-4c3f-9d0e-2f6a7d1c9e11";

describe("payloads con clave de idempotencia (db.ts)", () => {
  const options = { supplierId: "s", status: "recibido" as const, exchangeRateId: null, rateVes: 52 };

  it("buildPurchaseBody envía clientRequestId solo si se pasa", () => {
    expect(buildPurchaseBody([{ productId: "p", quantity: 4 }], { ...options, clientRequestId: KEY }).clientRequestId).toBe(KEY);
    expect(buildPurchaseBody([{ productId: "p", quantity: 4 }], options)).not.toHaveProperty("clientRequestId");
  });

  it("buildAdjustBody envía clientRequestId y el documento de la devolución solo si se pasan", () => {
    expect(buildAdjustBody({ productId: "p", quantityDelta: 3, reason: "r", clientRequestId: KEY })).toEqual({
      productId: "p",
      quantityDelta: 3,
      reason: "r",
      clientRequestId: KEY,
    });
    expect(buildAdjustBody({ productId: "p", quantityDelta: 1, type: "devolucion_cliente", reason: "r", saleId: "v" })).toEqual({
      productId: "p",
      quantityDelta: 1,
      type: "devolucion_cliente",
      reason: "r",
      saleId: "v",
    });
    expect(buildAdjustBody({ productId: "p", quantityDelta: -1, type: "devolucion_proveedor", reason: "r", purchaseId: "c" })).toMatchObject({ purchaseId: "c" });
    const bare = buildAdjustBody({ productId: "p", quantityDelta: 3, reason: "r" });
    expect(Object.keys(bare).sort()).toEqual(["productId", "quantityDelta", "reason"]);
  });
});

describe("judgeDoubleSubmit (h08.dg5)", () => {
  const twice = { op: "compra", statuses: [201, 201], expectedMovements: 1 };

  it("con la MISMA clave: una sola operación (mismo id, 1 movimiento) → sin fallos ni hallazgos", () => {
    expect(judgeDoubleSubmit({ ...twice, keyed: true, ids: ["a", "a"], movements: 1 })).toEqual({ failures: [], findings: [] });
  });

  it("con la MISMA clave: ids distintos, movimiento duplicado o un no-2xx son fallo", () => {
    const duplicated = judgeDoubleSubmit({ ...twice, keyed: true, ids: ["a", "b"], movements: 2 });
    expect(duplicated.failures.join(" | ")).toContain("ids distintos");
    expect(duplicated.failures.join(" | ")).toContain("2 movimiento(s)");
    expect(judgeDoubleSubmit({ ...twice, keyed: true, statuses: [201, 500], ids: ["a", null], movements: 1 }).failures).toHaveLength(2);
    expect(judgeDoubleSubmit({ ...twice, keyed: true, ids: [null, null], movements: 1 }).failures).toHaveLength(1);
  });

  it("SIN clave: el duplicado es un finding documentado (clave opcional por contrato), nunca fail", () => {
    const out = judgeDoubleSubmit({ ...twice, keyed: false, ids: ["a", "b"], movements: 2 });
    expect(out.failures).toEqual([]);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toContain("sin clientRequestId");
    expect(out.findings[0]).toContain("opcional por contrato");
  });

  it("SIN clave: si el servidor deduplicara no hay hallazgo; un estado incoherente o un 5xx sí es fallo", () => {
    expect(judgeDoubleSubmit({ ...twice, keyed: false, ids: ["a", "a"], movements: 1 })).toEqual({ failures: [], findings: [] });
    expect(judgeDoubleSubmit({ ...twice, keyed: false, ids: ["a", "b"], movements: 3 }).failures).toHaveLength(1);
    expect(judgeDoubleSubmit({ ...twice, keyed: false, statuses: [201, 500], ids: ["a", null], movements: 1 }).failures).toHaveLength(1);
  });

  it("el catálogo separa el envío con clave del envío sin clave", () => {
    const ids = HYPOTHESIS_CASES.map((c) => c.id);
    expect(ids).toContain("h08.dg5_double_submit");
    expect(ids).toContain("h08.dg5_double_submit_no_key");
    expect(HYPOTHESIS_CASES.find((c) => c.id === "h08.dg5_double_submit")?.title).toMatch(/MISMA clientRequestId/);
    expect(HYPOTHESIS_CASES.find((c) => c.id === "h08.dg5_double_submit_no_key")?.title).toMatch(/SIN clientRequestId/);
  });
});

describe("judgeCrossedSales (h06.dg7: ventas cruzadas [A,B]/[B,A] por HTTP)", () => {
  const ok = { status: 201, error: "" };

  it("todas 201 → sin fallos", () => {
    expect(judgeCrossedSales([ok, ok, ok, ok])).toEqual({ failures: [], accepted: 4, rejected: 0 });
  });

  it("un rechazo de negocio 4xx con mensaje no es fallo", () => {
    const out = judgeCrossedSales([ok, { status: 409, error: "CONFLICT No hay stock suficiente" }]);
    expect(out).toEqual({ failures: [], accepted: 1, rejected: 1 });
  });

  it("el 409 reintentable del BFF (así sale un 40P01/40001) cuenta como deadlock, no como rechazo de negocio", () => {
    const out = judgeCrossedSales([ok, { status: 409, error: "CONFLICT La operación chocó con otra en curso. Intenta de nuevo." }]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toContain("40P01");
  });

  it("40P01 / deadlock, 5xx, sin respuesta o 4xx sin mensaje son fallo", () => {
    expect(judgeCrossedSales([ok, { status: 500, error: "INTERNAL_ERROR deadlock detected" }]).failures).toHaveLength(1);
    expect(judgeCrossedSales([{ status: 409, error: "CONFLICT 40P01 deadlock detected" }]).failures[0]).toContain("deadlock");
    expect(judgeCrossedSales([{ status: 0, error: "" }]).failures).toHaveLength(1);
    expect(judgeCrossedSales([{ status: 400, error: "" }]).failures).toHaveLength(1);
  });

  it("el caso h06.dg7 ya no anuncia una prueba SQL", () => {
    const def = HYPOTHESIS_CASES.find((c) => c.id === "h06.dg7_deadlock");
    expect(def?.title).toMatch(/HTTP/);
    expect(def?.title).not.toMatch(/SQL/);
  });
});
