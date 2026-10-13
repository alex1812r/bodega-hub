import { movementDocumentKindOptions, resolveMovementDocument } from "./movementDocument";

describe("resolveMovementDocument", () => {
  it("uses the sale or purchase number and links to its detail", () => {
    expect(
      resolveMovementDocument({ documentKind: "venta", documentNumber: "V-0001", saleId: "s-1" }),
    ).toEqual({ href: "/sales/s-1", kind: "venta", label: "V-0001" });
    expect(
      resolveMovementDocument({
        documentKind: "compra",
        documentNumber: "C-0007",
        purchaseId: "p-7",
      }),
    ).toEqual({ href: "/purchases/p-7", kind: "compra", label: "C-0007" });
  });

  it("says 'Conversión de empaque' for a conversion, without a link", () => {
    expect(
      resolveMovementDocument({ conversionId: "conv-1", documentKind: "conversion" }),
    ).toEqual({ kind: "conversion", label: "Conversión de empaque" });
  });

  it("says 'Ajuste manual' when the movement has no document", () => {
    expect(resolveMovementDocument({ documentKind: null, documentNumber: null })).toEqual({
      kind: null,
      label: "Ajuste manual",
    });
    expect(resolveMovementDocument({})).toEqual({ kind: null, label: "Ajuste manual" });
  });

  it("shows the document type when the number did not come, never 'Ajuste manual'", () => {
    expect(
      resolveMovementDocument({ documentKind: "venta", documentNumber: null, saleId: "s-1" }),
    ).toEqual({ href: "/sales/s-1", kind: "venta", label: "Venta" });
    expect(resolveMovementDocument({ documentKind: "compra", purchaseId: "p-7" })).toEqual({
      href: "/purchases/p-7",
      kind: "compra",
      label: "Compra",
    });
  });

  it("derives the document from the links when documentKind does not come (stock card)", () => {
    expect(resolveMovementDocument({ saleId: "s-1" }).kind).toBe("venta");
    expect(resolveMovementDocument({ purchaseId: "p-7" }).kind).toBe("compra");
    expect(resolveMovementDocument({ conversionId: "conv-1" }).label).toBe(
      "Conversión de empaque",
    );
  });

  it("offers the four document kinds of the filter, 'sin_documento' as 'Ajuste manual'", () => {
    expect(movementDocumentKindOptions).toEqual([
      { label: "Venta", value: "venta" },
      { label: "Compra", value: "compra" },
      { label: "Conversión", value: "conversion" },
      { label: "Ajuste manual", value: "sin_documento" },
    ]);
  });
});
