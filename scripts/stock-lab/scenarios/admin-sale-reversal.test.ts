/** @jest-environment node */
/**
 * Lógica pura del escenario `sale.admin_cancel_return_switch_off` (DEC-02): el resumen del impact y el catálogo.
 * Sin base ni red. El escenario corre con `npm run stock-lab:scenarios -- --suite hypotheses`.
 */
import { ADMIN_SALE_REVERSAL_CASES, ADMIN_SALE_REVERSAL_ID, summarizeImpact } from "./admin-sale-reversal";
import { ASSORTED_PACK_CASES } from "./assorted-pack";
import { HYPOTHESIS_CASES } from "./hypotheses";
import { RECEIVE_DISASSEMBLE_CASES } from "./receive-disassemble";

describe("summarizeImpact", () => {
  it("suma por cubeta del baúl los asientos que se revierten y cuenta los de caja", () => {
    const summary = summarizeImpact({
      allowed: true,
      document: { status: "pagada", statusAfter: "devuelta" },
      paidVesAfter: 0,
      payments: [
        {
          effects: [
            { delta: -10, target: "caja" },
            { delta: -500.1, target: "baul_cuenta" },
          ],
          outcome: "reverted",
          paymentId: "p1",
          statusAfter: "anulado",
        },
        {
          effects: [
            { delta: -0.2, target: "baul_cuenta" },
            { delta: -3, target: "baul_ref" },
          ],
          outcome: "reverted",
          paymentId: "p2",
          statusAfter: "anulado",
        },
      ],
      reason: null,
      stock: [{ productId: "a", quantityDelta: 4, stockAfter: 20 }],
    });

    expect(summary).toEqual({
      allowed: true,
      cashEffects: 1,
      paidVesAfter: 0,
      payments: [
        { outcome: "reverted", paymentId: "p1", statusAfter: "anulado" },
        { outcome: "reverted", paymentId: "p2", statusAfter: "anulado" },
      ],
      reason: null,
      statusAfter: "devuelta",
      stock: [{ productId: "a", quantityDelta: 4, stockAfter: 20 }],
      vaultDelta: { baul_cuenta: -500.3, baul_efectivo_ves: 0, baul_ref: -3 },
    });
  });

  it("un rechazo no proyecta nada y conserva el motivo", () => {
    const summary = summarizeImpact({
      allowed: false,
      document: { status: "pagada", statusAfter: "pagada" },
      paidVesAfter: 100,
      payments: [{ effects: [], outcome: "blocks_action", paymentId: "p1", statusAfter: "activo" }],
      reason: "La venta tiene 1 pago(s) activo(s)",
      stock: [{ productId: "a", quantityDelta: 0, stockAfter: 5 }],
    });

    expect(summary.allowed).toBe(false);
    expect(summary.reason).toBe("La venta tiene 1 pago(s) activo(s)");
    expect(summary.cashEffects).toBe(0);
    expect(summary.vaultDelta).toEqual({ baul_cuenta: 0, baul_efectivo_ves: 0, baul_ref: 0 });
  });
});

describe("catálogo sale.admin_*", () => {
  it("un caso, con un id que no choca con los demás de la suite", () => {
    const ids = ADMIN_SALE_REVERSAL_CASES.map((c) => c.id);

    expect(ids).toEqual([ADMIN_SALE_REVERSAL_ID]);
    expect(
      [...HYPOTHESIS_CASES, ...ASSORTED_PACK_CASES, ...RECEIVE_DISASSEMBLE_CASES].map((c) => c.id).filter((id) => ids.includes(id)),
    ).toEqual([]);
  });
});
