/**
 * @jest-environment node
 *
 * STK-514: los casos que prueban a propósito `POST /api/sales` SIN
 * `clientRequestId` siguen en el catálogo y ahora esperan «400 en todas, 0
 * ventas, 0 movimientos». Sin red ni base: un BFF falso en memoria que exige
 * la clave (sano) o la ignora (el bug del 29-ago).
 */
import type { ApiResponse } from "../../e2e-bodegon/client";
import type { CaseCtx, Lab } from "./db";
import { HYPOTHESIS_CASES } from "./hypotheses";
import { ONESHOT_CASES } from "./oneshots";

type FakeSale = { id: string; key: string | null; quantity: number };

function fakeBff(requireKey: boolean): { lab: Lab; t: CaseCtx; sales: FakeSale[]; sent: Array<string | null> } {
  let stock = 0;
  const sales: FakeSale[] = [];
  const sent: Array<string | null> = [];
  const response = (status: number, data?: unknown): ApiResponse =>
    ({
      ok: status < 300,
      status,
      body: status < 300 ? { data } : { error: { code: "BAD_REQUEST", message: "clientRequestId es obligatorio" } },
    }) as unknown as ApiResponse;
  const t = {
    ensureCash: async () => undefined,
    product: async (_name: string, initial: number) => {
      stock = initial;
      return { id: "prod-1" };
    },
    sale: async (_as: string, lines: ReadonlyArray<{ quantity: number }>, options: { clientRequestId?: string | null } = {}) => {
      const key = options.clientRequestId ?? null;
      sent.push(key);
      if (key === null && requireKey) return response(400);
      const known = key === null ? undefined : sales.find((sale) => sale.key === key);
      if (known) return response(201, { id: known.id });
      const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
      stock -= quantity;
      const sale = { id: `sale-${sales.length + 1}`, key, quantity };
      sales.push(sale);
      return response(201, { id: sale.id });
    },
  };
  const lab = {
    rate: async () => ({ id: "rate-1", rateVes: 52 }),
    stock: async () => stock,
    rows: async () => sales.map((sale) => ({ id: sale.id, status: "pendiente_pago" })),
    movements: async () => sales.map((sale) => ({ id: `mov-${sale.id}`, type: "venta", quantity_delta: -sale.quantity })),
  };
  return { lab: lab as unknown as Lab, t: t as unknown as CaseCtx, sales, sent };
}

function caseById(id: string) {
  const found = [...HYPOTHESIS_CASES, ...ONESHOT_CASES].find((def) => def.id === id);
  if (!found) throw new Error(`falta el caso ${id}`);
  return found;
}

describe("casos que envían la venta SIN clientRequestId", () => {
  it("h08.no_client_request_id: pass si las 4 responden 400 y no hay venta ni movimiento", async () => {
    const bff = fakeBff(true);
    const out = await caseById("h08.no_client_request_id").run(bff.lab, bff.t);
    expect(out.verdict).toBe("pass");
    expect(bff.sent).toEqual([null, null, null, null]);
    expect(out.expected).toMatchObject({ statuses: [400, 400, 400, 400], stock: 10, ventas: 0, movimientos_venta: 0 });
    expect(bff.sales).toHaveLength(0);
  });

  it("h08.no_client_request_id: fail si alguna crea venta", async () => {
    const bff = fakeBff(false);
    const out = await caseById("h08.no_client_request_id").run(bff.lab, bff.t);
    expect(out.verdict).toBe("fail");
    expect(out.detail).toContain("los 4 POST sin clientRequestId responden 400");
    expect(out.detail).toContain("ventas creadas");
  });

  it("os.20260830.symptom: pass si los 4 reintentos sin clave responden 400 y con clave se vende una sola vez", async () => {
    const bff = fakeBff(true);
    const out = await caseById("os.20260830.symptom").run(bff.lab, bff.t);
    expect(out.verdict).toBe("pass");
    expect(bff.sent.slice(0, 4)).toEqual([null, null, null, null]);
    // Los 3 reintentos del POS comparten clave → una sola venta.
    expect(new Set(bff.sent.slice(4)).size).toBe(1);
    expect(bff.sent[4]).not.toBeNull();
    expect(bff.sales).toHaveLength(1);
    expect(out.expected).toMatchObject({ sin_clave: { stock: 20, pendientes: 0 }, con_clave: { descuento: 3, ventas: 1 } });
  });

  it("os.20260830.symptom: fail si un reintento sin clave crea venta (síntoma del 29-ago)", async () => {
    const bff = fakeBff(false);
    const out = await caseById("os.20260830.symptom").run(bff.lab, bff.t);
    expect(out.verdict).toBe("fail");
    expect(out.detail).toContain("los 4 reintentos sin clave responden 400");
  });
});
