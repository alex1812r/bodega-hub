/** @jest-environment node */
/**
 * Lógica pura de los escenarios `pack.receive_disassemble_*` (COM-14): el payload de la compra y el catálogo de casos.
 * Sin base ni red. Los escenarios en sí corren con `npm run stock-lab:scenarios -- --suite hypotheses`.
 */
import { ASSORTED_PACK_CASES } from "./assorted-pack";
import { HYPOTHESIS_CASES } from "./hypotheses";
import { RECEIVE_DISASSEMBLE_CASES, toOrderItems } from "./receive-disassemble";

describe("toOrderItems", () => {
  it("la marca solo viaja cuando es true: la línea sin marca es el payload de siempre", () => {
    const [marked, plain, off] = toOrderItems([
      { product: { id: "a", sku: "a" }, quantity: 3, costRef: 9, disassemble: true },
      { product: { id: "b", sku: "b" }, quantity: 5, costRef: 2 },
      { product: { id: "c", sku: "c" }, quantity: 1, costRef: 1, disassemble: false },
    ]);

    expect(marked).toMatchObject({ product_id: "a", quantity: 3, subtotal_ref: 27, subtotal_ves: 2700, disassemble_on_receive: true });
    expect(Object.keys(plain ?? {})).not.toContain("disassemble_on_receive");
    expect(Object.keys(off ?? {})).not.toContain("disassemble_on_receive");
  });
});

describe("catálogo pack.receive_disassemble_*", () => {
  const ids = RECEIVE_DISASSEMBLE_CASES.map((c) => c.id);

  it("ids únicos con su prefijo que no chocan con los de hipótesis ni con los de surtidos", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^pack\.receive_disassemble_[a-z0-9_]+$/);
    expect([...HYPOTHESIS_CASES, ...ASSORTED_PACK_CASES].map((c) => c.id).filter((id) => ids.includes(id))).toEqual([]);
  });

  it("cubre el escenario del ticket COM-14 «compra con desarmar al recibir»", () => {
    expect(ids).toEqual([
      "pack.receive_disassemble_order",
      "pack.receive_disassemble_created_received",
      "pack.receive_disassemble_parallel",
      "pack.receive_disassemble_double_submit",
    ]);
  });
});
