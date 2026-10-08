import { buildMovementsExportContextLabel } from "./movementExportContextLabel";

describe("buildMovementsExportContextLabel", () => {
  it("says there is no period filter when nothing is filtered", () => {
    expect(buildMovementsExportContextLabel({})).toBe("Sin filtro de periodo");
  });

  it("lists every filter of the list, including document and document kind", () => {
    expect(
      buildMovementsExportContextLabel({
        document: "V-00",
        documentKind: "venta",
        from: "2026-10-01",
        productId: "p-harina",
        to: "2026-10-05",
        type: "venta",
      }),
    ).toBe(
      "Periodo: 2026-10-01 a 2026-10-05 | Producto: p-harina | Tipo: Venta | Tipo de documento: Venta | Documento: V-00",
    );
  });

  it("names the movements without a document 'Ajuste manual'", () => {
    expect(buildMovementsExportContextLabel({ documentKind: "sin_documento" })).toBe(
      "Sin filtro de periodo | Tipo de documento: Ajuste manual",
    );
  });

  // INV-L4: la cabecera decía "Producto: <uuid>".
  it("names the filtered product instead of printing its id", () => {
    expect(
      buildMovementsExportContextLabel(
        { productId: "d4c8d016-0000-4000-8000-000000000000" },
        "Harina PAN 1 kg",
      ),
    ).toBe("Sin filtro de periodo | Producto: Harina PAN 1 kg");
  });

  it("falls back to the product id when the name is unknown, and ignores the name without a product filter", () => {
    expect(buildMovementsExportContextLabel({ productId: "p-harina" }, "  ")).toBe(
      "Sin filtro de periodo | Producto: p-harina",
    );
    expect(buildMovementsExportContextLabel({}, "Harina PAN 1 kg")).toBe("Sin filtro de periodo");
  });
});
